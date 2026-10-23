# Working on Field Guide

## Before editing

- **Names:** read [CONTEXT.md](CONTEXT.md) before introducing or renaming equipment, guidance, pack or AR concepts.
- **Ownership:** read [design](docs/specs/field-guide-design.md#ownership) and the relevant [ADR](docs/adr/) before changing an interface, ownership, model order, pack format or platform choice.
- **Evidence:** read the agent [process record](docs/process.md) before checking capture measurements, native bridge/speech decisions or provisional AR claims.
- **Pipeline:** read [pipeline/README.md](pipeline/README.md) before touching capture stages, annotations, export or pack preparation.
- **Splat:** read [react-native-splat](packages/react-native-splat/README.md) before changing its view, engine lifecycle or generated interface.
- **Speech/model:** read [react-native-on-device](packages/react-native-on-device/README.md) before changing audio, transcription, generation or speech resources.
- **Acceptance:** read [app setup](apps/field-guide/README.md), [REQUIREMENTS.md](REQUIREMENTS.md) and [TASKS.md](TASKS.md) before changing acceptance claims.

Proceed when the owned unit, caller/test interface and required evidence are identified.
Source/simulator checks leave physical acceptance explicitly unchecked.

## Prepare and verify

Run from the stated directory with `nice -n 19`, using fakes for paid services.

| Directory | Purpose | Command |
| --- | --- | --- |
| Root | Prepare demo (release via authenticated `gh`, or `--pack <archive>`) | `scripts/prepare.sh` |
| Root | Build/reuse engine | `packages/react-native-splat/scripts/build-ios-engine.sh` |
| App and native packages | Install, lint, types | `npm ci`, `npm run lint`, `npm run typecheck` |
| `apps/field-guide` | App tests | `npm test -- --runInBand` |
| Each native package | Codegen | `npm run codegen` |
| `packages/react-native-splat` | Artifact tests | `npm test` |
| `packages/react-native-on-device` | JS/Swift harnesses | `npm test -- --runInBand` |
| `services/instructor-proxy` | Tests/types | `npm test`, `npx tsc --noEmit -p .` |
| `services/voice-agent` | Install, tests, types, config preview (Node 26+) | `npm install`, `npm test`, `npm run typecheck`, `npm run plan` |
| Root | Pipeline tests | `uv run --project pipeline python -m pytest pipeline/tests` |
| Root | Pipeline preflight | `uv run --project pipeline python -m pipeline.pack.preflight` |
| Root | Marking-page test | `node --test pipeline/tests/test_mark_page.cjs` |
| Root | Pipeline lint | `uvx ruff check --select F,E9 pipeline scripts` |
| Root | Verify exported pack | `uv run --project pipeline python -m pipeline.pack.export_checks --pack data/pack/gol-trend-engine-bay/1 --labels data/pack/.sources/lift/labels.npy` |
| Root | Package archive | `scripts/package-pack.sh` |
| `apps/field-guide` | Ruby dependencies | `bundle install` |
| `apps/field-guide/ios` | Pods | `bundle exec pod install` |

Preparation installs all three app/native development dependency sets and the locked app Gemfile before Pods.
Use locked Bundler 2.4.22 with CocoaPods 1.16.2 and xcodeproj 1.27.0 when changing Pods.
After an engine source change, prepare before installing Pods; use `build-ios-engine.sh --force` for an explicit rebuild.
App/package tools need Node 22.11+; the proxy needs Node 26+; pipeline checks use Python 3.12, uv and Node for the consumer parser.
Set `UV_PYTHON=3.12` when the default interpreter lacks wheels for the pinned NumPy version.
`pipeline/pyproject.toml` and `uv.lock` own local Python dependencies; invoke Python stages as modules from root.
Source-backed export checks require every corresponding source artifact and the publication receipt; report missing inputs as blockers.
On-device tests compile Swift harnesses on macOS 26+ and skip those harnesses on other hosts.

Build/test the GPU-independent C++/C interface from root:

```sh
nice -n 19 cmake -S packages/react-native-splat/engine/splatkit-engine -B packages/react-native-splat/build/tests -DCMAKE_BUILD_TYPE=Debug -DSPLATKIT_ENGINE_BUILD_TESTS=ON
nice -n 19 cmake --build packages/react-native-splat/build/tests --parallel 2
nice -n 19 ctest --test-dir packages/react-native-splat/build/tests --output-on-failure
```

Build/test Metal and the shared core on the Mac, from root:

```sh
nice -n 19 cmake -S packages/react-native-splat/engine/splatkit-ios -B packages/react-native-splat/build/checks -DCMAKE_BUILD_TYPE=Release
nice -n 19 cmake --build packages/react-native-splat/build/checks --parallel 2
nice -n 19 ctest --test-dir packages/react-native-splat/build/checks --output-on-failure
```

Build the app without signing from root, selecting a simulator explicitly when validating a device layout:

```sh
nice -n 19 xcodebuild -workspace apps/field-guide/ios/FieldGuide.xcworkspace \
  -scheme FieldGuide -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/field-guide/ios/build/simulator \
  COMPILATION_CACHE_ENABLE_CACHING=NO CODE_SIGNING_ALLOWED=NO build
```

Keep xcodebuild DerivedData under `apps/field-guide/ios/build/`, disable compilation caching and delete the temporary build directory afterward.
For an owned iOS Debug Metro, pass `FIELD_GUIDE_METRO_HOST=<host>:<port>` to xcodebuild, using `localhost` for a simulator or the Mac's reachable address for a phone.
Verification completes when affected interface tests, lint/types and the relevant build pass, with unresolved hardware/source prerequisites recorded.

## Android

Use JDK 17 and the SDK/NDK versions in [app setup](apps/field-guide/README.md#android).
Keep Gradle's user home, build outputs and any AVD under the worktree; build arm64-v8a with at most three workers.
From root:

```sh
JAVA_HOME=$(/usr/libexec/java_home -v 17) GRADLE_USER_HOME="$PWD/.work/gradle" nice -n 19 apps/field-guide/android/gradlew -p apps/field-guide/android :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=3
```

The shared C++ tests and all app/package checks above cover the common interfaces; add `-DSPLAT_CORE_PORTABLE_SHA256=ON` to the CMake configure command to exercise Android hashing on the host.
Pipeline tests use the locked project environment and self-contained capture fixtures; they do not establish source-backed export acceptance.
Gradle's asset task validates manifest-referenced pack bytes and copies fonts/notices without speech-model resources.
Keep Kotlin incremental compilation disabled for the linked packages so their internal declarations resolve in one compilation.

Create a tablet AVD under `.work/avd` using the API 36 arm64 image and 6 GB RAM, then run headless with the [host GPU](apps/field-guide/README.md#android):

```sh
ANDROID_AVD_HOME="$PWD/.work/avd" ANDROID_USER_HOME="$PWD/.work/android-user" nice -n 19 "$ANDROID_HOME/emulator/emulator" -avd FieldGuide -no-window -no-audio -no-snapshot -gpu host
```

Use Argent to install, launch and inspect the viewer; keep paid instructor requests disabled with fakes or device networking off.
For Debug, start an owned Metro port and reverse it with `adb -s <serial> reverse tcp:<port> tcp:<port>`; leave other sessions' servers untouched.
Record screenshots and the APK before deleting temporary builds and the private Gradle cache.
Stop scoped device servers, shut down the owned emulator with `adb -s <serial> emu kill` and stop the owned Metro process when verification finishes.

## Spatial assembly resources

The V8 tour uses the supplied CC BY-NC 4.0 USDZ, independently of the Gol pack.
Keep its original under `data/ar-assembly/v8-engine/source.usdz` and prepare the final assembled pose from root:

```sh
nice -n 19 python3 scripts/prepare_ar_assembly.py --source data/ar-assembly/v8-engine/source.usdz --output data/ar-assembly/v8-engine/engine.usdz --metadata-output data/ar-assembly/v8-engine/preparation.json
```

The macOS `usdcat` and `usdzip` tools preserve the hierarchy, geometry/materials and source-animation order while sampling time code 3250.
The tracked `apps/field-guide/assets/ar/v8-engine.json` pins source/prepared identities and ordering; revise it deliberately when replacing the equipment.
Xcode validates the prepared bytes before bundling; absent resources report an unavailable state.
The package's native assembly harness checks the actual prepared USDZ and receipt through every forward/reverse step, and explicitly skips when those local inputs are absent.
Physical anchoring, tracking recovery and visible animation remain separate acceptance checks.

## Capture and pack operations

Read the process record and inspect stage `--help`/`--plan` before execution.
Use `nice -n 19 uv run --project pipeline python -m pipeline.pack.<stage>` from root for `ingest`, `poses`, `cameras`, `training`, `preflight`, `import_annotations`, `lift_all`, `export` and `export_checks`.
`training --plan` starts no training; `pipeline/pack/train_local.sh` invokes the execution path.
Before authorized SAM execution, configure Modal and its `huggingface` secret with approved `HF_TOKEN`, then upload the exact ingested JPEGs to `sfg-spike-frames:/jpg`.
Use `modal deploy --module pipeline.pack.sam_live` for marking and `modal run --module pipeline.pack.sam_track` for propagation; stop the marking app after use.
Download the complete accepted marks revision tree from `/marks` before lifting.
After reviewed export, update the pinned content manifest and package the archive; publishing requires explicit authorization.

The AR reference has no pipeline stage; it is trained in the Create ML app, as [pipeline/README.md](pipeline/README.md#ar-reference) records.

## Implementation and writing rules

- Design deep modules with small interfaces; callers and tests cross the same seam.
- Apply the deletion test: useful modules keep complexity from spreading into callers.
- Two adapters justify a seam; one is hypothetical.
- Import implementations directly, with dependency directions enforced by app ESLint.
- Put app tests and shared fakes/setup in the root `tests` folder; other units retain their own test folders.
- Reproduce bugs with a failing screen, module-interface or C-interface test, then fix and rerun it.
- Extend essential behaviour tests and remove implementation-only tests when interface coverage replaces them.
- Match surrounding naming and idiom; comments explain why in plain sentences.
- Name meaningful or repeated event, URL, header, message and limit literals.
- Commit Nitro generated outputs with their specifications.
- Use ASCII hyphens or commas; U+2014 and U+00B7 are forbidden in code, comments, docs and commits.
- Put each full Markdown sentence on its own physical line.
- Keep human READMEs short, operations here, glossary definitions implementation-free and ADRs concise.
- Human docs describe the current code; the agent process record retains measurements and unresolved prerequisites.
- Reconcile [third-party notices](THIRD_PARTY_NOTICES.md) and the bundled texts when shipped dependencies/resources change.
- Commit small logical steps with one plain imperative sentence and no trailers.
- Publish, deploy, upload or make paid calls only when explicitly requested.

Finish with relevant checks passing, temporary artifacts removed and an accurate report of unresolved prerequisites.
