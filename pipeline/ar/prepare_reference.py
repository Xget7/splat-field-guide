"""Place an Object Capture USDZ in the SPZ pack's frame and estimated metre scale.

This preserves geometry and textures. It does not crop background, verify real-world
landmarks, train a recognizer, or establish the trained ARReferenceObject's origin.
"""

import argparse
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

import numpy as np
from pxr import Gf, Sdf, Usd, UsdGeom, UsdUtils


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(args):
    report_path = args.output.with_suffix(".prepared.json")
    if args.output.suffix.lower() != ".usdz":
        raise ValueError("Output must be a .usdz file.")
    for path in [args.output, report_path]:
        if path.exists():
            raise ValueError(f"Refusing to overwrite {path}")
    registration = json.loads(args.registration.read_text())
    if registration.get("matrixOrder") != "rows" or not registration.get("status", "").startswith("candidate_"):
        raise ValueError("Expected a candidate registration from register_reference.py.")
    for key in ["poses", "packReport"]:
        record = registration["inputs"][key]
        if digest(Path(record["path"])) != record["sha256"]:
            raise ValueError(f"Registration input changed: {key}")
    poses_path = Path(registration["inputs"]["poses"]["path"])
    expected_model = poses_path.with_name(poses_path.name.removesuffix(".poses.json") + ".usdz")
    if expected_model.resolve() != args.model.resolve():
        raise ValueError("The USDZ must match the registration's camera-pose sidecar.")
    matrix = np.asarray(registration["rawReferenceFromPack"], dtype=float)
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all() or not np.allclose(matrix[3], [0, 0, 0, 1]):
        raise ValueError("Invalid registration matrix.")
    pack_from_raw = np.linalg.inv(matrix)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="sfg-reference-") as directory:
        directory = Path(directory).resolve()
        with zipfile.ZipFile(args.model) as archive:
            entries = archive.namelist()
            if not entries or Path(entries[0]).suffix not in [".usd", ".usda", ".usdc"]:
                raise ValueError("Expected the USD root layer as the first USDZ entry.")
            for name in entries:
                if not (directory / name).resolve().is_relative_to(directory):
                    raise ValueError(f"Unsafe archive entry: {name}")
            if archive.testzip():
                raise ValueError("USDZ archive failed its integrity check.")
            archive.extractall(directory)
        stage = Usd.Stage.Open(str(directory / entries[0]))
        root = stage.GetDefaultPrim()
        if not root or not root.IsA(UsdGeom.Xformable):
            raise ValueError("Expected a transformable USDZ default prim.")
        if list(stage.GetPseudoRoot().GetChildren()) != [root]:
            raise ValueError("Only a single-root Object Capture model is supported.")
        if UsdGeom.GetStageUpAxis(stage) != UsdGeom.Tokens.y or UsdGeom.GetStageMetersPerUnit(stage) != 1:
            raise ValueError("Expected Object Capture Y-up, metres-per-unit=1 metadata.")
        xform = UsdGeom.Xformable(root)
        previous = xform.GetLocalTransformation()
        # USD/Gf uses row vectors; our JSON uses column vectors, so transpose.
        adjustment = Gf.Matrix4d(pack_from_raw.T.tolist())
        xform.MakeMatrixXform().Set(previous * adjustment)
        stage.SetMetadata("documentation", "Candidate reference in SPZ pack coordinates. Physical scale and mesh landmarks unverified.")
        aligned_layer = directory / "aligned.usdc"
        if not stage.GetRootLayer().Export(str(aligned_layer)):
            raise ValueError("Could not export the aligned USD layer.")
        if not UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(aligned_layer)), str(args.output)):
            raise ValueError("Could not package the aligned USDZ.")
    prepared = {
        "schemaVersion": 1,
        "status": "candidate_requires_geometry_review_and_physical_validation",
        "validatedPhysicalAlignment": False,
        "sourceModel": {"path": str(args.model), "sha256": digest(args.model)},
        "registration": {"path": str(args.registration), "sha256": digest(args.registration)},
        "outputModel": {"path": str(args.output), "sha256": digest(args.output)},
        "matrixOrder": "rows",
        "packFromRawReference": pack_from_raw.tolist(),
        "preparedModelFromPack": np.eye(4).tolist(),
        "packScaleNote": registration["packScaleNote"],
        "note": "Only the root transform changed. Geometry, background and textures are preserved. Verify trained reference origin before using an AR anchor.",
    }
    with report_path.open("x") as file:
        json.dump(prepared, file, indent=2, allow_nan=False)
        file.write("\n")
    print(f"Prepared candidate: {args.output}")
    print("Model frame now matches the pack. Review geometry and scale before training.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--registration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        prepare(args)
    except (ValueError, KeyError, OSError, np.linalg.LinAlgError, zipfile.BadZipFile) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
