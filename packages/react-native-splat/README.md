# react-native-splat

Typed Nitro views wrap the C++/Metal viewer and a separate RealityKit AR alignment check.
[ADR 0003](../../docs/adr/0003-shared-core-owns-viewer-behaviour.md) records ownership; [AGENTS.md](../../AGENTS.md#prepare-and-verify) has build, test and codegen commands.

## Engine preparation

The builder produces arm64 device/simulator slices in `ios/Frameworks/SplatKitCore.xcframework` using pinned SPZ/zstd dependencies.
`source-fingerprint.sha256` covers engine source, headers, shaders, CMake inputs and build scripts; complete matching artifacts are reused.
`--force` rebuilds; `SPLAT_BUILD_JOBS` controls concurrency and `SPLAT_IOS_BUILD_DIR` selects the CMake output directory.
The podspec rejects missing/stale artifacts and directs the caller to repository preparation.

## Interfaces

| Interface | Contract |
| --- | --- |
| [SplatView](src/SplatView.nitro.ts) | One engine per view; local SPZ/labels paths, manifest digests and expected source count |
| `onReady` / `onError` | Ready after the accepted cloud's first GPU frame; failure retains the accepted cloud |
| `orbit`, `dolly`, `frame` | Worklet calls enqueue render-thread mutations; radians and metres |
| `pick` | Worker-backed asynchronous part-label result |
| `project`, `drawnDirection` | Synchronous last-drawn-frame reads; float32 projection buffers, NaN behind the camera |
| [C interface](engine/splatkit-engine/include/splatkit/sfg.h) | `sfg_begin_load` reserves ownership; `sfg_load_request` validates optional identity and rejects stale work; `sfg_load` performs unverified standalone loading |
| [ARGuideView](src/ARGuideView.nitro.ts) | Local reference/landmarks and torch request; typed recognition, actual torch and optional telemetry events |

Drawing sleeps when unchanged and pauses while inactive.
The loader checks mapped-file digests and decoded source count on its worker before accepting content.
Dropping a view detaches callbacks and stops its render thread; outstanding calls retain the engine until completion.
C callbacks run on the reporting thread and must not wait for another engine call.

## Limits and diagnostics

The viewer's implemented adapter is iOS with an A14-class GPU or later; Android needs native/rendering adapters.
AR needs a physical iOS 27 iPhone and a separate reference; [acceptance](../../TASKS.md) covers recognition, registration and semantic camera masks.
Camera metadata arrives at 1 Hz and does not measure model confidence or inference speed.
Debug `FIELD_GUIDE_AR_DIAGNOSTICS=1` enables AR console metadata; viewer counters are exposed by `react-native-splat/src/diagnostics`.
Release keeps operational errors and disables diagnostic counters/console output.
Artifact tests use fake compilers; C-interface tests run without a GPU and Mac Metal tests exercise drawing.
