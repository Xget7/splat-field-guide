# splat-core

C++17 library under the renderer.
No graphics, no platform APIs, no React Native.

| Domain | Responsibility | Headers |
| --- | --- | --- |
| Formats | Decode `.spz` into a `SplatCloud` in the internal frame (+X right, +Y up, +Z back) | `splat/formats/`, `splat/core/` |
| Loading | Map a file, decode it and leave the cloud for the render thread | `splat/io/`, `splat/loading/` |
| Sorting | Morton reorder at load, for GPU cache locality | `splat/sorting/` |
| Math | Column-major matrices and vectors shared with the renderer | `splat/math/` |

Build/test commands are in [AGENTS.md](../../../../AGENTS.md#prepare-and-verify).
Set `SPLAT_FIXTURES_DIR` to a directory containing `kitchen_500k.spz` for the optional World Labs integration test.
