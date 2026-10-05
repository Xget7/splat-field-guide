# react-native-splat

The iOS viewer and AR registration experiment, exposed as typed Nitro Views.
The shared C++ engine owns cloud decoding, part labels, highlighting, picking and framing.
Swift owns UIKit, Metal surfaces, thread scheduling and the separate RealityKit AR session.

## Preparation

From the repository root, run `scripts/prepare.sh` before building the app.
It installs the pack and native prerequisites before CocoaPods runs.
To build only this package's engine, run:

```sh
SPLAT_BUILD_JOBS=3 nice -n 19 packages/react-native-splat/scripts/build-ios-engine.sh
```

The builder needs macOS, Xcode with the iOS SDK, CMake, Ruby and Python 3.
The first build fetches pinned SPZ and zstd dependencies through CMake, so it needs network access.
It produces an arm64 device slice and an arm64 simulator slice in `ios/Frameworks/SplatKitCore.xcframework`.
Shader source is embedded in the library and compiled by Metal at runtime.
The framework records a SHA-256 fingerprint of engine source, headers, shaders, CMake inputs and preparation scripts.
A matching complete artifact is reused, and `--force` rebuilds it.
CocoaPods rejects missing or stale artifacts and names `scripts/prepare.sh` in the error.
`SPLAT_IOS_BUILD_DIR` changes the CMake build directory, and `SPLAT_BUILD_JOBS` limits parallel compilation.
Build directories and frameworks are generated files.

## Viewer interface and lifecycle

`SplatView` mounts one native engine for each view.
Its `source` accepts local SPZ and optional labels paths, with relative paths resolved inside the app bundle.
The cloud and label bytes retain the existing pack format.
The native loader checks label count and decoding, while preparation verifies manifest file hashes.
`onReady` fires after a frame of the current cloud finishes on the GPU.
`onError` distinguishes loading, label mismatch and GPU failure.
A failed replacement keeps the previously accepted cloud.

Gesture worklets can call `orbit`, `dolly` and `frame` through the view's hybrid reference.
Angles are radians and distances are metres.
Mutations enqueue render-thread work.
`pick` resolves on a worker, while `project` and `drawnDirection` synchronously read the last drawn frame.
Projection uses packed float32 input and output buffers, and writes NaN for points behind the camera.
The render loop sleeps when the cloud, camera and highlight are still, and pauses while the application is inactive.
Dropping a view detaches its callbacks and ends its render thread; outstanding callers retain the engine until their calls finish.

The C interface lives in `engine/splatkit-engine/include/splatkit/sfg.h`.
Platform adapters reserve each replacement with `sfg_begin_load` before scheduling decoding, then call `sfg_load_request` with that request identity.
A superseded request returns false without publishing a cloud or emitting ready or failure.
Pending upload and delayed GPU completion use the same ownership rule.
`sfg_load` combines reservation and blocking decoding for synchronous callers.
The render thread owns drawing and camera mutations; the documented load, pick and snapshot calls may run on other threads.
Event callbacks run synchronously on the reporting thread and must not block waiting for another engine call.

## AR interface and limits

`ARGuideView` receives a local `.referenceobject`, a registration/landmarks JSON path and `torchEnabled`.
`onTrackingStateChanged` carries the generated `ARTrackingEvent` type, with recognition state, actual torch state and optional `ARTrackingTelemetry`.
Camera metadata is sampled at 1 Hz and is not a model confidence or inference-rate measurement.
Torch changes do not restart recognition.
The app reconciles a failed request with actual hardware state before the next toggle.

The current experiment requires a physical iPhone on iOS 27 with camera access.
It recognizes the equipment reference and draws four RealityKit pins through the calibrated reference-to-pack transform.
It does not render splat-mask highlights over the camera.
The simulator reports an unsupported state, and physical alignment still needs validation against the real engine bay.
Optional `FIELD_GUIDE_AR_DIAGNOSTICS=1` console metadata is available only in Debug.

## Checks and regeneration

Run JavaScript checks from this package:

```sh
npm test
npm run lint
npm run typecheck
npm run codegen
```

The artifact test substitutes compiler processes and verifies reuse, force rebuilding and stale-artifact rejection without compiling an engine.
After changing a Nitro spec, run `npm run codegen`, commit `nitrogen/generated`, then run `pod install` in `apps/field-guide/ios`.
The ordinary package entry point does not construct spike diagnostics.
Explicit Debug tooling can import `getSplatDiagnostics` from `react-native-splat/src/diagnostics`.
Counters and orbit logs are disabled in Release; operational errors remain logged.

Run the engine tests from the repository root:

```sh
nice -n 19 cmake -S packages/react-native-splat/engine/splatkit-engine -B packages/react-native-splat/build/tests -DCMAKE_BUILD_TYPE=Debug -DSPLATKIT_ENGINE_BUILD_TESTS=ON
nice -n 19 cmake --build packages/react-native-splat/build/tests --parallel 3
nice -n 19 ctest --test-dir packages/react-native-splat/build/tests --output-on-failure
```

These tests exercise the shared core and C interface without a GPU.
One optional World Labs kitchen test skips when its external fixture is absent.
The iOS renderer also has macOS Metal tests under `engine/splatkit-ios/tests`.

## Platform support

Only the iOS native adapters are implemented today.
The app targets iOS 26; the Metal renderer requires an A14-class GPU or later, and equipment recognition has the separate iOS 27 requirement above.
Android app scaffolding and Nitrogen namespace configuration do not provide Android implementations.

| Android area | Required work and reusable implementation |
| --- | --- |
| Renderer | Import/adapt the Vulkan backend, which is not in this copy; add an Android library build, Kotlin Nitro view, JNI, surface lifecycle and frame scheduling; reuse the C++ engine and C interface for cloud, highlight, picking and framing. |
| AR | Supply camera tracking and equipment recognition with a calibrated pose, tracked/untracked state, pin rendering, torch control and camera permission; full splat-mask AR highlighting is additional work on both platforms. |
| Resources | Package SPZ, labels and registration files, then resolve pack-relative paths to readable native files instead of `Bundle.main`. |

An Android port is deferred.
