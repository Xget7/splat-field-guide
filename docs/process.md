# Field Guide process for coding agents

Read this before rerunning capture preparation or asserting capture, viewer, speech or AR acceptance.
Paths under `data/` are ignored author artifacts; missing inputs or receipts block the corresponding verification.
Use [agent checks](agents/checks.md) for mobile commands, `splat-tools/operations.md` for external preparation stages and [TASKS.md](../TASKS.md) for open physical acceptance.

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
The old local Brush download was removed during cleanup; retraining requires a separately supplied executable through `--brush`.
Physical frame rate, memory, load time and thermal measurements determine whether a smaller tier is needed.

## Part marking

The author marked eight parts through [sam_live.py](../pipeline/pack/sam_live.py), [live_api.py](../pipeline/pack/live_api.py) and [mark.html](../pipeline/pack/mark.html).
There are 43 part/photo keyframes across 30 photographs, with prompts and masks under `data/segment/marks/<part>`.
[mask_tools.py](../pipeline/pack/mask_tools.py) owns orientation, prompts and the part/keyframe list; [masks.py](../pipeline/pack/masks.py) owns accepted revisions.
Accepted sets live under `sets/<revision>` and `current.json`, with capture/revision checks protecting replacement and deletion.
Browser drafts are capture-bound; saved prompts restore without a new prediction.
The owner must review fuse-box/battery masks and all physical part boundaries.

### Local household annotation preview

On 2026-10-26, the author approved ten household parts across Kitchen / dining and Office, with thirteen distinct initial photographs from the 174-frame LiteReality capture.
The source audit and part correspondence were recorded in the local part review, which the owner later removed with the accumulated research notes.
`pipeline.pack.mark_local` validates the approved archive and photograph digests, preserves native JPEG bytes under `data/captures/litereality-20261026/jpg` and writes a capture receipt.
The shared editor accepts capture-specific parts and locations, English controls and explicit display rotation.
Its local preview persists prompts in capture/rotation-bound browser storage and exports drafts without accepting masks or invoking a model.
Saved-mask interface tests cover conversion between rotated preview masks and native layout, restored previews and rejection of another display rotation.
The full pipeline suite passed 21 tests, the editor suite passed three Node tests and Ruff passed.
Argent Chromium checks verified location navigation, a drawn box surviving reload, original source filenames, the owner-reported 1200 W heater information and zero model requests.
Live HTTP checks decoded all thirteen selected previews at 1062 x 1416 pixels.
Temporary QA prompts were cleared; local review records and the environment-inspector result remain under `data/analysis/litereality-20261026`.
The preview was left on loopback port 8765 for owner review.
Live capture-specific Modal inference, accepted household masks, camera adaptation, GS reconstruction, propagation and physical metric/mobile acceptance remain open.

The subsequent household SAM connection uses the private `sfg-sam-house` deployment and `sfg-house-captures` volume.
Only thirteen selected native photographs and the full capture identity manifest were uploaded, with the engine service and data left separate.
The first L4 warmup succeeded in 67.23 seconds, but a later request queued for L4 capacity after the short idle window.
The household worker now prefers L4 with A10G fallback and a ten-minute idle window.
A real panel prediction returned a nonempty 1062 x 1416 mask, with model score 0.9453125, in 25.59 seconds including startup.
That score is model confidence, not independently verified segmentation accuracy.
The same loopback web origin is now connected to live SAM, preserving its capture/rotation-bound browser drafts.
The author requested a sequential UI with descriptive text removed; the page now shows one part/photo step, Previous/Next, brief controls and status.
Argent verified a real mask appearing after a box prompt, with `preview=false` and no descriptive paragraphs.
The QA mask prompt was cleared without accepting a household mask revision.
The current full suite passes 23 Python tests, and the editor suite passes five Node tests including sequential ordering and accurate Saved state.
Accepted household annotations, camera adaptation, GS reconstruction, propagation and physical acceptance still require their own evidence.
The owner subsequently requested individual panel devices, so the approved plan now has fifteen parts and thirty sequential part/photo steps using the same thirteen source photographs.
Five provisional device identities belong to the electrical panel, with unknown functions and circuits; coupled handles remain within a single device proposal.
The live API and shared UI were checked against that expanded plan without accepting QA masks.
The owner then mapped the five panel positions to Main disconnect, Lighting, Outlets, Air conditioning and Hob.
The annotation plan retains those English names, the same persistent device IDs and four separately identified circuit labels.
These owner-reported functions do not establish a manufacturer's device classification or the exact individual equipment supplied by each circuit.

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
The [pinned manifest](../content/gol-trend-engine-bay/manifest.json) records 2438073 leaves and 2731791 nodes, a 301729408-byte SH1 tree and 2731807-byte node labels.
On 2026-10-26, `export.py --rebuild-tree` rebuilt the tree from the exported 2498597-splat cloud and labels on the Mac's M4 Pro: `splat_lod_build` removed 22756 haze and 37768 sparse splats and built in 1.69 s, the whole rebuild took about 2.9 s at 1.17 GB peak memory, and a second build was byte-identical.
The tree's SHA-256 is `87d7032b11bc39d8ab127dc540c4b349bc806f0646b67b5cedfcd8b7ec4134bb` and the node labels' is `5de528f44a5378dbbcd92f1f15997ccb47efe0ccffe9ffb4b375e7e85bee4420`.
The lifting report and source artifacts were absent, so the source-backed export checks did not run; the tree and node-label checks passed.
[export_checks.py](../pipeline/pack/export_checks.py) validates the app parser, digests, binary layout, source correspondence and bounds before publication.
Full source verification requires `publication.json` and the artifacts named by `manifest.sources`; a release archive omits these inputs.
[scripts/package-pack.sh](../scripts/package-pack.sh) creates the archive/checksum; [scripts/prepare.sh](../scripts/prepare.sh) verifies/reuses its files and prepares native, speech, JS and Ruby dependencies.
The bundled version is `data/pack/gol-trend-engine-bay/1`; runtime resources contain only the manifest and its tree and node-label files.
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
On 2026-10-26, `splat_snapshot` compared the Metal renderer of the SplatKit 9a1fd04 sync with main at 894dc01 on the Mac's M4 Pro, using the high engine-bay pack at the default 1206 x 2622 framing in A-B-B-A blocks of five runs.
Median GPU time per settled frame was 17.4 ms on main (14.0 ms render, 3.5 ms cull and sort, range 16.2 to 21.9 ms) and 12.8 ms on the sync (9.4 ms render, 3.1 ms cull and sort, range 11.9 to 14.2 ms).
The sync draws 2143581 of the 2438073 splats against main's 2323573, because upstream culls peaks below 2/255 and quads outside the view without main's 20 percent margin; the plain and highlighted captures look the same.
These single Mac frames are evidence for the sync, not iPad performance acceptance.
On 2026-10-26, the SH1 tree drew on the Mac's M4 Pro through `splat_snapshot`: 1529521 to 1553690 of 2731791 nodes at wide poses under the 1600000-splat budget, 491824 at a 0.4 m close-up with no quality-limited refinements, at about 6 to 10 ms GPU time and 663 MB peak memory; picks named the coolant reservoir, fuse box, valve cover and brake fluid reservoir.
The same day a Debug iPad simulator build loaded the tree with 2438073 leaves, first frame at 2.7 s, highlighted the engine in a wide view and picked and framed the coolant reservoir; the app does not show the drawn count.
Physical iPhone and iPad orbit and performance, and Android drawing of the tree, remain unchecked.

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

## V8 spatial assembly

The supplied `V8_Engine.usdz` is little.bucket's CC BY-NC 4.0 capture, separate from the Gol pack and AR reference.
[The pinned receipt](../apps/field-guide/assets/ar/v8-engine.json) records the source/prepared SHA-256 identities, 128 named parts and their original animation's visual assembly order.
[Preparation](../scripts/prepare_ar_assembly.cjs) samples time code 3250 and retains the original hierarchy, geometry and five textures while baking 331 animated attributes into a fixed pose.
The prepared archive is reproducible and 3710456 bytes; its imported RealityKit bounds are about 0.480 x 0.361 x 0.488 m, without establishing the physical engine's dimensions.
The current tour has 12 steps including the initially installed crankshaft, with cumulative boundaries 1, 9, 49, 73, 74, 89, 91, 109, 119, 122, 126 and 128.
Large parts remain sequential; authored contiguous piston bolts/nuts, bearing bolts, side bolts, head bolts and valve springs animate as repeated groups.
Translations take 1.35 seconds, future parts remain hidden, and the settled prefix advances only after every playback controller in a group completes.
Next during forward assembly completes the current requested step immediately and begins the following step; Next on the final animation completes the tour.
The UI accepts a skip only for the current command's native assembling phase and rejects another skip until its new request is acknowledged.
The native state machine reports a settled prefix, command identity and idle, assembling, separating or previewing phase, without a JavaScript assembly timer.

The crankshaft stays installed when moving backwards or restarting.
The equipment starts 50 centimetres above the detected surface, with zero-to-two-metre controls in 25-centimetre increments inside the compact glass menu.
Elevation is independent of uniform scale and survives relocation.
Complete preview preserves the tour position and restores original transforms, textures and opacity on return.

On 2026-10-07 the actual V8 RealityKit harness passed all 129 forward and 129 reverse prefixes, bootstrap, real grouped playback, partial reverse, grouped cancellation, preview return and interruption into the following step.
All 128 parts retained finite geometry, and scale and rotation preserved the equipment hierarchy.
Playback controllers require value equality for matching completion; object-reference identity misses the returned controller wrapper.
RealityKit retains a stopped Transform binding, so cancellation replaces that component with the stored pose before reporting idle.
Full-preview cancellation, including cancellation in the same frame it starts, preserves the requested view and actual settled prefix.

App/package lint and types, the signed Release build, signature verification and bundled V8 byte checks passed for this version.
The 12-step Release was installed and launched on xgetphone over the local network without phone UI automation.
Simulator navigation verified the library entry, visible little.bucket credit and the physical-device requirement.
Physical placement, tracking recovery, grouped animation, Next interruption, elevation and mechanical correctness remain unchecked in [TASKS.md](../TASKS.md).

## Maestro parts-tour smoke, 2026-10-27

Maestro CLI 2.12.0 ran `.maestro/parts-tour.yaml` twice unchanged on the booted Field Guide iPad simulator, iOS 26.5, at 1024 x 1366 points in portrait.
Both runs exited successfully using the installed Debug app and an owned Metro on port 8081, with no native rebuild or app source changes.
The flow starts from cleared local app state, opens the bundled Gol guide, chooses self-guided mode and starts the parts tour.
It waits for the visible coolant marker after native readiness, rejects loading and renderer-error states, selects the power steering step and returns to the first step.
Each step action checks both its selected accessibility state and the corresponding visible highlighted label.
The final screenshots were reviewed with the cloud and coolant label visible; there is no automated pixel comparison.
The two final artifact directories are `.work/maestro/2026-10-27_004129` and `.work/maestro/2026-10-27_004224`.

On cold launches, the first synthetic Start tap did not reach the button's press callbacks; a subsequent tap opened the tour.
The underlying cause of that input loss remains unverified.
The flow permits one retry only for Start navigation; step selections and their label assertions are not retried as a block.
Temporary touch instrumentation and diagnostic flows were removed.
App lint, TypeScript, all 674 Jest tests and flow formatting passed.
No voice session, instructor question, paid call or upload was made.
Android execution, phone layouts and physical acceptance were not checked by this flow.

## Splat tooling extraction, 2026-10-27

The owner requested a mobile-only repository and moved Python capture, annotation, reconstruction, training and export into `/Users/xget/Documents/splat-tools`.
Capture inputs, accepted annotations, external model checkouts and analysis results moved with the preparation pipeline; earlier relative `pipeline/` and preparation `data/` paths in this record describe their locations before extraction.
Field Guide retains mobile pack validation, bundling and release packaging, while preparation operations and the historical Flux pilot contract now live in the tooling workspace.

All six project Python build helpers were replaced by Node implementations; production build callers and CI now use the Node interfaces.
Nine focused pack/asset/artifact tests and the additional XCFramework packaging test passed, along with app lint, TypeScript and all 676 Jest tests.
Both iOS engine slices were rebuilt and the current XCFramework identity verified; the unsigned simulator app build passed against that artifact.
Read-only checks retained the cached Kokoro digest/license bundle and exact V8 baked-source behavior without replacing the prepared assembly.
Temporary extraction validation output was removed after checks.
Android execution and physical acceptance remain unchecked.
