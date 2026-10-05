# react-native-splat

Typed Nitro views over the C++/Metal viewer and a separate RealityKit AR alignment experiment.
Read [ADR 0004](../../docs/adr/0004-shared-core-owns-behaviour.md) for ownership, [app setup](../../apps/field-guide/README.md) for prerequisites, and [AGENTS.md](../../AGENTS.md#prepare-and-verify) for installation, checks and codegen.

## Engine preparation

From the repository root:

```sh
SPLAT_BUILD_JOBS=3 nice -n 19 packages/react-native-splat/scripts/build-ios-engine.sh
```

The builder produces arm64 device and simulator slices in `ios/Frameworks/SplatKitCore.xcframework`, fetching pinned SPZ/zstd dependencies on the first build.
It records engine source, headers, shaders, CMake inputs and build-script identities in `source-fingerprint.sha256`; complete matching artifacts are reused, and `--force` rebuilds them.
`SPLAT_IOS_BUILD_DIR` changes the CMake output directory; CocoaPods rejects missing/stale artifacts and directs the caller to `scripts/prepare.sh`.

## Interfaces

| Interface | Contract |
| --- | --- |
| [SplatView](src/SplatView.nitro.ts) | One native engine per mounted view; `SplatSource` supplies local SPZ/labels paths, their manifest `splatSha256` and `labelsSha256`, and `expectedSplatCount` before filtering |
| `onReady` / `onError` | Ready after the current cloud's first GPU frame; load, digest, count or GPU failure retains the previously accepted cloud |
| `orbit`, `dolly`, `frame` | Worklet calls enqueue render-thread mutations; angles in radians, framing distances in metres |
| `pick` | Worker-backed asynchronous part-label result |
| `project`, `drawnDirection` | Synchronous last-drawn-frame reads; packed float32 projection buffers, NaN behind the camera |
| [C interface](engine/splatkit-engine/include/splatkit/sfg.h) | `sfg_begin_load` reserves ownership before asynchronous decode; `sfg_load_request` accepts optional identity data and rejects superseded loads/uploads/completions; standalone `sfg_load` combines reservation and unverified decoding |
| [ARGuideView](src/ARGuideView.nitro.ts) | Local reference/landmarks and torch request; generated `ARTrackingEvent` reports recognition, actual torch state and optional `ARTrackingTelemetry` |

Drawing sleeps when unchanged and pauses while inactive.
The loader checks the mapped file digests on its worker thread before decoding, then checks the source count before accepting the cloud.
Rejection uses the existing `onError` events; it does not publish the rejected replacement.
Dropping a view detaches callbacks and ends its render thread; outstanding calls retain the engine until completion.
C callbacks run on the reporting thread and must not wait for another engine call.

## Limits and diagnostics

| Area | Current limit |
| --- | --- |
| Viewer | iOS adapters only, A14-class GPU or later; [Android work](../../README.md#platforms) deferred |
| AR | Physical iPhone on iOS 27; four RealityKit pins, candidate registration and pending physical validation; semantic camera masks proposed |
| Telemetry | Camera metadata at 1 Hz, separate from model confidence or inference rate; torch changes preserve the recognition session |
| Debug | `FIELD_GUIDE_AR_DIAGNOSTICS=1` enables console metadata; `getSplatDiagnostics` comes from `react-native-splat/src/diagnostics` |
| Release | Spike counters, orbit logs and opt-in AR console diagnostics disabled; operational errors retained |

The package tests cover artifact reuse/force/staleness with fake compilers; C-interface tests run without a GPU, and macOS Metal tests exercise drawing.
The optional World Labs kitchen fixture can skip; physical stress and AR acceptance remain in [TASKS.md](../../TASKS.md).
