# Keep part labels aligned with SPZ in a sidecar

Status: accepted.

SPZ provides no per-splat extension for part labels.

Ship one byte per splat in labels.bin, aligned with cloud.spz.
Lift onto the trained PLY, then crop and transform labels/cloud together during export.

- Preparation verifies manifest file hashes before bundling.
- Source digests and part-to-label identity belong in the manifest, preserving binary compatibility.
- Native format/count checks cannot identify unrelated equal-count labels; filtering and Morton reordering carry labels with splats.
