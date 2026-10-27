# Checks

Run each command with `nice -n 19` from the stated directory.

## Prepare

`scripts/prepare.sh` from root prepares the demo: it installs the app and native package dependencies, the locked Gems and Pods, and fetches the pack release with an authenticated `gh`, or takes `--pack <archive>`.
After an engine source change, prepare before installing Pods; `packages/react-native-splat/scripts/build-ios-engine.sh --force` forces an engine rebuild.
Change Pods only with `bundle exec pod install` in `apps/field-guide/ios`, so the locked Bundler, CocoaPods and xcodeproj apply.

## JavaScript units

Each unit under `apps/`, `packages/` and `services/` installs with `npm ci` and carries its checks as `package.json` scripts: `lint`, `typecheck`, `test` and, in native packages, `codegen`.
Run Jest suites (app, `react-native-on-device`) with `npm test -- --runInBand`.
`services/instructor-proxy` has no typecheck script; use `npx tsc --noEmit -p .`.
`services/voice-agent` previews its agent configuration with `npm run plan`.
The on-device Swift harnesses compile on macOS 26+ and skip on other hosts.

## Pipeline

From root:

```sh
uv run --project pipeline python -m pytest pipeline/tests
uv run --project pipeline python -m pipeline.pack.preflight
node --test pipeline/tests/test_mark_page.cjs
uvx ruff check --select F,E9 pipeline scripts
```

Set `UV_PYTHON=3.12` when the default interpreter lacks wheels for the pinned NumPy version.
Pipeline tests use self-contained capture fixtures; source-backed export acceptance is in [pack operations](pack-operations.md).

## Native engine

The GPU-independent C++/C interface, from root:

```sh
cmake -S packages/react-native-splat/engine/splatkit-engine -B packages/react-native-splat/build/tests -DCMAKE_BUILD_TYPE=Debug -DSPLATKIT_ENGINE_BUILD_TESTS=ON
cmake --build packages/react-native-splat/build/tests --parallel 2
ctest --test-dir packages/react-native-splat/build/tests --output-on-failure
```

Add `-DSPLAT_CORE_PORTABLE_SHA256=ON` to the configure step to exercise Android hashing on the host.

Metal and the shared core on the Mac, from root:

```sh
cmake -S packages/react-native-splat/engine/splatkit-ios -B packages/react-native-splat/build/checks -DCMAKE_BUILD_TYPE=Release
cmake --build packages/react-native-splat/build/checks --parallel 2
ctest --test-dir packages/react-native-splat/build/checks --output-on-failure
```

## iOS app

Build without signing from root, selecting a simulator explicitly when validating a device layout:

```sh
xcodebuild -workspace apps/field-guide/ios/FieldGuide.xcworkspace \
  -scheme FieldGuide -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/field-guide/ios/build/simulator \
  COMPILATION_CACHE_ENABLE_CACHING=NO CODE_SIGNING_ALLOWED=NO build
```

Keep DerivedData under `apps/field-guide/ios/build/` with compilation caching disabled, and delete the build directory afterward.
For an owned Debug Metro, pass `FIELD_GUIDE_METRO_HOST=<host>:<port>` to xcodebuild, with `localhost` for a simulator or the Mac's reachable address for a phone.

## Maestro E2E

Install Maestro CLI with `nice -n 19 brew install mobile-dev-inc/tap/maestro`; it requires Java 17 or later.
Prepare and install the app using the platform workflow above, and start Metro for a Debug build.
Use a tablet layout at least 700 points wide in portrait, where the guide drawer exposes the step list.
From `apps/field-guide`, run `nice -n 19 npm run e2e -- --udid <simulator-udid-or-emulator-serial>` against the explicit running target.
The flow clears that app's local state, opens the bundled guide in self-guided mode and starts the parts tour without enabling voice or asking the instructor.
Only the Start navigation can retry once if the first synthetic tap is dropped after a cold iOS launch; step selection and label assertions are not retried as a block.
It waits for the first highlighted marker, which mounts only after native `onReady` reports the first GPU frame, then selects the second step and returns to the first.
It checks the selected row and the corresponding visible part label, rejects renderer errors and saves `parts-tour-first-step.png` under `.work/maestro`.
The screenshot is review evidence; this flow does not compare renderer pixels or establish physical performance acceptance.
