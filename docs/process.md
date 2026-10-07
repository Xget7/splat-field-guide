# Field Guide process for coding agents

Read this before rerunning capture preparation or asserting capture, viewer, speech or AR acceptance.
Paths under `data/` and `tools/` are ignored author artifacts; missing inputs or receipts block the corresponding verification.
Use [AGENTS.md](../AGENTS.md#prepare-and-verify) for commands, [pipeline/README.md](../pipeline/README.md) for stage contracts and [TASKS.md](../TASKS.md) for open physical acceptance.

## Capture

Polycam photo mode captured the author's 2010 Gol Trend 1.6 engine bay.
The raw export contains 124 HEIF photographs at 2832 x 2124, matching 768 x 576 LiDAR depth PNGs and per-photo camera JSON.
Photos form one band looking down into the bay; coverage underneath and close-ups need review.
The camera JSON has zero translations and unusable intrinsics, so it cannot supply training poses.
[ingest.py](../pipeline/pack/ingest.py) preserves originals/metadata, makes JPEGs and binds ordered photo names, bytes and digests in `data/capture/capture.json`.
Depth is retained as capture evidence; physical dimensions remain unverified.

## Poses

COLMAP 4.2 CPU reconstruction registered all 124 photos.
The full-resolution measurement on 2026-09-29 used about 16000 SIFT features per photo, produced 60308 points with 1.31 px mean error and took about 24 minutes on an M4 Pro with 24 GB RAM.
Guided CPU matching consumed 36 minutes on its first block; exhaustive matching completed in about 4 minutes, so avoid re-suggesting guided matching for this capture.
[poses.py](../pipeline/pack/poses.py) owns reconstruction; [cameras.py](../pipeline/pack/cameras.py) binds tracker cameras to photograph and COLMAP identities.
Artifacts are `data/capture/full/sparse/0`, `data/capture/full/poses.json` and [cameras.json](../pipeline/pack/cameras.json).
Preflight reprojection measured a median 1.33 px against COLMAP's 1.32 px on the retained reconstruction.
Exact command receipts are required before claiming deterministic reproduction of the measured run.

## Training

Brush 0.3.0 trained locally with Metal/WebGPU at 2832 px for 30000 steps.
The 2026-09-29 run took 3 h 8 min, averaging about 2.7 steps/s on the capture machine.
Growth reached 2696872 splats by step 16000, with a PLY of about 636 MB.
The trained artifact is `data/splat/engine_30000.ply`; [training.py](../pipeline/pack/training.py) owns the plan, input/tool identities and execution receipt.
The current recipe specifies seed 42, a 10M growth ceiling, SH degree 3 and exports every 2000 steps.
The measured run lacks complete COLMAP/Brush command receipts; the recipe is the explicit configuration for a repeat run.
Physical frame rate, memory, load time and thermal measurements determine whether a smaller tier is needed.

## Part marking

The author marked eight parts through [sam_live.py](../pipeline/pack/sam_live.py), [live_api.py](../pipeline/pack/live_api.py) and [mark.html](../pipeline/pack/mark.html).
There are 43 part/photo keyframes across 30 photographs, with prompts and masks under `data/segment/marks/<part>`.
[mask_tools.py](../pipeline/pack/mask_tools.py) owns orientation, prompts and the part/keyframe list; [masks.py](../pipeline/pack/masks.py) owns accepted revisions.
Accepted sets live under `sets/<revision>` and `current.json`, with capture/revision checks protecting replacement and deletion.
Browser drafts are capture-bound; saved prompts restore without a new prediction.
The owner must review fuse-box/battery masks and all physical part boundaries.

## Mask propagation

SAM runs on Modal; [sam_track.py](../pipeline/pack/sam_track.py) compares capture/view order and selected/all keyframes before propagating each part.
The current image pins SAM source `2345a4a`, Torch 2.8.0 and torchvision 0.23.0; tracking reports record source/checkpoint identities for new runs.
Reports and masks are under `data/segment/tracks/<part>`; the retained runs chose view order with all keyframes.
Held-out mean IoU is about 0.534 for fuse box, 0.746 for battery, 0.893 for engine and 0.963 for coolant reservoir.
Those are capture-frame comparisons, not independent physical acceptance; battery picks can select fuse-box labels.
[import_annotations.py](../pipeline/pack/import_annotations.py) binds supplied annotation bytes when source receipts are absent, without recovering the producing SAM checkpoint/environment.

## Lifting

[lift.py](../pipeline/pack/lift.py) and [lift_all.py](../pipeline/pack/lift_all.py) project the trained PLY into posed photographs and assign labels using visible mask evidence.
The retained report `data/segment/lift/all/report.json` covers 2696872 splats, leaves 1785457 unlabelled and drops 10747 labels away from the body.
Labels 1-8 identify coolant, power steering, brake fluid, battery, fuse box, engine, valve cover and intake manifold respectively.
`data/segment/lift/all/labels.npy` remains in trained PLY order.
Negative tracker scores do not vote; parent/child overlap and sibling claims are checked by preflight and interface tests.
Lifting consistency does not establish correct physical annotations.

## Export and preparation

[export.py](../pipeline/pack/export.py) crops/transforms cloud and labels together, including covariance and spherical harmonics.
Photo acceleration supplies gravity; an approximate 0.242 m battery dimension supplies scale, pending measurement on the real equipment.
The retained export report is `data/pack/gol-trend-engine-bay/1.report.json`.
The [pinned manifest](../content/gol-trend-engine-bay/manifest.json) records 2498597 source splats, a 63040843-byte cloud and 2498613-byte labels.
[export_checks.py](../pipeline/pack/export_checks.py) validates the app parser, digests, binary layout, source correspondence and bounds before publication.
Full source verification requires `publication.json` and the artifacts named by `manifest.sources`; a release archive omits these inputs.
[scripts/package-pack.sh](../scripts/package-pack.sh) creates the archive/checksum; [scripts/prepare.sh](../scripts/prepare.sh) verifies/reuses its files and prepares native, speech, JS and Ruby dependencies.
The bundled version is `data/pack/gol-trend-engine-bay/1`; runtime resources contain only the manifest and its cloud/labels files.
Two preparation runs passed with clean tracked state after the second; published clean-clone acquisition remains open.

## Viewer and Nitro checks

The retained SplatKit copy is under `packages/react-native-splat/engine`; its C interface owns load reservation, picking, highlight, orbit and framing.
Nitro specifications, generated glue and Swift views live in the package's `src`, `nitrogen` and `ios`.
On 2026-09-30, an iPhone 17 Pro simulator on iOS 26.5 Debug passed 100 mount/unmount cycles: 100 thread starts/stops and peak one render thread.
A real gesture called orbit on the main/UI thread, and render-thread onReady reached JS.
Hermes collection releases hybrid wrappers; onDropView must release the cloud/GPU resources and stop rendering independently of deinit.
On 2026-10-05, the iPad simulator verified pack digests in 111.83 ms and accepted 2438073 filtered splats from 2498597 source splats.
The host C-interface harness measured digest verification at 119.67 ms with the same files.
App/interface tests and a Debug iPad simulator build pass; physical stress, gestures, picking and sustained performance remain unchecked.

## Android

The API 36 arm64 tablet emulator uses 1280 x 800 at density 160, 6 GB RAM and four virtual CPU cores on an Apple M4 Pro.
Host-GPU Vulkan 1.2.306 through MoltenVK renders all 2438073 filtered SH3 splats; software SwiftShader stalls during upload without a reported allocation, feature or buffer-limit failure, and its cause is unresolved.
Fresh installations on 2026-10-06 produced these stage timings with networking disabled and the worktree's builds idle.

| Variant | SHA-256 ms | Decode/filter ms | Reorder ms | Upload ms | Ready ms |
| --- | --- | --- | --- | --- | --- |
| Debug | 74.71 | 1329 | 400 | 680 | 2693 |
| Release | 43.71 | 1109 | 350 | 704 | 2335 |

Ready includes validated asset copying and the first draw.
The isolated hash benchmark's summed per-file medians over three passes were 40.98 ms with ARM instructions and 385.65 ms with forced portable hashing for 65539456 pack bytes; both paths matched the cloud and labels manifest digests.
The arm64 APKs are 160587512 bytes for Debug and 111522403 bytes for Release.
The sampled reveal windows reported 20.0 ms GPU time at 48.4 submitted fps for Debug and 18.2 ms at 44.5 submitted fps for Release; these emulator samples vary and do not establish physical performance.
Release launched and rendered with Metro stopped and no port reverse, using its bundled JavaScript.
The [splat package](../packages/react-native-splat/README.md#android-adapter) describes the native build policy and hashing backends.
Emulator screenshots verify the engine bay, marine-blue part picking/dimming, procedure framing and scripted answers with networking disabled.
Installed English recognition assets report ready, and speech interfaces start/cancel; the muted emulator does not establish acoustic input, audible output or echo acceptance.
Physical Android performance, gestures and voice acceptance remain in [TASKS.md](../TASKS.md).

## Speech output

[react-native-on-device](../packages/react-native-on-device/README.md) implements quantized Kokoro v1.0 with af_heart on ONNX Runtime 1.30.0 CPU, plus Apple speech fallback.
The vendored FluidAudio English frontend uses Misaki and CPU-only BART G2P; [kokoro-models.json](../apps/field-guide/scripts/kokoro-models.json) pins every resource hash.
Verified resources total 104901281 bytes, including a 92361116-byte ONNX model and 522240-byte voice.
Output is mono float32 at 24000 Hz, with original UTF-16 word ranges and estimated timing.
Synthesis runs on a worker, plans bounded sentences, prewarms and discards cancelled results; the audio graph coordinates playback with continuous transcription.
Full Core ML Kokoro has crash advisories, MLX cannot execute on the iOS simulator, and standard sherpa Kokoro links GPL eSpeak; these are rejected synthesis paths.
Swift harnesses check text ranges, speech loss, cancellation and audio interruptions; the smoke tool is [kokoro-smoke-test.js](../tests/kokoro-smoke-test.js).
Physical pronunciation, cold/warm latency, interruption/echo, Release size and prepared-device airplane-mode behaviour remain unverified.

## AR reference

Object Capture built a textured model from the same 124 photographs, preserving the rigid engine-bay assembly with automatic object masking disabled.
Registration against the pack cameras held out 25 of 124; RMSE is 0.00133 pack units overall and 0.00138 held out, with orientation p90 0.24 degrees.
These residuals use estimated scale and do not measure AR alignment on the engine.
The cleaned model has 86422 triangles and bounds about 2.155 x 0.983 x 1.282 m; dimensions and Up/Front orientation need physical review.
The Create ML app (Object Tracking) trains the reference; a Standard/Upright run on macOS 26.7 took 4 h 26 min, so keep 30 GiB free before starting.
The installed Standard/Front reference from macOS 27.0.1 is format 2.0 and 47047755 bytes, kept in ignored `data/ar-reference/gol-trend-engine-bay/`.
CRC, both Core ML networks and the embedded USDZ digest passed integrity checks; recognition on physical equipment remains unverified.

## Landmarks and device checks

The app's [landmarks.json](../apps/field-guide/assets/ar/landmarks.json) holds four reviewed mesh picks and an identity referenceFromPack candidate, pending verification of the trained reference frame.
[ARGuideNativeView.swift](../packages/react-native-splat/ios/ARGuideNativeView.swift) displays points only with tracked object/camera state; full semantic masks are not connected.
A photo-screen measurement on 2026-10-02 recorded 49 one-second samples, 60.1 camera FPS on average, 46 normal-tracking samples, zero object anchors and zero session/load errors.
The owner reported an unsuccessful real-engine test without retained states, leaving detection, tracking and display undiagnosed.
Verify current-reference recognition, landmark pixel error, drift, recovery, illumination, negative scenes and actual torch behaviour on a physical iPhone before choosing the semantic overlay renderer.
