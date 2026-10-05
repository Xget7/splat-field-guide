# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy<2", "opencv-python-headless"]
# ///
"""Estimate a candidate Object Capture ↔ SPZ registration from matching photo poses.

Run with uv. This writes a diagnostic candidate, never an app-ready calibration.
Camera agreement cannot validate mesh landmarks or the real object's physical scale.
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from lift import read_cameras


def similarity(source: np.ndarray, target: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """Least-squares proper Sim(3): target = scale * rotation @ source + translation."""
    if source.shape != target.shape or source.ndim != 2 or source.shape[1] != 3:
        raise ValueError("Correspondences must be matching N×3 arrays.")
    if len(source) < 6 or not np.isfinite(source).all() or not np.isfinite(target).all():
        raise ValueError("At least six finite camera correspondences are required.")
    x, y = source - source.mean(0), target - target.mean(0)
    if np.linalg.matrix_rank(x) < 2 or np.linalg.matrix_rank(y) < 2:
        raise ValueError("Camera centres are degenerate; capture more viewpoints.")
    u, values, vt = np.linalg.svd(y.T @ x / len(x))
    signs = np.ones(3)
    signs[-1] = np.linalg.det(u @ vt)
    rotation = u @ np.diag(signs) @ vt
    scale = float(np.sum(values * signs) / np.mean(np.sum(x * x, axis=1)))
    if not np.isfinite(scale) or scale <= 0:
        raise ValueError("The estimated scale is invalid.")
    translation = target.mean(0) - scale * rotation @ source.mean(0)
    return scale, rotation, translation


def errors(source, target, fit):
    scale, rotation, translation = fit
    # Divide by scale to express disagreement in pack units, not raw USDZ units.
    return np.linalg.norm(scale * source @ rotation.T + translation - target, axis=1) / scale


def stats(values):
    return {
        "rmse": float(np.sqrt(np.mean(values * values))),
        "median": float(np.median(values)),
        "p90": float(np.percentile(values, 90)),
        "max": float(np.max(values)),
    }


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def register(args):
    if args.output.exists():
        raise ValueError(f"Refusing to overwrite {args.output}")
    pose_data = json.loads(args.poses.read_text())
    if pose_data.get("matrixOrder") != "rows" or pose_data.get("coordinateSystem") != "PhotogrammetrySession.Pose.transform (not COLMAP or pack)":
        raise ValueError("Expected row-serialized PhotogrammetrySession poses.")
    placement_report = json.loads(args.pack_report.read_text())
    placement = placement_report["placement"]
    pack_rotation = np.asarray(placement["rotation"], dtype=float)
    pack_origin = np.asarray(placement["origin"], dtype=float)
    pack_scale = float(placement["scale"])
    if pack_rotation.shape != (3, 3) or pack_origin.shape != (3,) or pack_scale <= 0:
        raise ValueError("Invalid pack placement.")
    if not np.allclose(pack_rotation.T @ pack_rotation, np.eye(3), atol=1e-5) or np.linalg.det(pack_rotation) < 0:
        raise ValueError("Pack rotation must be a proper orthonormal rotation.")
    cameras = read_cameras(args.sparse)
    poses = {}
    for pose in pose_data["poses"]:
        name = pose.get("image")
        if not name:
            continue
        if name in poses:
            raise ValueError(f"Duplicate photo pose: {name}")
        matrix = np.asarray(pose["transform"], dtype=float)
        if matrix.shape != (4, 4) or not np.isfinite(matrix).all():
            raise ValueError(f"Invalid pose for {name}")
        if not np.allclose(matrix[3], [0, 0, 0, 1]):
            raise ValueError(f"Expected an affine camera pose for {name}")
        if not np.allclose(matrix[:3, :3].T @ matrix[:3, :3], np.eye(3), atol=1e-4) or np.linalg.det(matrix[:3, :3]) < 0:
            raise ValueError(f"Non-rigid camera pose for {name}")
        poses[name] = matrix
    names = sorted(set(cameras) & set(poses))
    if len(names) < 10:
        raise ValueError(f"Only {len(names)} shared photographs; need at least ten.")
    # COLMAP is world-to-camera, with camera +Z forward and +Y down.
    # Object Capture returns world-from-camera, with camera -Z forward and +Y up.
    source = np.asarray([
        pack_scale * pack_rotation @ (-cameras[n][0].T @ cameras[n][1] - pack_origin)
        for n in names
    ])
    target = np.asarray([poses[n][:3, 3] for n in names])
    held_out = np.arange(len(names)) % 5 == 0
    training_fit = similarity(source[~held_out], target[~held_out])
    holdout_stats = stats(errors(source[held_out], target[held_out], training_fit))
    fit = similarity(source, target)
    scale, rotation, translation = fit
    position_errors = errors(source, target, fit)
    camera_axes = np.diag([1.0, -1.0, -1.0])
    orientation_errors = []
    for name in names:
        predicted = rotation @ pack_rotation @ cameras[name][0].T @ camera_axes
        cos_angle = (np.trace(predicted.T @ poses[name][:3, :3]) - 1) / 2
        orientation_errors.append(np.degrees(np.arccos(np.clip(cos_angle, -1, 1))))
    orientation_stats = stats(np.asarray(orientation_errors))
    if holdout_stats["rmse"] > args.max_position_error or stats(position_errors)["rmse"] > args.max_position_error:
        raise ValueError(f"Camera fit exceeds {args.max_position_error} pack units: {holdout_stats}")
    if orientation_stats["p90"] > args.max_orientation_error:
        raise ValueError(f"Camera orientation agreement failed: {orientation_stats}")
    matrix = np.eye(4)
    matrix[:3, :3] = scale * rotation
    matrix[:3, 3] = translation
    result = {
        "schemaVersion": 1,
        "status": "candidate_requires_mesh_landmarks_and_physical_scale",
        "validatedPhysicalAlignment": False,
        "matrixOrder": "rows",
        "columnVectorConvention": "rawReferencePoint = rawReferenceFromPack @ packPoint",
        "rawReferenceFromPack": matrix.tolist(),
        "rawReferenceUnitsPerPackUnit": scale,
        "rawReferenceScaleToPackUnits": 1 / scale,
        "packScaleNote": placement_report.get("scale", {}).get("note", "Physical scale unverified."),
        "matchedPhotoCount": len(names),
        "cameraResidualPackUnits": stats(position_errors),
        "heldOutCameraResidualPackUnits": holdout_stats,
        "heldOutPhotoCount": int(held_out.sum()),
        "cameraOrientationErrorDegrees": orientation_stats,
        "inputs": {
            "poses": {"path": str(args.poses), "sha256": digest(args.poses)},
            "packReport": {"path": str(args.pack_report), "sha256": digest(args.pack_report)},
            "colmapImages": {"path": str(args.sparse / "images.bin"), "sha256": digest(args.sparse / "images.bin")},
        },
        "matchedPhotos": names,
        "heldOutPhotos": [n for n, held in zip(names, held_out) if held],
        "nextChecks": [
            "Verify the mesh uses the same coordinate system as these camera poses.",
            "Verify shared mesh/splat landmarks independently of camera fitting.",
            "Measure the physical object; pack metres currently depend on an estimated battery size.",
            "Recompute registration after changing USDZ scale, origin, orientation or pack placement.",
            "Confirm the trained ARReferenceObject coordinate frame before publishing referenceFromPack.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as file:
        json.dump(result, file, indent=2, allow_nan=False)
        file.write("\n")
    print(f"Matched {len(names)} photos; {held_out.sum()} held out.")
    print(f"Camera RMSE: {stats(position_errors)['rmse']:.6f} pack units; holdout: {holdout_stats['rmse']:.6f}.")
    print(f"Orientation p90: {orientation_stats['p90']:.3f} degrees; raw USDZ scale: {scale:.6f} × pack.")
    print(f"Candidate: {args.output}. Physical alignment remains unverified.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--poses", type=Path, required=True)
    parser.add_argument("--sparse", type=Path, default=Path("data/capture/full/sparse/0"))
    parser.add_argument("--pack-report", type=Path, default=Path("data/pack/gol-trend-engine-bay/1/publication.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-position-error", type=float, default=0.02, help="RMSE limit in pack units, approximately metres.")
    parser.add_argument("--max-orientation-error", type=float, default=5.0, help="P90 camera rotation error in degrees.")
    args = parser.parse_args()
    if any(not np.isfinite(value) or value <= 0 for value in [args.max_position_error, args.max_orientation_error]):
        parser.error("Error limits must be positive and finite.")
    try:
        register(args)
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
