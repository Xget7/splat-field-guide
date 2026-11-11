# splatkit-android

Native `SplatSurfaceView`, Vulkan renderer, walk/fly camera, touch and gyroscope input.
Requires Android 10/API 29, Vulkan 1.1 and arm64-v8a.
GPU ordering additionally requires supported compute subgroups and buffer limits.
An arm64 emulator can test functionality; it is not a phone performance measurement.

## Install

Maven Central `0.1.0-beta.2` hands walking to the host: the view looks only, and `walkVelocity`, the character settings and the collider come from the app.
See the [changelog](../../CHANGELOG.md) and [releases](https://github.com/Xget7/splatkit/releases).
Avoid alpha05, which corrupts Adreno sorting.

```kotlin
dependencies {
    implementation("io.github.xget7:splatkit-android:0.1.0-beta.2")
}
```

For current source, use `implementation(project(":splatkit"))` in the included `apps/android-dev` host, or include `packages/splatkit-android` as a Gradle module.

This README describes current source; APIs listed under Unreleased in the [changelog](../../CHANGELOG.md) require a source build until a new artifact ships.

## Host

```kotlin
import android.app.Activity
import android.os.Bundle
import com.splatkit.SplatSurfaceView
import java.io.File

class WorldActivity : Activity() {
    private lateinit var splats: SplatSurfaceView

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        splats = SplatSurfaceView(this)
        setContentView(splats)
        splats.listener = object : SplatSurfaceView.Listener {
            override fun onWorldReady(splatCount: Int) { /* hide loading UI */ }
            override fun onWorldFailed(message: String) { /* show error */ }
        }
        // Put your world in app storage first. File loading avoids a Java-heap copy.
        splats.loadWorld(File(filesDir, "world.spz"))
    }

    override fun onResume() { super.onResume(); splats.resume() }
    override fun onPause() { splats.pause(); super.onPause() }
    override fun onDestroy() { splats.release(); super.onDestroy() }
}
```

Loads decode asynchronously; ready/failure callbacks run on the main thread.
Unlike iOS, loads are not checked against the memory the app has left, so a world it cannot hold can get it killed; prepare a large world as a `.lodsplat` or a tileset.
`onWorldReady` means uploaded; `onWorldFrameReady` fires once after a world draw's Vulkan fence completes.
Keep the view resumed while waiting; completion does not prove visible pixels, presentation scanout or full streamed detail.
Use `loadCollider(File)` for optional GLB walk collision; otherwise the camera flies.
SPZ v1-v4 and offline `.lodsplat` worlds are supported, and `loadTiledWorld` streams a `splat-tile` tileset.
A PLY is converted offline by [`scripts/prepare-world.sh`](../../scripts/prepare-world.sh), which also builds `.lodsplat` trees and colliders.
Compose can host the view through `AndroidView`; forward the same lifecycle.
The [React Native package](../react-native-splatkit/README.md) maps its `policy` prop to `applyRenderPolicy`.

## Controls

| API | Contract |
|---|---|
| `loadWorld(bytes/file)`, `loadCollider(bytes/file)` | Load asynchronously; prefer files for large inputs. |
| `loadWorld(file, maxShDegree, splatBudget, residencyBudget)` | Applies these load options on the render thread before this file's decode. |
| `loadTiledWorld(tileset)` | Streams a tiled world from its `tileset.json` within `residencyBudget`. |
| `cameraPose` | Read/set position in meters and yaw/pitch in radians. |
| `applyCameraRequest(request)`, `cameraState` | Apply a complete first-person or orbit request after world framing; completion reports acceptance and the effective state on the main thread. |
| `lookAt(from, target, up)` | Teleport facing a target with an explicit up vector. |
| `setAnchor`, `orbit`, `dolly` | Orbit a world point in temporary fly mode; angles are radians and distance is metres. |
| `focus(x, y)` | Pick an anchor through normalized view coordinates against the collider; false keeps the previous anchor. |
| `animateOrbit(degrees, degreesPerSecond, easeInOut)` | Run a finite engine-driven orbit and idle again when it finishes. |
| `applyQuality(RenderQuality)` | Apply preset; individual properties can override it. |
| `renderScale` | Render-target scale, 0.1–2; changing it changes image quality. |
| `maxFramesPerSecond` | Most frames a second drawn, 1 to 240; null, the default, draws every vsync. 60 halves the GPU work of a 120 Hz panel. |
| `shDegree`, `maxShDegree` | Draw/load SH cap, 0–3. Set the load cap before loading. |
| `sourceFrame` | `CoordinateFrame` the next world, its tiles and collider were written in, read when each load is called; `CoordinateFrame.parse("rfu")` names any of the 48. Null, the default, keeps the SPZ tag, else `rub`, and glTF `rub`. Untagged World Labs Marble exports need `CoordinateFrame.RDF`; `.lodsplat` ignores it. |
| `splatBudget` | LOD capacity for subsequent loads; zero disables automatic tree construction. Prebuilt LOD files still select a hierarchy. GPU maximum: 4M. |
| `residencyBudget` | Resident splats for subsequent streamed worlds, separate from LOD selection. |
| `cullMarginDegrees` | Margin a streamed tileset keeps loaded around the view, so a turn finds tiles already there. |
| `linearBlending` | Optional linear-light blend; not the default trained-space compositing. |
| `setMotionEnabled`, `setWalkVelocity`, `walk` | Gyroscope, continuous forward/right velocity in meters per second, and a single step in meters. |
| `look(deltaYaw, deltaPitch)` | Turns the camera by radians, for a look pad or mouse. |
| `touchLookEnabled`, `lookSensitivity` | Whether a one-finger drag turns the camera, and radians per pixel dragged. |
| `setCharacter(CharacterSettings)`, `character` | The walker's shape in walk mode: `eyeHeight`, `bodyRadius`, `stepHeight`. |
| `setLens(LensSettings)`, `lens` | Vertical `fieldOfViewDegrees` (10-120) and `depthRange` (near and far planes, at most 100,000:1); null keeps the default 65 degrees and 0.05-200. Applies at once and reframes the default orbit; false keeps the previous lens. |
| `cameraPoseIntervalMillis`, `cameraPoseListener` | Milliseconds between pose callbacks, and the callback itself; 0, the default, never reports. |
| `isAvailable`, `gpuDescription` | Renderer availability and driver description. |
| `applyRenderPolicy(policy)`, `renderPolicy`, `deviceCapabilities` | Per-instance renderer policy, re-validated on the render thread. `sortDepth`, `lodErrorPixels` and `lodSplatLimit` apply with GPU visibility, `subpixelThreshold` from the next frame on both order paths; other fields fall back with a warning each. |
| `readStats()` | FPS, frame/GPU/sort ms, loaded/drawn and screen-tile counts. Drawn counts and GPU ms describe the newest frame the GPU finished, also while nothing redraws, and are current when `onWorldFrameReady` fires. |
| `startBenchmark(seconds)` | Turn-in-place benchmark logged under `SplatKit`. |

Unavailable GPU timings/tile counters report zero, not zero-cost execution.
Loaded source splats differ from drawn nodes and GPU-resident hierarchy records.
`loadedShDegree` is the harmonics degree the world holds on the GPU, the ceiling for what `shDegree` draws.
Stats float transport exactly represents integers through 16,777,216.
Optional `com.splatkit.ui.SplatHudView` and `JoystickView` are host conveniences.

## GPU contract

GPU LOD → visibility/compaction → stable radix → indirect hardware draw.
16-bit keys and two-pass sorting are the default; a `sortDepth` of 32 keeps the full float depth in four passes.
Above 4M visibility survivors the draw fails closed with diagnostics.
Source capacity depends on `maxStorageBufferRange` and memory; full LOD hierarchy residency is required.
Parents and subpixel rejection are approximate.
There is no universal 10M or 30/60 FPS guarantee.

[Architecture, limits and evidence](docs/VULKAN.md) |
[Agent harness](../../docs/AGENT_HARNESS.md) |
[iOS SDK](https://github.com/Xget7/splatkit-ios)

```sh
cd apps/android-dev
./gradlew :splatkit:assembleRelease :splatkit:testDebugUnitTest
```

Tests and emulator evidence do not replace physical Adreno/Mali validation or reference-image acceptance.
Source builds enable 16 KB ELF alignment; CI checks every packaged shared library and APK ZIP alignment with `scripts/check_android_alignment.py`.
Artifact alignment checks do not replace execution on a 16 KB device.

## Native tests on a device

The `splatkit_vulkan_*_test` executables need a real Vulkan device and run without a surface.
`scripts/lint-cpp.sh` links all of them in CI; running them is a manual device step.
Reuse an ignored build directory in this checkout with the NDK toolchain flags from that script plus `-DSPLATKIT_ANDROID_BUILD_TESTS=ON`.
The first configure fetches dependencies over the network.

```sh
BUILD=build/android-tests
cmake -S packages/splatkit-android/src/main/cpp -B "$BUILD" \
  -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-29 -DANDROID_STL=c++_static \
  -DSPLATKIT_ANDROID_BUILD_TESTS=ON
cmake --build "$BUILD" --target splatkit_android_tests
adb shell mkdir -p /data/local/tmp/splatkit-tests
(set -e; for t in "$BUILD"/tests/splatkit_vulkan_*_test; do
  adb push "$t" /data/local/tmp/splatkit-tests/
  adb shell "cd /data/local/tmp/splatkit-tests && ./$(basename "$t")"
done)
```

The writable device working directory also lets the pipeline-cache test create its temporary file.
Each test exits 0 on success; `splatkit_vulkan_buffer_test` and `splatkit_vulkan_upload_pressure_test` accept `--small` for a device with little memory, which skips their large cases.


Terminal GPU failures emit public event 5 (GPU_FAILED / gpuFailed), distinct from world load failure and GPU-completed frame readiness (4).
