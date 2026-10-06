"""Labels follow PLY order with 1-based pack.yaml part numbers and 0 for no part; parent eligibility uses masks united with children before child ownership is resolved."""

import argparse
import json
import pathlib
import time

import cv2
import numpy as np

from pipeline import artifacts
from pipeline.pack import lift
from pipeline.pack import masks
from pipeline.pack import mask_tools
HERE = pathlib.Path(__file__).parent
DATA = HERE.parents[1] / "data"
PACK = HERE.parents[1] / "content" / "gol-trend-engine-bay" / "pack.yaml"
NO_PART = 0
MAX_LABEL = 255  # labels are uint8
# Splats nearer than this share of their part's extent join one piece of it.
PIECE_LINK = 0.05
# A piece farther from the part's largest piece than this share of that piece's extent is another object.
PIECE_REACH = 0.25
EXTENT_PERCENTILE = 2.0  # a point set's extent: the diagonal from its 2nd to its 98th percentile
# RGB tints use 0-1 components in label-number-minus-one order.
PART_RGB = [(0.95, 0.35, 0.65), (0.98, 0.75, 0.15), (0.20, 0.85, 0.40), (0.55, 0.40, 0.95), (0.95, 0.50, 0.10),
            (0.22, 0.74, 0.97), (0.90, 0.20, 0.20), (0.10, 0.85, 0.85), (0.70, 0.90, 0.20), (0.60, 0.30, 0.10)]


def pack_parts() -> dict[str, dict]:
    """Label numbers follow pack order and must agree with marking-page part identities and parents."""
    import yaml

    authored = yaml.safe_load(PACK.read_text())["parts"]
    parts = {p["id"]: {"label": i + 1, "parent": p["parent"]} for i, p in enumerate(authored)}
    assert len(parts) == len(authored), "two parts share an id in pack.yaml"
    assert len(parts) <= MAX_LABEL, f"{len(parts)} parts do not fit a uint8 label"
    assert len(parts) <= len(PART_RGB), f"{len(parts)} parts, {len(PART_RGB)} tints"
    assert {k: v["parent"] for k, v in parts.items()} == {k: v["parent"] for k, v in mask_tools.PARTS.items()}, (
        "pack.yaml and mask_tools.PARTS differ in part ids or parents")
    return parts


def union_views(parent: dict, children: list[dict]) -> dict[int, tuple[np.ndarray, float]]:
    """Use the parent's voting photos when present, otherwise the children's photos."""
    sources = [v for v in (parent, *children) if v]
    frames = set(parent) if parent else set().union(*children)
    return {f: (np.any([v[f][0] for v in sources if f in v], axis=0), max(v[f][1] for v in sources if f in v))
            for f in frames}


def assign(parts: dict[str, dict], shares: dict[str, np.ndarray], group_shares: dict[str, np.ndarray]) -> np.ndarray:
    """shares contains each part's mask share; group_shares contains each top-level part's union with its children."""
    size = len(next(iter(group_shares.values())))
    tops = [t for t, p in parts.items() if p["parent"] is None and t in group_shares]
    best, owner = np.zeros(size), np.full(size, NO_PART, np.uint8)
    for top in tops:  # siblings compete: the larger share wins, the earlier part on a tie
        won = (group_shares[top] > lift.MAJORITY) & (group_shares[top] > best)
        best[won], owner[won] = group_shares[top][won], parts[top]["label"]
    labels = np.full(size, NO_PART, np.uint8)
    for top in tops:
        mine = owner == parts[top]["label"]
        if top in shares:
            labels[mine] = parts[top]["label"]
        kids = [c for c, p in parts.items() if p["parent"] == top and c in shares]
        if kids:
            kid_shares = np.stack([shares[c] for c in kids])
            strongest = kid_shares.argmax(0)
            holds = mine & (kid_shares.max(0) > lift.MAJORITY)
            for i, kid in enumerate(kids):
                labels[holds & (strongest == i)] = parts[kid]["label"]
    return labels


def extent(points: np.ndarray) -> float:
    low, high = np.percentile(points, [EXTENT_PERCENTILE, 100 - EXTENT_PERCENTILE], axis=0)
    return float(np.linalg.norm(high - low))


def pieces(points: np.ndarray, link: float) -> np.ndarray:
    """A piece index per point: points in touching grid cells of side `link` belong to one piece."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    cells, cell_of = np.unique(np.floor(points / link).astype(np.int64), axis=0, return_inverse=True)
    cells -= cells.min(0) - 1  # a one-cell border, so no neighbour wraps into another row
    span = cells.max(0) + 2
    keys = (cells[:, 0] * span[1] + cells[:, 1]) * span[2] + cells[:, 2]  # sorted, as np.unique sorts the rows
    rows, cols = [], []
    for offset in np.stack(np.meshgrid([-1, 0, 1], [-1, 0, 1], [-1, 0, 1]), -1).reshape(-1, 3):
        wanted = keys + (offset[0] * span[1] + offset[1]) * span[2] + offset[2]
        at = np.minimum(np.searchsorted(keys, wanted), len(keys) - 1)
        found = keys[at] == wanted
        rows.append(np.flatnonzero(found))
        cols.append(at[found])
    rows, cols = np.concatenate(rows), np.concatenate(cols)
    _, piece = connected_components(coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(keys),) * 2),
                                    directed=False)
    return piece[cell_of.ravel()]


def body(points: np.ndarray) -> np.ndarray:
    from scipy.spatial import cKDTree

    piece = pieces(points, PIECE_LINK * extent(points))
    largest = piece == np.bincount(piece).argmax()
    reach = PIECE_REACH * extent(points[largest])
    gap, _ = cKDTree(points[largest]).query(points[~largest], distance_upper_bound=reach)
    nearest = np.full(piece.max() + 1, np.inf)
    np.minimum.at(nearest, piece[~largest], gap)
    return largest | (nearest[piece] <= reach)


def drop_strays(parts: dict[str, dict], labels: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Detached parent pieces become unlabelled, detached child pieces return to the parent, and parent bodies include their children."""
    out = labels.copy()
    tops = [t for t, p in parts.items() if p["parent"] is None]
    for part in tops + [c for c in parts if c not in tops]:  # parents first, so a child keeps what they drop
        parent = parts[part]["parent"]
        family = [parts[part]["label"]] + [p["label"] for p in parts.values() if p["parent"] == part]
        mine = np.flatnonzero(np.isin(out, family))
        if len(mine):
            out[mine[~body(points[mine])]] = NO_PART if parent is None else parts[parent]["label"]
    return out


def load_part(scene: lift.Scene, part: str, marks: pathlib.Path, tracks: pathlib.Path) -> dict | None:
    capture = artifacts.capture(lift.PHOTOS)["sha256"]
    masks.read(marks / part, capture)
    keyframes = lift.load_masks(marks / part)
    if not keyframes:
        return None
    report = json.loads((tracks / part / "report.json").read_text())
    assert report["capture_sha256"] == capture, f"{part}: tracking capture mismatch"
    assert report["reconstruction_sha256"] == artifacts.reconstruction(lift.SPARSE)["sha256"], f"{part}: tracking reconstruction mismatch"
    assert report["marks_sha256"] == artifacts.tree(masks.folder(marks / part)), f"{part}: tracking used different saved marks"
    tracked = lift.load_tracked(tracks / part, keyframes)
    views, rejected = lift.voters(scene, keyframes, tracked, 1.0)
    return {"keyframes": keyframes, "tracked": tracked, "views": views, "rejected": rejected}


def lift_parts(scene: lift.Scene, parts: dict[str, dict], loaded: dict[str, dict]) -> np.ndarray:
    shares = {part: scene.share(scene.votes(info["views"])) for part, info in loaded.items()}
    group_shares = {}
    for top in (t for t, p in parts.items() if p["parent"] is None):
        kids = [c for c, p in parts.items() if p["parent"] == top and c in loaded]
        if top not in loaded and not kids:
            continue
        if not kids:
            group_shares[top] = shares[top]
            continue
        united = scene.share(scene.votes(union_views(loaded.get(top, {}).get("views"), [loaded[c]["views"] for c in kids])))
        group_shares[top] = np.maximum(united, np.stack([shares[c] for c in kids]).max(0))
    return assign(parts, shares, group_shares)


def tint(splat: np.ndarray, labels: np.ndarray) -> np.ndarray:
    tinted = np.array(splat)
    for number in np.unique(labels[labels != NO_PART]):
        rgb = (np.array(PART_RGB[number - 1]) - 0.5) / lift.SH_C0
        mine = labels == number
        for channel in range(3):
            name = f"f_dc_{channel}"
            tinted[name][mine] = (1 - lift.HIGHLIGHT_MIX) * tinted[name][mine] + lift.HIGHLIGHT_MIX * rgb[channel]
    return tinted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ply", type=pathlib.Path, default=lift.SPLAT)
    parser.add_argument("--marks", type=pathlib.Path, default=DATA / "segment" / "marks")
    parser.add_argument("--tracks", type=pathlib.Path, default=DATA / "segment" / "tracks")
    parser.add_argument("--out", type=pathlib.Path, default=DATA / "segment" / "lift" / "all")
    args = parser.parse_args()
    started = time.time()
    parts = pack_parts()

    splat, header = lift.read_ply(args.ply)
    scene = lift.load_scene(splat)
    loaded = {}
    for part in parts:
        info = load_part(scene, part, args.marks, args.tracks)
        if info:
            loaded[part] = info
            print(f"{part}: {len(info['keyframes'])} keyframes, {len(info['tracked']) - len(info['rejected'])} tracked "
                  f"photos vote, rejected {[f + 1 for f in info['rejected']]} ({time.time() - started:.0f} s)")
    missing = [p for p in parts if p not in loaded]
    untracked = [p for p, info in loaded.items() if not info["tracked"]]
    print(f"no marks yet: {missing or 'none'}; keyframes only (no tracks): {untracked or 'none'}")
    assert not missing and not untracked, "all parts need saved marks and tracked masks before lifting"

    lifted = lift_parts(scene, parts, loaded)
    labels = drop_strays(parts, lifted, scene.points)
    for part, info in parts.items():
        dropped = int(((lifted == info["label"]) & (labels != info["label"])).sum())
        if dropped:
            print(f"{part}: dropped {dropped:,} splats away from its body")
    with artifacts.candidate(args.out) as out:
        np.save(out / "labels.npy", labels)
        report = {"labels_sha256": artifacts.sha256(out / "labels.npy"),
                  "sources": {"ply_sha256": artifacts.sha256(args.ply),
                              "capture_sha256": artifacts.capture(lift.PHOTOS)["sha256"],
                              "reconstruction_sha256": artifacts.reconstruction(lift.SPARSE)["sha256"],
                              "marks_sha256": {p: artifacts.tree(masks.folder(args.marks / p)) for p in parts},
                              "tracks_sha256": {p: artifacts.tree(args.tracks / p) for p in parts}},
                  "splats": len(labels), "labels": {p: v["label"] for p, v in parts.items()},
                  "missing_marks": missing, "keyframes_only": untracked,
                  "unlabelled": int((labels == NO_PART).sum()),
                  "dropped_away_from_body": int((lifted != labels).sum()), "parts": {}}
        for part, info in loaded.items():
            family = [part] + [c for c, p in parts.items() if p["parent"] == part]
            covered = np.isin(labels, [parts[f]["label"] for f in family])  # a parent's mask covers its children
            views, tiles = {}, []
            for frame, (mask, _) in sorted(info["views"].items()):
                score, rendered, truth = scene.check(covered, frame, mask)
                views[frame] = round(score, 4)
                if frame in info["keyframes"]:
                    tiles.append(lift.label(scene.preview(frame, mask, rendered, truth), f"{frame + 1}: IoU {score:.2f}"))
            cv2.imwrite(str(out / f"views_{part}.jpg"), lift.sheet(tiles), [cv2.IMWRITE_JPEG_QUALITY, 85])
            report["parts"][part] = {
                "label": parts[part]["label"], "keyframes": sorted(info["keyframes"]),
                "tracked": sorted(set(info["tracked"]) - set(info["rejected"])), "rejected": info["rejected"],
                "labelled": int((labels == parts[part]["label"]).sum()), "labelled_with_children": int(covered.sum()),
                "mean_iou": float(np.mean(list(views.values()))), "views": views}
            print(f"{part} (label {parts[part]['label']}): {report['parts'][part]['labelled']:,} splats, "
                  f"mean IoU {report['parts'][part]['mean_iou']:.3f} ({time.time() - started:.0f} s)")
        (out / "report.json").write_text(json.dumps(report, indent=2))
        with open(out / "parts.ply", "wb") as f:
            f.write(header)
            f.write(tint(splat, labels).tobytes())
        print(f"written to {args.out} ({time.time() - started:.0f} s)")


if __name__ == "__main__":
    main()
