# SplatKit audit for a pruned fork

Audited commit: dae04ad (tracked files only, read via `git show`).
HEAD (3266fce) is 6 commits ahead: revisioned CameraRequest in engine/JNI/ObjC, RN `camera` prop (41 files, +1582 lines).
Those commits overlap the camera work the fork needs, so fork from HEAD, not dae04ad, once the other agent's WalkCamera edits land.
LOC are raw lines (code + comments + blanks).
Total tracked: 439 files, about 30k lines of hand-written source outside lockfiles, gifs and benchmark artifacts.
Untracked `scripts/analyze_polycam.py` and `scripts/segment_polycam_parts.py` were not audited.

## 1. Inventory

Vocabulary: module, interface, implementation, depth, seam, adapter, leverage, locality (as in the codebase-design skill).

### Top level
- `.github/` (427, 8 workflows + templates) - CI, mirror.yml, release.yml, rn-contract.yml. DROP: release/mirror machinery. Keep one core+metal+android build workflow, rewritten.
- `apps/react-native/` (1192 lines of app code: `App.tsx` 480, `Hud.tsx` 468, `Flythrough.ts` 158, `Joystick.tsx` 86; rest is lockfiles/xcodeproj/gradle) - example RN app. REWORK: keep the bare-RN scaffold (Podfile, gradle, metro), replace all screens. Delete Flythrough, Joystick, most of Hud.
- `apps/ios-dev/` (1123) - native SwiftUI dev app. DROP: no native host in the fork.
- `apps/android-dev/` (640) - native dev app. DROP: same.
- `docs/` (3397 lines ex media, 10.5 MB gifs): `benchmarks/` 3022 lines of run artifacts, `BENCHMARKS.md` 214, `RELEASING.md` 68, `VALIDATION.md` 71, `AGENT_HARNESS.md` 22. DROP all. Write new short docs.
- `scripts/` (1570): `sdk_harness.py` 177, `benchmark_report.py` 114, `compare_captures.py` 130, `check_android_alignment.py` 104, `export-ios-source.py` 112, `wait-for-checks.sh`, `generate_world.py` (World Labs API) 126, `prepare-world.sh` 119, `build-ios.sh` 27, `package-ios.sh` 44, `lint-cpp.sh` 99, `fetch-validation-layers.sh`, `tests/` 375. DROP all except `build-ios.sh`/`package-ios.sh` (REWORK into one local xcframework build) and `lint-cpp.sh` (KEEP).
- Root docs: `CONTEXT.md` 112 (KEEP, cut to the terms the fork uses), `CONTRIBUTING.md` 102, `README.md` 92, `AGENTS.md` 6 (REWORK), `CHANGELOG.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `THIRD_PARTY_LICENSES.txt` 162 (REWORK: drop entries for deleted deps). DROP the rest: public-alpha ceremony.
- `Package.swift` (26) - binaryTarget to a remote release xcframework. DROP.
- `.clang-format`, `.clang-tidy`, `.editorconfig` - KEEP.

### packages/splat-core (C++17, 4354 src + 1770 include + 3699 tests + 746 tools)
- `include|src/formats/` SpzDecoder 270+33, SplatDecoder 31+38, SplatCloud.h 39. KEEP SpzDecoder and SplatCloud. DROP SplatDecoder (one-format dispatch, see section 4).
- `formats/Glb*` (368+46) and `TriangleMesh.h` - collider mesh IO. DROP.
- `io/MappedFile` (52+37) - mmap a path. KEEP.
- `loading/SplatWorldLoader` (143+83) - decode, reorder, LOD build, tile open, collider, pending handoff. REWORK to `load(spz, parts) -> World`.
- `sorting/SpatialOrder` (94+20) - Morton reorder. KEEP, add part ids to the permutation.
- `sorting/{AsyncSorter,DistanceSorter,SlabSorter,VisibilityPlanner,WorkerPool}` (490 src, 344 include) - CPU sort/cull fallback. DROP: both backends sort on GPU when compute exists (`SplatEngine.cpp:185`).
- `lod/` (792+113) - LodTree, LodSelection, LodFile (.lodsplat). DROP.
- `math/SymmetricEigen` (42+13) - used only by lod. DROP. `Vec3`, `Mat4`, `Frustum`, `Half` (305 include) KEEP (Frustum only if the picker needs it).
- `tiles/` (1102+406) - streaming tilesets. DROP.
- `navigation/` (947+196) - Collider, CharacterController, ColliderBuilder. DROP. The Amanatides-Woo ray walk in `Collider.cpp` is the only pick-related code and is triangle-specific.
- `diagnostics/TimingSummary` (23+21) - benchmark helper. DROP.
- `core/Result.h`, `CoordinateFrame.h` - KEEP.
- `tools/` (746): `ply2spz.cpp` 108 (KEEP as the only PLY to SPZ path if the pipeline needs it), `CloudEdit.h` 74, `splat_collider` 347, `splat-tile` 125, `splat_lod_build` 70. DROP the last three.
- `tests/` (3699): KEEP formats/Spz, io, loading, math, sorting/SpatialOrder (about 800). DROP navigation 735, tiles 874, lod 431, tools/CloudEdit, CPU-sorter tests.
- `third_party/splat-transform-LICENSE.txt`, `cmake/dependencies.cmake` (35) - REWORK: drop nlohmann_json (GLB/tileset only), keep spz + gtest.

### packages/splatkit-engine (C++17, 1387 src + 843 include + 1006 tests)
- `engine/SplatEngine` (522+233) - the frame loop and everything else. REWORK (section 4).
- `camera/WalkCamera` (326+126) - walk + orbit + gyro + look-at. REWORK into OrbitCamera: keep orbit/dolly/animateOrbit/setAttitude (`WalkCamera.cpp:209-260`), drop collider, walker, velocity, scripted look-at.
- `rendering/SplatRenderer.h` (144) - the GPU seam, 28 virtuals. REWORK (section 5).
- `rendering/RenderPolicy` (173+122) - policy resolution against per-backend support. DROP (section 4).
- `rendering/GpuLayout` (85+42) - 32-byte `GpuSplat` + SH packing shared by both APIs. KEEP, deep, earns its keep.
- `diagnostics/StatsPublisher` (138+116) KEEP trimmed; `Benchmark` (111+41) DROP; `Log` (32+19) KEEP.
- `tests/` (1006): KEEP GpuLayoutTest; REWORK FrameOrderTest (its `RecordingRenderer` implements the full 28-virtual interface, `FrameOrderTest.cpp:10`). DROP WalkCameraTest 261, RenderPolicy tests, BenchmarkTest.

### packages/splatkit-ios
- `Sources/SplatKitCore/rendering/` Metal (MetalSplatRenderer.mm 769+181, MetalVisibility 176+92, MetalRadixSort 100+50, MetalWorld 136+41): KEEP as backend. `MetalLOD` (186+55) DROP. `MetalTileRaster` (134+40) DROP (hybrid raster, iOS-only, experimental).
- `rendering/shaders/` (1052): Splat.metal, SplatProjection.metalh, SplatVisibility, SplatRadixSort, SplatRaster, SplatTypes, PrepareIndirect KEEP. `SplatLOD.metal` 212 and `SplatTileRaster.metal` 244 DROP.
- `Sources/SplatKitCore/engine/SKSplatEngine.mm` (354+213) - ObjC facade over SplatEngine. REPLACE by the C API (section 5).
- `Sources/SplatKit/` Swift (921): SplatMetalView 509, RenderThread 283, TouchLook 70, MotionInput 59. DROP (RN is the only host; section 3).
- `tests/` (1933): MetalRadix, MetalVisibility, MetalWorld, MetalRaster KEEP as the macOS GPU regression net. MetalLOD 341, MetalTileRaster 431 DROP.
- `distribution/`, `README.md`, `cmake/embed*.cmake`: distribution DROP; embed-text KEEP (shader source compiled at device start, no metallib).

### packages/splatkit-android
- `src/main/cpp/rendering/vulkan/` (3993): VulkanContext, Swapchain, RenderTarget, FrameLoop, GpuBuffer, SplatPipeline, VisibilityPass, RadixSort, VulkanFrameCompute, VulkanSplatRenderer, Vma KEEP. `LodSelection` (245+80) and `DebugTrianglePipeline` (148) DROP.
- `src/main/cpp/shaders/` (810): splat.vert/frag, visibility.comp, prepare_indirect, 4 radix kernels KEEP. `lod_selection.comp` 149, `triangle.*` DROP.
- `src/main/cpp/jni/SplatKitJni.cpp` (471, 37 natives) + `engine/AndroidEngine` (118) - REWORK: JNI shrinks to a thin C API adapter.
- `src/main/cpp/tests/` (1220, adb-run) - KEEP RadixSort, VisibilityPass, VulkanFrameCompute, GpuBuffer; DROP LodSelection.
- `src/main/java/com/splatkit/` Kotlin (1498): SplatSurfaceView 417, SplatEngine.kt 264, RenderThread 247, RenderPolicy 184, TouchInput, MotionInput, JoystickView, SplatHudView, CameraPose, etc. DROP most; the RN view keeps only surface + Choreographer + sensors.
- `build.gradle.kts` (76) - has the Maven publish plugin and coordinates. REWORK (fold into the RN library module).

### packages/react-native-splatkit
- `src/` (924): `performance.ts` 529 (policy authority, presets, auto/manual), `contracts.ts` 151, `specs/SplatViewNativeComponent.ts` 231. REWORK: keep the codegen spec, delete performance.ts.
- `ios/` (919): SplatKitRNView.mm 578, SplatKitViewComponentView.mm 269. REWORK (god object, section 4).
- `android/src/main/` (701): SplatKitView.kt 453, ViewManager 105, PolicyProp 65, WorldSession 67. REWORK.
- `tests/` (540) - source-regex tests that assert TS, ObjC and Kotlin agree. DROP; replace with a small contract test.
- `distribution/`, `scripts/fetch-ios-xcframework.cjs`, `scripts/codegen*.cjs`, `package-lock.json` - distribution and fetch DROP; codegen scripts REWORK.

## 2. Dependency graph

```
splat-core:  Result, CoordinateFrame, math/*, SplatCloud
             SpzDecoder -> SplatCloud ; SplatDecoder -> SpzDecoder
             SpatialOrder -> SplatCloud ; LodTree -> SplatCloud, SymmetricEigen
             SplatWorldLoader -> {SplatDecoder, GlbDecoder, LodFile, SpatialOrder, MappedFile, Collider, TiledWorld, LodTree}
             AsyncSorter -> {DistanceSorter -> WorkerPool, LodTree} ; TileStreamer -> {SlabSorter, TileScheduler, TileLoader}
splatkit-engine -> splat-core
  SplatEngine.h includes WalkCamera, Benchmark, StatsPublisher, SplatRenderer, SplatWorldLoader, AsyncSorter, VisibilityPlanner, TileStreamer (SplatEngine.h:13-22)
  SplatRenderer.h -> SplatCloud, LodTree, RenderPolicy
Metal / Vulkan backends -> splatkit-engine (implement SplatRenderer) ; iOS CMake add_subdirectory ../splatkit-engine, Android ../../../../splatkit-engine
Swift SplatKit -> SKSplatEngine.h ; Kotlin SplatKit -> JNI -> AndroidEngine -> SplatEngine
react-native-splatkit iOS -> SKSplatEngine.h via prebuilt xcframework ; Android -> SplatSurfaceView (Maven or :splatkit)
```

Wrong-way leaks:
- The renderer interface knows about LOD and tiles: `SplatRenderer.h:9` includes `LodTree.h`, and `uploadLodWorld`, `createSlab`, `uploadTile` (`:82-87`) are on the GPU seam. Every backend must know LOD trees and slabs to draw a cloud.
- The engine loads a collider and hands it to the camera, so the loader, camera and navigation are one knot: `SplatWorldLoader.h:13` includes `Collider.h` and `TiledWorld.h`; `WalkCamera.h:7-8` includes `CharacterController.h` and `Collider.h`.
- The platform layer knows navigation: `SKSplatEngine.h` exposes `SKCharacterSettings`, Kotlin has `CharacterSettings`, `JoystickView`, `setWalkVelocity`, and the RN spec has `character`, `collider`, `walkVelocity`.
- The RN bridge knows engine internals. `SplatViewNativeComponent.ts` (231 lines) carries 11 render-policy fields, 16 capability fields (`policyRaster`, `policyTileSize`, ...), LOD and residency capacities. `SplatKitRNView.mm:413-475` sets `setSplatBudget`, `setResidencyBudget`, `setMaxShDegree` before decode.
- The RN iOS view bypasses the Swift SDK and drives `SKSplatEngine` directly (`SplatKitRNView.mm:355-357`, own CADisplayLink on the main thread) while Android drives `SplatSurfaceView` on a render thread. The two RN adapters have different threading models.
- `SplatEngine` reaches the renderer's policy through `deviceCapabilities().policy.fallback` (`SplatEngine.cpp:46`), so the engine constructor depends on a backend reporting a resolved policy.
- Build coupling by relative path: `splatkit-android/.../CMakeLists.txt:29`, `splatkit-ios/CMakeLists.txt:22`, `apps/react-native/android/settings.gradle:19`.

## 3. Duplication across iOS and Android

Quantified (lines, both platforms together):
- Attitude to camera remap: Swift `MotionInput.swift` (59), Kotlin `MotionInput.kt` (53), ObjC `SplatKitRNView.mm:204-258` (55). Three copies of the same interface-orientation switch. Only "read the sensor" is platform work. Move the remap into C++: `setAttitude(deviceToReference[9], interfaceRotation)`. Saves about 110 lines and one bug class.
- Touch look: `TouchLook.swift` (70), `TouchInput.kt` (62), `SplatKitRNView.mm:84-135`. Pixels-to-radians and sensitivity belong in C++ (`orbit(dxPixels, dyPixels)`). The recognizer stays platform. New pinch and pick taps must not be written 3 times.
- Render-policy struct, 11 fields, hand-mirrored 6 times: `RenderPolicy.h`+`.cpp` (295), `SKSplatEngine.h:47-75` plus support/capabilities structs (about 100), `RenderPolicy.kt` (184), Kotlin/JNI float-array marshalling in `SplatEngine.kt` and `SplatKitJni.cpp` (about 150), `performance.ts`+`contracts.ts` (680), RN spec + `PolicyProp.kt` + ObjC policy code (about 250). About 1650 lines. The header admits it: "keep them in step" (`RenderPolicy.kt:3`, `RenderPolicy.h:9`). The product needs zero of it (constants suffice).
- Engine facade: `SKSplatEngine.mm`+`.h` (567) vs `SplatEngine.kt` (264, 37 `external fun`) + `SplatKitJni.cpp` (471) + `AndroidEngine` (118). About 1400 lines whose only job is one-call-per-method forwarding into `SplatEngine`.
- Public view API: `SplatMetalView.swift` (509) and `SplatSurfaceView.kt` (417) expose the same about 45 members (load, camera, anchor, orbit, dolly, focus, render scale, budgets, SH, policy, stats, lifecycle), plus `SplatKitRNView.mm` (578) and `SplatKitView.kt` (453) re-expose them for RN. Four views per platform pair, one job. Setter range clamps repeat (`renderScale` 0.1-2, `shDegree` 0-3, `cullMargin`) in Swift, Kotlin, ObjC, Kotlin RN and C++.
- Render thread + vsync loop: `RenderThread.swift` (283) and `RenderThread.kt` (247), same design, different code. RN iOS then does it a third way (main-thread display link).
- Load request gating (generation counter, loader queue, stale-event drop): `SplatKitRNView.mm:413-475` vs `WorldSession.kt` (67) vs `RenderThread` loader executors. Belongs in one C++ "load, then report by request id" call.
- Wire enums by hand: events 0-4 (`SplatEngine.kt:60`, `SKSplatEvent`, `SplatEngine.h:92`), pose floats 5 and stats floats 7 (`SplatKitJni.cpp:24-26`), error-code strings (`SplatKitRNView.mm:9-14` vs Kotlin).
- Already shared correctly in C++: camera math, orbit, framing (`SplatEngine.cpp:29-40`), FOV/near/far, dirty-flag redraw, sort orchestration, stats, world loading, Morton reorder, SH and record packing (`GpuLayout`). That is good leverage; the duplication is all in the glue above it.
- Legit duplication (two GPU APIs): splat projection in MSL (`SplatProjection.metalh` 163) and GLSL (`splat.vert` 173); visibility and radix sort in both shader languages plus two host encoders. This is the real seam, not waste.

## 4. Shallow modules, pass-throughs, god objects

Deletion test results:
- `SplatDecoder.cpp` (31): switch with one case. Delete it and complexity vanishes (pass-through). `SplatFormat` enum has one value; hypothetical seam.
- `RenderPolicy` family (about 1650 lines, section 3): delete it and complexity vanishes, because only constants remain. Pass-through of a configuration surface nobody in the fork sets. `computeTile` "not implemented by any adapter" (`performance.ts:9`), HiZ "not implemented anywhere yet" (`RenderPolicy.h:84`), `alphaThreshold` "fixed at 1/255 today".
- `SKSplatEngine.mm`, `SplatEngine.kt`, most of `SplatKitJni.cpp`: each method is one forward. Deleting them would put marshalling back in each caller, so an adapter is needed, but a 30-function C API replaces 3 hand-written facades (section 5).
- `SplatMetalView.swift`, `SplatSurfaceView.kt`: shallow, wide (about 45 members, up to 40% comments) facades for native hosts. Fork has no native host: delete.
- `SplatStats.kt`/`SKSplatStats`/TS stats event: three shapes of the same 14 numbers.
- `Benchmark`, `TimingSummary`, `docs/benchmarks`: harness code for a product feature the fork does not ship.
- `WorldFrameCompletion.h` (23), `DebugTrianglePipeline` (148, "Milestone check pipeline", `DebugTrianglePipeline.h:11`): vestigial.
- `GpuLayout`: passes the deletion test (both backends and both languages would each repack SH and halves). Deep, keep.
- `SplatWorldLoader`: earns its keep for the mutex handoff and reorder, but the interface has 8 entry points for 3 unrelated worlds (file, LOD, tiles) plus colliders. Shallow because callers must know the order of `setBudget`, `setMaxShDegree`, `loadWorld`, `takeWorld`.
- `AsyncSorter` + `DistanceSorter` + `WorkerPool` + `VisibilityPlanner`: deep and well tested, but only reachable when `sortsOnGpu()` is false (`SplatEngine.cpp:185`), i.e. a fallback path both backends flag as `LOGW` (`MetalSplatRenderer.mm:67`).

God objects:
- `SplatEngine` (233 h + 522 cpp). Responsibilities: policy resolution (`:49-69`), load orchestration for 3 world kinds (`applyPendingLoads` `:142-209`), camera facade, LOD/tile/CPU/GPU-sort branching (`requestVisible`, `streamTiles`, `takeSortResult`, `render` `:323-520`), stats sampling, benchmark driver, event sink, framing.
  Seven camera methods repeat the same three lines `planner_.invalidate(); redrawNeeded_ = true; publishPose();` (`:213-274`).
  Split: `World` (cloud, part ids, bounds, picker), `OrbitCamera` (state + framing + animation), `Engine` (owns Renderer, dirty-flag from camera revision, frame), `Stats`. Dirty tracking becomes `camera.revision() != lastDrawn`.
  The GPU-sort path needs no orchestration: `ranges_.assign(1, {0, count})` (`:494`), the whole world as one range.
- `SplatKitRNView.mm` (578): display link + proxy, layer attach, CoreMotion, pan gesture, policy revisions, capability event, world and collider generation gating, stats and pose timers, lifecycle/recycle. Split: C++ owns load state, attitude remap, pose/stats sampling; ObjC keeps layer, display link, event emit.
- `SplatKitView.kt` (453): prop-transaction commit (`commitProps` `:207`), lifecycle, surface creation, timers, 6 emitters. Same split.
- `AndroidEngine` is not a god object: 118 lines, a composition root (Vulkan context, frame loop, renderer) plus the one `awaitingWorldFrame_` event glue. Its logic (world-frame-ready event) belongs in `Engine`.
- Big backend files: `MetalSplatRenderer.mm` (769; `draw` alone is `:480-760`, mixing hardware path, hybrid tiles, capture, stats), `VulkanSplatRenderer.cpp` (433), `VisibilityPass.cpp` (506). After dropping tiles and LOD, `draw` shrinks by about 120 lines.

## 5. Seams

Real seams (two production adapters):
- `splatkit::SplatRenderer` (`SplatRenderer.h:42`): Metal and Vulkan. Real, but too wide: 28 virtuals, 12 default no-ops (LOD, slab, tile, present times, screen-tile stats, policy). Wide interface = shallow.
- Shader/pass algorithms (visibility cull, radix sort, projection): two adapters (MSL, GLSL) behind the engine's frame.
- Platform host (surface, thread, lifecycle, sensors): iOS and Android. Real, but expressed as two unrelated Swift/Kotlin APIs plus ObjC/JNI hand-facades. Should be one C ABI.
- RN Fabric codegen spec: two adapters (ComponentView.mm, ViewManager.kt). Real.
- `GpuSplat` 32-byte record (`GpuLayout.h:15`): a data seam, both backends.

Hypothetical (one adapter, or test double only):
- `SplatDecoder`/`SplatFormat` (one format); `Collider` (one implementation, exists for walking); `EventSink` std::function (one consumer per platform, fine as a plain callback); `OrderSource cpu|gpu` (cpu exists only as fallback); `RasterStrategy` (only Metal hybrid, experimental); `RenderPolicySupport` (per-backend axis nobody varies); `RecordingRenderer` (test double, so tests can observe the seam but it does not make it two-adapter).
- `.lodsplat` vs SPZ, tileset vs single file: one real world kind for the fork.

Where the renderer seam should sit in the fork (parts, pick, camera live once in C++):
- C++ owns: SplatCloud incl. `partIds`, Morton reorder, `OrbitCamera` and framing, part-highlight state (a per-part state table: normal, selected, dimmed, tint), CPU picker, dirty flag, stats, load by request id.
- Backend owns GPU work only. Proposed `Renderer` interface (about 10 members): `ready()`, `drawExtent()`, `generation()`, `upload(const SplatCloud&)`, `draw(const FrameParams&)` where FrameParams = view, proj, cameraPosition, shDegree, `partStates` (small array, uploaded as a uniform or tiny buffer each change), `lastGpuMillis()`, `takePresentTimes()`, `deviceDescription()`.
- Highlight costs no re-sort and no re-upload: vertex stage reads `partId` from the splat record, looks up `partStates[partId]`, multiplies color/alpha. The GPU sort/cull order buffer holds splat indices (`Order` binding in `splat.vert`), so it is unaffected.
- `GpuSplat.lodAlpha` (`GpuLayout.h:20`) is dead once LOD goes (only nonzero for LOD nodes). Rename it `partId` (uint32 slot, 32-byte record unchanged); shaders read it at `splat.vert:157` and `SplatTypes.metalh:29`.
- Pick never touches the GPU: `Engine::pick(x, y) -> optional<{splatIndex, partId, distance}>`. Ray construction already exists in `SplatEngine::focus` (`SplatEngine.cpp:253-263`) and `WalkCamera::focus`.
- Platform seam: one `splatkit.h` C ABI (create, attach surface/layer, resize, frame(t), load, orbit/dolly/attitude, animateTo, setSelection, pick, stats, destroy). ObjC++ and JNI are 1:1 adapters over it; both call sites disappear from Swift/Kotlin.

## 6. Load path and splat order

Where splats change order or count today:
1. Decode: `SpzDecoder.cpp:182-268`. spz `unpackGaussians` is index-preserving; SH truncation (`:30-50`) drops bands, not splats; coordinate conversion (`:222`) is per splat. A non-finite splat fails the whole file (`:263-266`) instead of dropping it. Order and count are preserved.
2. Morton reorder: `SplatWorldLoader.cpp:63` calls `reorderSpatially` (`SpatialOrder.cpp:49-92`), a stable 3-pass radix sort on 30-bit Morton codes, then `permute` per attribute (`:87-91`): positions, covariances, colors, alphas, sh. This is the only reorder in the SPZ path, and it is the first place a sidecar goes out of alignment.
3. LOD build (only when `budget > 0`, `SplatWorldLoader.cpp:70-74`): `buildLodTree` (`LodTree.cpp:115-280`) makes new interior nodes via `merge` and re-lays nodes root-first level by level (`:254-280`). Leaves no longer sit at their file index and interior nodes have no part id. Fork sets budget 0 and deletes it.
4. `.lodsplat` (`SplatWorldLoader.cpp:36`, `LodFile.cpp:167`): skips `reorderSpatially` entirely; order comes from the file. Delete.
5. Tiles: `TileBuilder.cpp` partitions and reorders per tile (calls `reorderSpatially`). Delete.
6. Offline converter: `ply2spz.cpp:46-79` with `CloudEdit.h:14-53` `filter`/`pruneAlpha`/`--keep N` decimation drops splats. Any sidecar must be produced after the final filter, or `filter` must carry ids. A sidecar built from the PLY index space then converted with `--prune-alpha` misaligns silently.
7. Upload and draw: `GpuLayout.cpp:packSplatRange` indexes by identity; `MetalWorld.mm:108`, `VulkanSplatRenderer.cpp:154`. The visibility pass emits an `order` of splat indices. No further reorder. The CPU sorter also produces indices, not a permuted cloud.
8. The cloud does not survive the load: `SplatEngine.cpp:189` moves `positions` into the sorter and the rest is freed after upload. A CPU picker needs positions + covariances (and partIds) kept resident (about 40 bytes per splat, 40 MB per 1M).

Proposal:
- Add `std::vector<uint16_t> partIds;` to `SplatCloud` (`SplatCloud.h`), empty when absent, `count()`-sized when present.
- Loader signature: `load(spzBytes, partsBytes?) -> Result<World>`. Validate `partIds.size() == cloud.count()` before reordering; mismatch is an error, not a truncation.
- `SpatialOrder.cpp:87-91` gets one more line: `permute(cloud.partIds, 1, order)`. Better, make `permute` a member walk over all SoA fields so a new field cannot be forgotten (`SplatCloud::reorder(order)`), and keep `SpatialOrderTest` asserting every field follows.
- Sidecar file: `magic u32, count u32, ids u16[count]`, file order = decoded SPZ order (decoder preserves it). A header `count` mismatch fails the load.
- Test: load a cloud where splat k has position encoding k and part id f(k), reorder, assert `partIds[i] == f(decodedIndex(i))` through the whole pipeline including `GpuLayout` pack.
- Pipeline rule: run any prune/decimate before segmentation, or make `CloudEdit::filter` carry `partIds`.

## 7. Comment density and dead code

Measure (full-line comments; trailing comments not counted, so a floor): overall about 9% of non-blank lines. splat-core 9%, engine 10%, iOS 7%, Android 9%, RN 8%.
The problem is concentrated in API-facing files, not the implementation:
- `SplatSurfaceView.kt` 40% (143 comment lines of 362), `SplatRenderer.h` 36%, `SplatEngine.h` 34% (69 of 202), `SKSplatEngine.h` 28%, `WalkCamera.h` 27%, `SplatMetalView.swift` 22%, `SplatViewNativeComponent.ts` 21%, `RenderThread.kt` 20%, `LaunchArgs.swift` 53%.
- Content: KDoc restating property names, device folklore in headers ("costs 40% of the frame on Adreno 640", `SplatEngine.h:111-113`; "8 ms for 500k splats at 48 bytes", `GpuLayout.h:10`), and mirror-warnings ("keep in step") that exist only because of duplication.
- C++ implementation files are lean (7-15%); the worst are `ColliderBuilder.cpp` 60 lines and `MetalSplatRenderer.mm` 49. Keep comments that explain a why (Morton stable sort, "two passes leave the result in scratch", NaN canonicalisation in `GpuSplat`).
Strip: KDoc/DocC on forwarding members, all policy/benchmark/"Adreno" numbers (move to one PERF note if wanted), `Mirror of the host contract` paragraphs.
Dead or vestigial:
- `DebugTrianglePipeline` (148), `triangle.vert/frag`.
- CPU-sort fallback in both renderers plus `OrderSource::cpu` branches (`VulkanSplatRenderer.cpp:245,273`).
- `RasterStrategy::computeTile`, `enableHiZOcclusion`, `alphaThreshold` knobs (declared, plumbed through 6 layers, never varied).
- Android `JoystickView` (86), `SplatHudView` (69); `loadWorld(bytes)` overloads; `SplatStats.loadedSplatCount` alias (`SplatMetalView.swift:60`).
- 3022 lines of benchmark JSON/CSV/logs and 10.5 MB of gifs in `docs/`.

## 8. Proposed target layout

Legend: [I] inherited as-is (alpha quality), [R] inherited then reworked, [N] new.
```
engine/                        one C++17 CMake project, no platform headers
  cloud/    SplatCloud.h [R]   SoA + partIds; reorder(order) permutes every field
            SpzDecoder [I]     spz bytes -> SplatCloud, file order preserved
            PartsFile [N]      sidecar bytes -> partIds, validated against count
            MortonOrder [R]    stable spatial reorder, returns the permutation
  math/     Vec3 Mat4 Frustum Half [I]
  world/    World, WorldLoader [R]   (spz path, parts path) -> Result<World> with bounds + part table
  camera/   OrbitCamera [R]    orbit, dolly, gyro attitude(+rotation), animateTo(bounds) with framing
  pick/     SplatPicker [N]    ray vs ellipsoids over Morton-ordered cloud -> {index, partId, t}
  parts/    PartStates [N]     per-part normal|selected|dimmed + tint, small GPU-ready array
  render/   Renderer.h [R]     the GPU seam, ~10 members; FrameParams; GpuLayout [I] (32 B, partId slot)
  engine/   Engine [R]         owns World+Camera+Renderer, dirty flag, frame(t), events, stats
  capi/     splatkit.h [N]     C ABI, the platform seam: create/attach/resize/frame/load/camera/select/pick
  tests/    spz, order+parts alignment, camera, picker, layout, engine-with-fake-renderer
backends/
  metal/    MetalRenderer.mm, MetalWorld, MetalVisibility, MetalRadixSort, shaders/*.metal [I minus LOD/tiles; +partId lookup N]
  vulkan/   VulkanRenderer, Context, Swapchain, FrameLoop, Pipeline, Visibility, RadixSort, shaders/*.{vert,frag,comp} [I minus LOD/debug; +partId N]
react-native/                  one library, one package.json
  src/      SplatView.tsx, types.ts, codegen spec [R]: props world{spz,parts}, camera, selection, onPick, onReady
  ios/      SplatViewComponentView.mm [R]: CAMetalLayer, CADisplayLink, CoreMotion -> splatkit.h
  android/  SplatViewManager.kt, SplatView.kt [R]: SurfaceView, Choreographer, sensors; cpp/ CMake builds Vulkan .so + JNI over splatkit.h (no separate Gradle project)
  scripts/  build-xcframework.sh [R] local only; SplatKit.podspec [R]
app/                           bare RN app [R scaffold, N screens]: engine-bay view, part list, tap-to-select
pipeline/                      Python [N]: capture -> segment -> prune -> spz + parts.bin (+ order check)
docs/                          CONTEXT.md [R], ARCHITECTURE.md [N], parts-format.md [N]
```
One-line interfaces:
- `WorldLoader::load(spz, parts) -> Result<World>`
- `Renderer::draw(FrameParams)`; `Renderer::upload(SplatCloud)`
- `OrbitCamera::{orbit, dolly, setAttitude, animateTo, view, revision}`
- `Engine::{frame, load, select, pick, orbitPixels, pinch}` (all through `splatkit.h`)
- `SplatPicker::pick(ray) -> optional<Hit>`

## 9. Top 10 risks of the prune

1. iOS packaging assumes a prebuilt xcframework: podspec `vendored_frameworks` (`SplatKitReactNative.podspec:10`), `fetch-ios-xcframework.cjs` at prepack, `package-ios.sh` copies license files from `_deps` (`:38`, nlohmann, zstd). Dropping nlohmann or moving CMake output breaks the script. Fork must build the xcframework locally and gitignore it. Memory notes apply: build outside `~/Documents`, wipe `build/ios-distribution` after an Xcode upgrade.
2. Android Gradle wiring: RN `android/build.gradle:38` picks `:splatkit` if present else Maven (`0.1.0-alpha09`); example `settings.gradle:19` includes it by relative path and pins the vanniktech plugin only because `splatkit-android/build.gradle.kts:48` applies `mavenPublishing`. Remove the plugin and publish block, make the dependency unconditional, or fold the CMake into the RN module.
3. Relative CMake paths chain engine, core and backends (`../../../../splatkit-engine`, `../splatkit-engine`, `../splat-core`). Moving directories breaks all three. `splat-core/CMakeLists.txt` lists 27 sources explicitly, and `tests/CMakeLists.txt` files list test sources, so every deletion is a CMake edit. Do the merge into `engine/` in one commit with a green macOS build.
4. Hand-mirrored wire formats break silently: JNI float arrays are positional (`kPoseFloats=5`, `kStatsFloats=7`, policy fields), event IDs 0-4, codegen spec vs ObjC props. Deleting policy or stats fields on one side without the others yields shifted values, not compile errors. Replace with the C ABI and structs before deleting.
5. JNI symbol and package coupling: `SPLATKIT_JNI` macro hardcodes `Java_com_splatkit_engine_SplatEngine_` (`SplatKitJni.cpp:19-20`), `splatkit.map:7` exports `Java_com_splatkit_*`, `consumer-rules.pro` keeps Kotlin names. Renaming the package or class requires all three. `-fvisibility=hidden` will hide a mis-named symbol and the failure is a runtime `UnsatisfiedLinkError`.
6. RN tests are source-regex contracts (`android-adapter.test.cjs`, `ios-adapter.test.cjs`, `contracts.test.cjs`, 540 lines) and `scripts/codegen.cjs` asserts props across TS/ObjC/Kotlin. They fail on any prop change and must be deleted or rewritten with the new spec; `codegenConfig` in `package.json` names `SplatKitView` and `SplatKitViewComponentView`.
7. Shader build lists: Vulkan `shaders.cmake` compiles 11 named shaders (`CMakeLists.txt:33-45`); Metal `Splat.metal` (7 lines) includes the `.metalh`/`.metal` set and `embed-text.cmake` embeds it as text compiled at device start. Deleting `SplatLOD.metal`/`SplatTileRaster.metal` requires trimming includes and the `SplatShaderSource` embed; a stale include only fails at runtime on device.
8. Test suite that must go or be rewritten: `FrameOrderTest`/`SplatEnginePolicyTest` (full 28-virtual fake renderer), `WalkCameraTest`, `RenderPolicyTest`, `BenchmarkTest`, Metal LOD/TileRaster tests, Android `LodSelectionTest`, splat-core navigation/tiles/lod tests (about 2000 lines). Keep the Metal Radix/Visibility/World/Raster and Vulkan Radix/Visibility/FrameCompute tests: they are the only GPU regression net (Vulkan ones are adb-only and need `SPLATKIT_ANDROID_BUILD_TESTS`).
9. Removing the CPU sort fallback makes devices without working compute (`compute_ == nullptr`, `gpuSort_ == false`) render nothing. Decide explicitly: fail at `isAvailable` with a clear error, or keep `DistanceSorter` as a test oracle only. Also the 16 KB page-size link flags and `arm64-v8a` only (`build.gradle.kts` abiFilters) must be preserved.
10. Retaining the cloud for picking changes memory and threading: the engine frees it after upload today (`SplatEngine.cpp:189`), the render thread owns state, and pick arrives from the UI thread. Pick needs its own snapshot (immutable `shared_ptr<const World>`) and the part-state table must be a value swapped on the render thread, or highlight and pick race with load. Related: HEAD is 6 commits ahead of dae04ad with new camera-request plumbing, and the working tree has uncommitted `WalkCamera.cpp` edits; pick one base commit before pruning to avoid merging camera work twice.
