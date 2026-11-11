# Development and verification

Run installs, builds, tests and preparation with `nice -n 19` from the stated directory.
Use fakes for paid providers; deployment, upload and live paid requests require explicit authorization.

## Setup

Use an Apple silicon Mac, Xcode 27, Node 26+, npm, CMake, Ruby and Bundler.
The viewer requires iOS/iPadOS 26+ with an A14-class GPU or Android 10+ with Vulkan.
Android builds use JDK 17, SDK/build-tools 37 and NDK 27.1.12297006 with `ANDROID_HOME` configured.
After root preparation, run `nice -n 19 npm run ios` from `apps/field-guide`.
For Xcode, start Metro there with `nice -n 19 npm start` and open `ios/FieldGuide.xcworkspace`.
Debug needs reachable Metro; Release bundles JavaScript.
While connected, let automatic startup preparation finish and verify Models ready before local inference tests in airplane mode.
Check the course's separate offline availability in Downloads; verified voice and AI models do not install its scene, manual or modules.
Check pause/retry, offline startup without files and recovery when the route returns using fake transfers before a real download.
Allow microphone access separately.
A fresh installation without those files cannot provide local voice or generated answers.

## Prepare

`nice -n 19 scripts/prepare.sh` prepares dependencies, native frameworks, locked Gems and Pods without downloading guide content.
An optional `--manifest <file> --pack <archive>` validates and caches an explicit pack; it does not activate or select that pack for the app.
Packaging requires `nice -n 19 scripts/package-pack.sh --manifest <file> --pack <directory> --out <archive>`.
Both platform bundles select no packs by default.
Set FIELD_GUIDE_PACKS to space-separated <packId>/<packVersion> entries under data/pack when building, for example FIELD_GUIDE_PACKS=miris-pilot/1.
Startup reads those bundled manifests through the native BundledPacks object and the existing consumer parser; remote installation and activation remain pending.
Track the replacement in [tasks](../../TASKS.md).
After an engine source change, prepare before installing Pods; `packages/react-native-splat/scripts/build-ios-engine.sh --force` forces an engine rebuild.
Change Pods only with `bundle exec pod install` in `apps/field-guide/ios`, so the locked Bundler, CocoaPods and xcodeproj apply.

## JavaScript units

Each unit under `apps/`, `packages/` and `services/` installs with `npm ci` and carries its checks as `package.json` scripts: `lint`, `typecheck`, `test` and, in native packages, `codegen`.
Run Jest suites (app, `react-native-on-device`) with `npm test -- --runInBand`.
`services/instructor-proxy` has no typecheck script; use `npx tsc --noEmit -p .`.
`services/voice-agent` previews its agent configuration with `npm run plan -- --manifest <file>`.
The on-device package tests exercise preparation, cancellation, speech/answer adapters and audio ownership with fake providers.
ExecuTorch native libraries are provisioned by its postinstall script; if npm skips dependency scripts, run `nice -n 19 node node_modules/react-native-executorch/scripts/download-libs.js` from `apps/field-guide` before Pods or Gradle.
The app package selects only the XNNPACK backend and Phonemis library.

## Mobile pack tooling

From root:

```sh
nice -n 19 node --test tests/pack-build.test.cjs
```

Capture-stage and training checks run in the separate `splat-tools` workspace.
Before packaging regenerated Miris content, inspect its matching `manifest.json` and `publication.json` for source identities and full consumer validation, then run the validator against that exact directory.
A stripped-extension fallback is not validation of the complete pack, and archive download into a host cache is not mobile chunk delivery or activation.

## Native engine

The GPU-independent engine and app-owned C adapter, from root:

```sh
nice -n 19 cmake -S packages/react-native-splat/adapter -B build/tests -DCMAKE_BUILD_TYPE=Debug -DSFG_BUILD_TESTS=ON
nice -n 19 cmake --build build/tests --parallel 2
nice -n 19 ctest --test-dir build/tests --output-on-failure
```

This includes the imported core and engine suites and the adapter contract tests, using upstream portable SHA-256.

Metal, the iOS adapter and the shared core on the Mac, from root:

```sh
nice -n 19 cmake -S packages/react-native-splat/adapter/ios -B packages/react-native-splat/build/checks -DCMAKE_BUILD_TYPE=Release -DSFG_METAL_BUILD_TESTS=ON
nice -n 19 cmake --build packages/react-native-splat/build/checks --parallel 2
nice -n 19 ctest --test-dir packages/react-native-splat/build/checks --output-on-failure
```

## iOS app

Build without signing from root, selecting a simulator explicitly when validating a device layout:

```sh
nice -n 19 xcodebuild -workspace apps/field-guide/ios/FieldGuide.xcworkspace \
  -scheme FieldGuide -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/field-guide/ios/build/simulator \
  COMPILATION_CACHE_ENABLE_CACHING=NO CODE_SIGNING_ALLOWED=NO build
```

Keep DerivedData under `apps/field-guide/ios/build/` with compilation caching disabled, and delete the build directory afterward.
For an owned Debug Metro, pass `FIELD_GUIDE_METRO_HOST=<host>:<port>` to xcodebuild, with `localhost` for a simulator or the Mac's reachable address for a phone.

## Device acceptance

The obsolete demo Maestro flow and its npm command have been removed.
Future Miris flows must wait for native first-frame readiness and verify selected part identity, highlight and procedure navigation on an explicitly chosen device.
Screenshots and simulator checks do not establish physical performance acceptance.
No Miris pack opening on a simulator or device is recorded in [tasks](../../TASKS.md).
Verify grounded ExecuTorch answers and the remote/on-device/scripted fallback on both target platforms using supplied text.
Test a fresh installation, interrupted model preparation, restart in airplane mode, barge-in, route loss and cancellation while loading or generating.
No phone semantic encoder is part of this flow.

## Cleanup

Remove temporary build directories, test caches, logs and superseded plans after recording useful measurements and unresolved prerequisites in [tasks](../../TASKS.md).
Keep mobile runtime resources and publication receipts under `data/`; capture inputs, accepted annotations and trained output belong to `splat-tools/data/`.
Keep release `.xcarchive` files with their debug symbols for shipped-build diagnosis, and preserve raw recordings and pending plans until their work is complete.
`AGENTS.md` is a relative symlink to `CLAUDE.md`; edit the shared instructions through `CLAUDE.md`.

## Android

Keep Gradle caches, builds and owned AVDs under `.work/`.
From root, build with at most three workers:

```sh
JAVA_HOME=$(/usr/libexec/java_home -v 17) GRADLE_USER_HOME="$PWD/.work/gradle" nice -n 19 apps/field-guide/android/gradlew -p apps/field-guide/android :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=3
```

The React Native library links SplatKit's public `splatkit_vulkan` renderer target through `adapter/android`, without building the SDK's separate Kotlin JNI facade.
The app assets carry the imported SplatKit license, Android third-party notice bundle and PicoSHA2 license.
Set `ANDROID_HOME` to the installed SDK or provide its path in the ignored `apps/field-guide/android/local.properties` before building.

Use an API 36 arm64 tablet emulator with 6 GB RAM and host GPU rendering; software SwiftShader previously stalled during upload.
Use Argent when available for device interaction and keep other sessions' devices and servers untouched.
For an owned Debug Metro, reverse its port with `adb -s <serial> reverse tcp:<port> tcp:<port>`.
Stop only owned device/Metro processes and remove temporary build/cache output after verification.
Android Release without an upload key uses the debug key and is suitable only for local installation.

## GPU profiling

Keep the native engine and Metal checks above, the renderer counters in `packages/react-native-splat/src/diagnostics.ts`, and the upstream GPU documentation.
Use `splat_snapshot` from the Metal build to capture verified runtime files:

```sh
nice -n 19 packages/react-native-splat/build/checks/splat_snapshot --world <world.lodsplat> --labels <labels.bin> --out /tmp/miris.png
```

Record pack identity, device/OS, pose, drawn count, frame/load time, memory and thermal behavior with each measurement.
The prior M4 Pro fixture measured about 6-10 ms GPU time and 663 MB peak memory; this is historical context, not Miris device acceptance.
The native lifetime suite previously checked 100 mount/unmount cycles; retain stress checks and sanitizer coverage for draw-range ownership.
iOS Release disables diagnostic counters; Android load/frame timings appear in logcat.
Physical acceptance must use the Miris pack on the target hardware.

## Instructor configuration

Preparation copies `apps/field-guide/instructor.config.example.json` to ignored `instructor.config.json`; a null `proxyUrl` selects offline operation.
The proxy's `.dev.vars.example` lists local provider configuration; keys remain outside git and the app.
The Worker serves probes, typed NDJSON answers, signed agent sessions and authenticated custom-LLM SSE; its source and `wrangler.toml` own exact limits/models.
Incomplete streams must fail rather than commit partial answers.
Answer/session routes currently lack caller authentication; rate limits are not authentication.

For voice-agent setup, copy its `.env.example`, supply an available account `VOICE_ID`, Worker URL and provider/shared credentials, then run `nice -n 19 npm run plan -- --manifest <file>` in `services/voice-agent`.
The plan makes no remote requests or writes; inspect it before an explicitly authorized `nice -n 19 npm run sync -- --manifest <file>`.
Sync updates the shared secret, tools, dictionary and agent and saves IDs in ignored `agent.json`; preserve it for retries.
The agent key needs agent/workspace write, pronunciation dictionary read/write and voice read permissions; the Worker's key needs agent read access.
Use the same `AGENT_LLM_SECRET` on both sides and configure the returned `AGENT_ID` on the Worker.
Plan and sync require an explicit validated manifest; use reviewed Miris content before deployment.
For authorized distribution, `apps/field-guide/scripts/testflight.sh --no-upload` exports locally; signing needs a configured team and account.
