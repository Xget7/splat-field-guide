# Keep part labels aligned with SPZ in a sidecar

Status: accepted.

SPZ provides no per-splat extension for part labels.

Ship one byte per splat in labels.bin, aligned with cloud.spz.
Lift onto the trained PLY, then crop and transform labels/cloud together during export.

- Preparation verifies file digests before bundling; native loading verifies the supplied digests and decoded splat count.
- The optional schema-1 `sources` extension binds PLY-order labels, capture/reconstruction, lifting and content identities to the exact part-to-label mapping.
- SPZ/SFGL bytes stay compatible; filtering and Morton reordering carry labels with splats.
