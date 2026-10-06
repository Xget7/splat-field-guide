"""Remove only tiny, detached mesh fragments without changing the reference frame.

The default thresholds retain legitimate disconnected parts near the main mesh.
Only single-root, triangle-mesh Object Capture USDZ files are supported. Textures,
materials, surviving coordinates, normals, and texture coordinates are preserved.
"""

import argparse
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

import numpy as np
from pxr import Gf, Sdf, Usd, UsdGeom, UsdUtils, Vt
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def texture_hashes(path):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip():
            raise ValueError("USDZ archive failed its integrity check.")
        return sorted(
            hashlib.sha256(archive.read(name)).hexdigest()
            for name in archive.namelist()
            if Path(name).suffix.lower() in {".png", ".jpg", ".jpeg", ".exr"}
        )


def cleanup(args):
    report_path = args.output.with_suffix(".cleaned.json")
    if args.output.suffix.lower() != ".usdz":
        raise ValueError("Output must be a .usdz file.")
    for path in (args.output, report_path):
        if path.exists():
            raise ValueError(f"Refusing to overwrite {path}")
    source_textures = texture_hashes(args.model)
    with tempfile.TemporaryDirectory(prefix="sfg-cleanup-") as directory:
        directory = Path(directory).resolve()
        with zipfile.ZipFile(args.model) as archive:
            names = archive.namelist()
            if not names or Path(names[0]).suffix not in {".usd", ".usda", ".usdc"}:
                raise ValueError("Expected a USD root layer as the first USDZ entry.")
            if any(not (directory / name).resolve().is_relative_to(directory) for name in names):
                raise ValueError("Unsafe archive entry.")
            archive.extractall(directory)
        stage = Usd.Stage.Open(str(directory / names[0]))
        root = stage.GetDefaultPrim()
        if not root or list(stage.GetPseudoRoot().GetChildren()) != [root]:
            raise ValueError("Expected a single default root.")
        if UsdGeom.GetStageMetersPerUnit(stage) != 1:
            raise ValueError("Expected metre units.")
        original_root_matrix = UsdGeom.Xformable(root).GetLocalTransformation()
        mesh_results = []
        for prim in stage.Traverse():
            if not prim.IsA(UsdGeom.Mesh):
                continue
            mesh = UsdGeom.Mesh(prim)
            counts = np.asarray(mesh.GetFaceVertexCountsAttr().Get(), dtype=np.int32)
            if not np.all(counts == 3):
                raise ValueError("Only triangle meshes are supported.")
            if any(child.IsA(UsdGeom.Subset) for child in prim.GetChildren()):
                raise ValueError("Material subsets need explicit index remapping.")
            if mesh.GetHoleIndicesAttr().Get():
                raise ValueError("Meshes containing authored hole indices are unsupported.")
            points = np.asarray(mesh.GetPointsAttr().Get(), dtype=np.float32)
            triangles = np.asarray(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int32).reshape(-1, 3)
            edges = np.concatenate((triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]))
            graph = coo_matrix((np.ones(len(edges), dtype=np.uint8), (edges[:, 0], edges[:, 1])), shape=(len(points), len(points))).tocsr()
            component_count, vertex_component = connected_components(graph, directed=False)
            face_component = vertex_component[triangles[:, 0]]
            # Gf exposes a buffer; copy it before its temporary Python wrapper dies.
            world_matrix = np.array(UsdGeom.XformCache().GetLocalToWorldTransform(prim), dtype=float, copy=True)
            world_points = np.einsum("ij,jk->ik", np.column_stack((points, np.ones(len(points)))), world_matrix, optimize=False)[:, :3]
            if not np.isfinite(world_points).all():
                raise ValueError("Reference world coordinates must be finite.")
            areas = np.linalg.norm(np.cross(world_points[triangles[:, 1]] - world_points[triangles[:, 0]], world_points[triangles[:, 2]] - world_points[triangles[:, 0]]), axis=1) / 2
            component_areas = np.bincount(face_component, weights=areas, minlength=component_count)
            component_faces = np.bincount(face_component, minlength=component_count)
            main = int(np.argmax(component_areas))
            main_points = world_points[np.unique(triangles[face_component == main])]
            main_min, main_max = main_points.min(0), main_points.max(0)
            component_reports, removed = [], []
            for component in range(component_count):
                if not component_faces[component]:
                    continue
                component_points = world_points[np.unique(triangles[face_component == component])]
                lower, upper = component_points.min(0), component_points.max(0)
                separation = float(np.linalg.norm(np.maximum(0, np.maximum(lower - main_max, main_min - upper))))
                area_percent = float(component_areas[component] / areas.sum() * 100)
                remove = component != main and area_percent <= args.max_area_percent and component_faces[component] <= args.max_faces and separation >= args.min_gap_metres
                if remove:
                    removed.append(component)
                component_reports.append({"id": component, "faces": int(component_faces[component]), "areaPercent": area_percent, "gapFromMainBoundsMetres": separation, "boundsMetres": [lower.tolist(), upper.tolist()], "removed": bool(remove)})
            keep_faces = ~np.isin(face_component, removed)
            removed_area_percent = float(areas[~keep_faces].sum() / areas.sum() * 100)
            if removed_area_percent > args.max_area_percent:
                raise ValueError("Combined fragment area exceeds the cleanup budget.")
            kept_vertices = np.unique(triangles[keep_faces])
            vertex_map = np.full(len(points), -1, dtype=np.int32)
            vertex_map[kept_vertices] = np.arange(len(kept_vertices), dtype=np.int32)
            new_points = points[kept_vertices]
            face_vertex_mask = np.repeat(keep_faces, 3)
            # Remap primvar indices or values according to their interpolation.
            for var in UsdGeom.PrimvarsAPI(mesh).GetPrimvars():
                if not var.HasValue():
                    continue
                interpolation = var.GetInterpolation()
                selection = {"vertex": kept_vertices, "varying": kept_vertices, "uniform": np.flatnonzero(keep_faces), "faceVarying": np.flatnonzero(face_vertex_mask)}.get(interpolation)
                if selection is None:
                    if interpolation != "constant":
                        raise ValueError(f"Unsupported interpolation: {interpolation}")
                    continue
                attr = var.GetIndicesAttr() if var.IsIndexed() else var.GetAttr()
                original = attr.Get()
                attr.Set(type(original)([original[int(index)] for index in selection]))
            normals = mesh.GetNormalsAttr().Get()
            if normals:
                interpolation = mesh.GetNormalsInterpolation()
                selection = {"vertex": kept_vertices, "varying": kept_vertices, "uniform": np.flatnonzero(keep_faces), "faceVarying": np.flatnonzero(face_vertex_mask)}.get(interpolation)
                if selection is not None:
                    mesh.GetNormalsAttr().Set(Vt.Vec3fArray([normals[int(index)] for index in selection]))
                elif interpolation != "constant":
                    raise ValueError("Unsupported normal interpolation.")
            mesh.GetPointsAttr().Set(Vt.Vec3fArray.FromNumpy(new_points))
            mesh.GetFaceVertexCountsAttr().Set(Vt.IntArray.FromNumpy(counts[keep_faces]))
            mesh.GetFaceVertexIndicesAttr().Set(Vt.IntArray.FromNumpy(vertex_map[triangles[keep_faces]].reshape(-1)))
            mesh.GetExtentAttr().Set(Vt.Vec3fArray([Gf.Vec3f(*map(float, new_points.min(0))), Gf.Vec3f(*map(float, new_points.max(0)))]))
            if not np.array_equal(np.asarray(mesh.GetPointsAttr().Get()), points[kept_vertices]):
                raise ValueError("Surviving vertex coordinates changed.")
            mesh_results.append({"mesh": str(prim.GetPath()), "sourceFaces": len(triangles), "outputFaces": int(keep_faces.sum()), "removedFaces": int((~keep_faces).sum()), "removedAreaPercent": removed_area_percent, "sourceVertices": len(points), "outputVertices": len(new_points), "components": component_reports})
        if not mesh_results:
            raise ValueError("No meshes found.")
        if UsdGeom.Xformable(root).GetLocalTransformation() != original_root_matrix:
            raise ValueError("Reference root transform changed.")
        output_layer = directory / "cleaned.usdc"
        stage.GetRootLayer().Export(str(output_layer))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        if not UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(output_layer)), str(args.output)):
            raise ValueError("USDZ packaging failed.")
    if texture_hashes(args.output) != source_textures:
        raise ValueError("Texture contents changed during packaging.")
    output_stage = Usd.Stage.Open(str(args.output))
    if UsdGeom.Xformable(output_stage.GetDefaultPrim()).GetLocalTransformation() != original_root_matrix:
        raise ValueError("Packaged root transform changed.")
    report = {"schemaVersion": 1, "source": {"path": str(args.model), "sha256": digest(args.model)}, "output": {"path": str(args.output), "sha256": digest(args.output)}, "framePreserved": True, "survivingVertexCoordinatesPreserved": True, "textureBytesPreserved": True, "textureCount": len(source_textures), "meshes": mesh_results, "note": "Disconnected fragments only; approximate battery-based physical scale still requires device validation."}
    with report_path.open("x") as file:
        json.dump(report, file, indent=2, allow_nan=False)
        file.write("\n")
    print(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-area-percent", type=float, default=1.0)
    parser.add_argument("--max-faces", type=int, default=500)
    parser.add_argument("--min-gap-metres", type=float, default=0.05)
    args = parser.parse_args()
    if not 0 < args.max_area_percent <= 2 or args.max_faces <= 0 or args.min_gap_metres <= 0:
        parser.error("Use a positive gap/face count and area budget no greater than 2%.")
    try:
        cleanup(args)
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
