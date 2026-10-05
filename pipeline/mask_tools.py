"""Photo layout, mask validation and view ordering shared by marking, tracking and lifting."""

MAX_POINTS_PER_PHOTO = 12  # SAM point prompts work best with a handful of points per object and photo
PALETTE_BGR = [(0, 140, 255), (255, 90, 0), (60, 220, 60), (230, 60, 200), (0, 230, 255), (60, 60, 255),
               (255, 230, 120), (40, 90, 150), (180, 255, 180), (160, 0, 120), (255, 255, 255), (128, 128, 0)]


def raw_from_display(x: float, y: float, orientation: int) -> tuple[float, float]:
    """The click tool shows photos upright (EXIF applied); SAM and COLMAP see the stored pixels."""
    if orientation == 3:
        return 1 - x, 1 - y
    if orientation == 6:  # stored pixels are shown rotated 90 degrees clockwise
        return y, 1 - x
    if orientation == 8:  # stored pixels are shown rotated 90 degrees counter-clockwise
        return 1 - y, x
    return x, y


def check_prompts(prompts: dict, photo_names: list[str]) -> tuple[list[str], list[str]]:
    """Errors stop the run; warnings are shown and the run goes on."""
    errors, warnings = [], []
    if prompts.get("frames") != photo_names:
        errors.append("the click tool's photo order differs from the photos on disk")
    ids = [p.get("id") for p in prompts.get("parts", [])]
    if len(ids) != len(set(ids)):
        errors.append("two parts share an id")
    known = set(ids)
    for part in prompts.get("parts", []):
        name, clicks = part.get("id"), part.get("clicks", [])
        if part.get("parent") and part["parent"] not in known:
            warnings.append(f"{name}: parent {part['parent']} has no clicks, so it is not in this run")
        if not any(c.get("positive") for c in clicks):
            errors.append(f"{name}: needs at least one positive click")
        per_photo: dict[int, int] = {}
        for c in clicks:
            if not (isinstance(c.get("frame"), int) and 0 <= c["frame"] < len(photo_names)):
                errors.append(f"{name}: click on a photo that does not exist ({c.get('frame')})")
                continue
            if c.get("photo") and c["photo"] != photo_names[c["frame"]]:
                errors.append(f"{name}: click says photo {c['photo']} but index {c['frame']} is {photo_names[c['frame']]}")
            if not (0 <= c.get("x", -1) <= 1 and 0 <= c.get("y", -1) <= 1):
                errors.append(f"{name}: click outside the photo on photo {c['frame'] + 1}")
            per_photo[c["frame"]] = per_photo.get(c["frame"], 0) + 1
        for frame, count in per_photo.items():
            if count > MAX_POINTS_PER_PHOTO:
                warnings.append(f"{name}: {count} clicks on photo {frame + 1}; SAM does best with a few (<= {MAX_POINTS_PER_PHOTO})")
    return errors, warnings


TILE = 472


def fit_square(photo, side: int):
    """Letterbox any photo into a side x side tile, so portrait and landscape photos can share a sheet."""
    import cv2
    import numpy as np

    h, w = photo.shape[:2]
    scale = side / max(h, w)
    resized = cv2.resize(photo, (round(w * scale), round(h * scale)))
    tile = np.zeros((side, side, 3), np.uint8)
    top, left = (side - resized.shape[0]) // 2, (side - resized.shape[1]) // 2
    tile[top : top + resized.shape[0], left : left + resized.shape[1]] = resized
    return tile


def contact_sheet(photo_for, frames, masks, colours, prompts, orientations, to_raw=True,
                  tile=TILE, per_row=4, label=None) -> bytes:
    """Photos with each part's mask tinted in its colour and the clicks drawn on top, shown upright.

    photo_for(frame) returns the stored-orientation BGR photo; masks is part id -> frame -> bool mask.
    to_raw=False means the clicks are already in stored-pixel coordinates; label(frame) captions a tile.
    """
    import cv2
    import numpy as np

    tiles = []
    for frame in frames:
        photo = photo_for(frame).copy()
        h, w = photo.shape[:2]
        for part_id, by_frame in masks.items():
            mask = by_frame.get(frame)
            if mask is None:
                continue
            colour = np.array(colours[part_id])
            photo[mask] = (0.45 * photo[mask] + 0.55 * colour).astype(np.uint8)
            contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(photo, contours, -1, tuple(int(c) for c in colour), 3)
        for part in prompts["parts"]:
            if part["id"] not in masks and part["id"] not in colours:
                continue
            for c in part["clicks"]:
                if c["frame"] != frame:
                    continue
                x, y = raw_from_display(c["x"], c["y"], orientations[frame]) if to_raw else (c["x"], c["y"])
                centre = (int(x * w), int(y * h))
                cv2.circle(photo, centre, 14, (255, 255, 255) if c["positive"] else (0, 0, 255), -1)
                cv2.circle(photo, centre, 10, tuple(int(v) for v in colours.get(part["id"], (0, 0, 0))), -1)
        turn = {3: cv2.ROTATE_180, 6: cv2.ROTATE_90_CLOCKWISE, 8: cv2.ROTATE_90_COUNTERCLOCKWISE}.get(orientations[frame])
        if turn is not None:
            photo = cv2.rotate(photo, turn)
        square = fit_square(photo, tile)
        text = label(frame) if label else f"foto {frame + 1}"
        cv2.putText(square, text, (8, 8 + round(tile / 26)), cv2.FONT_HERSHEY_SIMPLEX, tile / 630, (255, 255, 255), 2)
        tiles.append(square)
    if not tiles:
        tiles = [np.zeros((tile, tile, 3), np.uint8)]
    while len(tiles) % per_row:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[i : i + per_row]) for i in range(0, len(tiles), per_row)]
    return cv2.imencode(".jpg", np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes()


# --- Marking page: the owner marks a whole part on a few photos and sees SAM's mask live ---

# Photos (0-based capture indices) that together show the engine from the front, both sides and above.
KEYFRAMES = [0, 5, 11, 13, 18, 44, 87, 122]
# The parts in the order the page offers them, each with the photos (0-based) where it shows clearly from
# different sides. A child part lies inside its parent: its splats belong to both.
PARTS = {
    "coolant-reservoir": {"name": "Reserva de agua", "parent": None, "photos": [10, 25, 40, 76, 113]},
    "power-steering-reservoir": {"name": "Reserva de líquido de dirección", "parent": None,
                                 "photos": [10, 25, 41, 76, 92]},
    "brake-fluid-reservoir": {"name": "Reserva de líquido de frenos", "parent": None, "photos": [13, 19, 67, 105, 121]},
    "battery": {"name": "Batería", "parent": None, "photos": [5, 16, 18, 48, 101]},
    "fuse-box": {"name": "Fusiblera", "parent": None, "photos": [5, 17, 48, 67, 84]},
    "valve-cover": {"name": "Tapa de válvulas", "parent": "engine", "photos": [12, 35, 44, 87, 120]},
    "intake-manifold": {"name": "Múltiple de admisión", "parent": "engine", "photos": [13, 37, 53, 108, 120]},
    "engine": {"name": "Motor", "parent": None, "photos": KEYFRAMES},
}


def photos_to_mark() -> list[int]:
    """Every photo some part is marked on; SAM prepares these once so each click only runs the decoder."""
    return sorted({f for part in PARTS.values() for f in part["photos"]})
WORKING_SIDE = 1416  # SAM and the tracker both see the photos at this size


def working_photo(photo):
    """The upright photo SAM segments on the marking page, as RGB at WORKING_SIDE."""
    from PIL import ImageOps

    upright = ImageOps.exif_transpose(photo).convert("RGB")
    upright.thumbnail((WORKING_SIDE, WORKING_SIDE))
    return upright


def raw_from_display_mask(mask, orientation: int):
    """Turn a mask drawn on the upright photo into the stored pixel layout COLMAP and the tracker use."""
    import numpy as np

    if orientation == 3:
        return np.rot90(mask, 2)
    if orientation == 6:  # shown rotated 90 degrees clockwise, so undo it counter-clockwise
        return np.rot90(mask, 1)
    if orientation == 8:
        return np.rot90(mask, -1)
    if orientation != 1:
        raise ValueError(f"EXIF orientation {orientation} is mirrored and not supported")
    return mask


def mask_png(mask) -> bytes:
    """A mask as a white PNG whose alpha is the mask, ready to composite in the browser."""
    import io

    import numpy as np
    from PIL import Image

    alpha = Image.fromarray(np.asarray(mask, bool).astype(np.uint8) * 255, "L")
    png = io.BytesIO()
    # Fast compression: this runs on every click, and a slightly larger PNG beats a slower answer.
    Image.merge("LA", (Image.new("L", alpha.size, 255), alpha)).save(png, "PNG", compress_level=1)
    return png.getvalue()


def sam_prompt(marks: dict, width: int, height: int) -> dict | None:
    """Page marks (relative, upright) as SAM predict() arguments in pixels; None when nothing says "this"."""
    import numpy as np

    clicks, box = marks.get("clicks", []), marks.get("box")
    if box is None and not any(c["positive"] for c in clicks):
        return None
    prompt = {"point_coords": None, "point_labels": None, "box": None}
    if clicks:
        prompt["point_coords"] = np.array([[c["x"] * width, c["y"] * height] for c in clicks], np.float32)
        prompt["point_labels"] = np.array([1 if c["positive"] else 0 for c in clicks], np.int32)
    if box is not None:
        prompt["box"] = np.array([box[0] * width, box[1] * height, box[2] * width, box[3] * height], np.float32)
    # One click is ambiguous (a bolt, the valve cover, the engine), so let SAM offer three and keep its best.
    prompt["multimask_output"] = box is None and len(clicks) == 1
    return prompt


def marks_files(request: dict, masks: dict, orientations: dict) -> dict[str, bytes]:
    """What saving a part writes: its marks and one stored-layout mask PNG per marked keyframe."""
    import io
    import json

    import numpy as np
    from PIL import Image

    files = {"marks.json": json.dumps(request, indent=2).encode()}
    for frame, mask in masks.items():
        raw = raw_from_display_mask(mask, orientations[frame])
        png = io.BytesIO()
        Image.fromarray(np.asarray(raw, bool).astype(np.uint8) * 255, "L").save(png, "PNG")
        files[f"{frame:05d}.png"] = png.getvalue()
    return files


def view_distance(centres, directions):
    """How different two photos look: camera travel (in median-radius units) plus turn (in 45 degree units)."""
    import numpy as np

    c, d = np.asarray(centres, float), np.asarray(directions, float)
    d = d / np.linalg.norm(d, axis=1, keepdims=True)
    scale = np.median(np.linalg.norm(c - c.mean(0), axis=1)) or 1.0
    travel = np.linalg.norm(c[:, None] - c[None], axis=2) / scale
    turn = np.arccos(np.clip(d @ d.T, -1, 1)) / (np.pi / 4)
    return travel + turn


MIN_KEYFRAMES_TO_SCORE = 4  # hiding one of fewer would leave the tracker under three marks
HOLDOUT_COUNT = 2


def pick_holdouts(keyframes: list[int], centres, directions) -> list[int]:
    """The keyframes to hide when scoring variants: those farthest (mean view distance) from the other keyframes.

    Empty below MIN_KEYFRAMES_TO_SCORE keyframes. The hardest photos to predict show a variant's real quality.
    """
    import numpy as np

    if len(keyframes) < MIN_KEYFRAMES_TO_SCORE:
        return []
    cost = view_distance(centres, directions)[np.ix_(keyframes, keyframes)]
    far = cost.sum(1) / (len(keyframes) - 1)
    ranked = sorted(range(len(keyframes)), key=lambda i: (-far[i], keyframes[i]))
    return sorted(keyframes[i] for i in ranked[:HOLDOUT_COUNT])


def view_order(centres, directions) -> list[int]:
    """Photo order in which each photo looks like the one before it, so a video tracker can follow the part."""
    cost = view_distance(centres, directions)
    n = len(cost)

    def length(path):
        return sum(cost[a, b] for a, b in zip(path, path[1:]))

    def greedy(start):
        path, left = [start], set(range(n)) - {start}
        while left:
            path.append(min(left, key=lambda j: cost[path[-1], j]))
            left.remove(path[-1])
        return path

    def untangle(path):  # 2-opt: reverse any stretch whose ends are closer the other way round
        improved = True
        while improved:
            improved = False
            for i in range(1, n - 2):
                for j in range(i + 1, n - 1):
                    a, b, c, d = path[i - 1], path[i], path[j], path[j + 1]
                    if cost[a, c] + cost[b, d] < cost[a, b] + cost[c, d] - 1e-9:
                        path[i : j + 1] = path[i : j + 1][::-1]
                        improved = True
        return path

    return min((untangle(greedy(s)) for s in range(n)), key=length) if n > 1 else list(range(n))


def iou(a, b) -> float:
    import numpy as np

    union = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / union) if union else 1.0


MIN_MASK_SHARE = 0.001  # a keyframe mask covering less of its photo than this is a slip, not a part
MAX_MASK_SHARE = 0.9  # one covering more is the whole photo
# Share of a child's mask that its parent's mask covers on a photo marked for both. The lift unites the two, so a
# parent drawn a little short is harmless; a child mostly outside was marked on something else.
MIN_CHILD_INSIDE = 0.5
MAX_SIBLING_OVERLAP = 0.5  # share of the smaller of two top-level parts' masks that the other may also claim


def check_marks(saved: dict[str, dict], shape_of, parts: dict | None = None) -> list[str]:
    """What stops the owner's saved marks from being tracked and lifted; empty when nothing does.

    saved[part] = {"marks": its marks.json, "masks": {photo: bool mask in the stored layout}};
    shape_of(photo) is the stored-layout shape the tracker reads for that photo.
    """
    import numpy as np

    parts = PARTS if parts is None else parts
    errors = [f"{part}: no saved marks" for part in parts if part not in saved]
    errors += [f"{part}: marks for a part the page does not offer" for part in saved if part not in parts]
    for part, entry in saved.items():
        marks, masks = entry["marks"], entry["masks"]
        if marks.get("part") != part:
            errors.append(f"{part}: marks.json names part {marks.get('part')!r}")
        listed = sorted(int(photo) for photo in marks.get("photos", {}))
        if listed != sorted(masks):
            errors.append(f"{part}: marks.json lists photos {listed}, masks exist for {sorted(masks)}")
        if not masks:
            errors.append(f"{part}: no keyframe masks")
        for photo, mask in sorted(masks.items()):
            if mask.shape != tuple(shape_of(photo)):
                errors.append(f"{part}: mask {photo} is {mask.shape}, the photo {tuple(shape_of(photo))}")
                continue
            share = float(np.mean(mask))
            if not MIN_MASK_SHARE <= share <= MAX_MASK_SHARE:
                errors.append(f"{part}: mask {photo} covers {share:.2%} of the photo")
    usable = {part: entry["masks"] for part, entry in saved.items() if part in parts}
    for part, masks in usable.items():
        parent = parts[part]["parent"]
        for photo in sorted(set(masks) & set(usable.get(parent, {}))):
            child, whole = masks[photo], usable[parent][photo]
            if child.shape != whole.shape or not child.any():
                continue
            inside = float(np.logical_and(child, whole).sum() / child.sum())
            if inside < MIN_CHILD_INSIDE:
                errors.append(f"{part}: only {inside:.1%} of its mask on photo {photo} lies inside {parent}'s")
    top = sorted(part for part in usable if parts[part]["parent"] is None)
    for i, a in enumerate(top):
        for b in top[i + 1:]:
            for photo in sorted(set(usable[a]) & set(usable[b])):
                ma, mb = usable[a][photo], usable[b][photo]
                smaller = min(ma.sum(), mb.sum())
                if ma.shape != mb.shape or not smaller:
                    continue
                shared = float(np.logical_and(ma, mb).sum() / smaller)
                if shared > MAX_SIBLING_OVERLAP:
                    errors.append(f"{a} and {b}: both claim {shared:.1%} of the smaller mask on photo {photo}")
    return errors
