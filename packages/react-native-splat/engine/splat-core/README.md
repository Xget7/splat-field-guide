# splat-core

C++17 library under the renderer.
No graphics, no platform APIs, no React Native.

| Domain | Responsibility | Headers |
| --- | --- | --- |
| Formats | Decode `.spz` into a `SplatCloud` in the internal frame (+X right, +Y up, +Z back) | `splat/formats/`, `splat/core/` |
| Labels | Decode and encode SFGL sidecars, one part label per splat or per tree node | `splat/formats/PartLabels.h` |
| Filtering | Compact haze/sparse splats with labels and every attribute | `splat/filtering/` |
| LOD | Build a labelled LOD tree from a cloud, read and write `.lodsplat`, and prepare the selection data the GPU walks | `splat/lod/` |
| Loading | Map a pack's `.lodsplat` tree and node labels, check their digests and leave the tree for the render thread | `splat/io/`, `splat/loading/` |
| Math | Column-major matrices and vectors, splat covariances and the symmetric eigen solve that merges them | `splat/math/` |

`tools/splat_lod_build` turns a pack's cloud and labels into the shipped tree and node labels.
Build/test commands are in [agent checks](../../../../docs/agents/checks.md).
Set `SPLAT_FIXTURES_DIR` to a directory containing `kitchen_500k.spz` for the optional World Labs integration test.
