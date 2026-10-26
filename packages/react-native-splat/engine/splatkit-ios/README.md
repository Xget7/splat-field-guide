# splatkit-ios

The Metal backend of the shared engine ([`splatkit-engine`](../splatkit-engine)).
Requires Apple GPU family 7 (A14 or M1) or later; `MetalSplatRenderer::create` returns null otherwise.

Each frame the GPU does the whole pipeline:

1. `visibility` projects every splat, drops what is behind the camera, outside the view, below a pixel, above the reveal or in a hidden part, and appends the rest keyed by view depth with their part styles applied.
2. A radix sort orders them nearest first.
3. Seven indirect draws composite them front to back ("under") into a half-float target, with a mask between draws so saturated pixels stop shading.
4. The backdrop fills what the capture leaves empty: the target is averaged into a small mip pyramid, each pixel takes the colour of the nearest covered area (a pull-push fill), two blur passes soften it, and it is drawn under the splats.
5. A last pass copies the target to the drawable.

Part labels sit in a stream of their own, one byte per splat beside the records, so the records stay those of upstream SplatKit.

The shaders are compiled at run time from source embedded by [`cmake/`](cmake), so the library is a plain static archive with no metallib to ship.

## Layout

```
Sources/SplatKitCore/rendering/metal/    renderer, one folder per stage with its MSL, included by device/Splat.metal
Sources/SplatKitCore/sfg/                the C interface's Metal renderer
tests/                                   GPU tests that run on a Mac
tools/splat_snapshot.mm                  draws a pack through the engine into a PNG, on a Mac
```

Build/test commands are in [agent checks](../../../../docs/agents/checks.md); the macOS Metal build also tests the shared core and C interface.
Set `SPLAT_SPZ_PATH` to an SPZ to enable `MetalRasterTest.ARealWorldFillsTheView`.
`splat_snapshot` uses the app's renderer to draw a labelled cloud from a pose, with selected parts highlighted.
From the repository root after the Metal build:

```sh
packages/react-native-splat/build/checks/splat_snapshot --spz data/pack/gol-trend-engine-bay/1/high/cloud.spz --labels data/pack/gol-trend-engine-bay/1/high/labels.bin --highlight 6 --pose 12.8,5,6.1 --out /tmp/engine.png
```
