# Development and verification

Run installs, builds, tests and preparation with `nice -n 19` from the stated directory.
Use fakes for paid providers; deployment, upload and live paid requests require explicit authorization.

## Setup

Use an Apple silicon Mac, Xcode 27, Node 26+, pnpm 10.34.9, CMake, Ruby and Bundler.
The viewer requires iOS/iPadOS 26+ with an A14-class GPU or Android 10+ with Vulkan.
Android builds use JDK 17, SDK/build-tools 37 and NDK 27.1.12297006 with `ANDROID_HOME` configured.
After root preparation, run `nice -n 19 pnpm run ios` from `apps/field-guide`.
For Xcode, start Metro there with `nice -n 19 pnpm start` and open `ios/FieldGuide.xcworkspace`.
Debug needs reachable Metro; Release bundles JavaScript.
While connected, let automatic startup preparation finish and verify Models ready before local inference tests in airplane mode.
Check the course's separate offline availability in Downloads; verified voice and AI models do not install its scene, manual or modules.
Check pause/retry, offline startup without files and recovery when the route returns using fake transfers before a real download.
Allow microphone access separately.
A fresh installation without those files cannot provide local voice or generated answers.

## Worktree dependency storage

Each JavaScript unit pins pnpm in `package.json` and keeps its own `pnpm-lock.yaml`.
Enable the pinned version with Corepack (`corepack enable`) or install pnpm 10.34.9 using your Node tool manager.
Run installs inside the unit, or use `nice -n 19 pnpm --dir <unit> install --frozen-lockfile` from root.
The hoisted layout preserves Metro, CocoaPods and Gradle paths inside each unit's `node_modules`.
The app uses `link:` dependencies for its two local native packages so edits and generated frameworks resolve directly from the current worktree, without copying the engine into `node_modules`.
The machine-wide pnpm content store shares downloaded packages across units and worktrees.
[`package-import-method=clone-or-copy`](https://pnpm.io/10.x/settings#packageimportmethod) uses copy-on-write clones on APFS, preserving isolation when native install tools modify a package; unsupported filesystems fall back to copies.
Keep worktrees and the store on the same APFS volume for clone sharing; inspect the location with `pnpm store path` from a unit.

Create worktrees with Git rather than copying a checkout, and install only the units needed by that task.
For example, a voice-agent change needs only `nice -n 19 pnpm --dir services/voice-agent install --frozen-lockfile`; it needs no app installation, Pods, engine build or preparation.
Do not copy or symlink another worktree's `node_modules`, Pods or build directories: local package links, generated native files and dependency versions belong to their checkout.
Switching an existing checkout from npm to pnpm requires replacing that unit's `node_modules`; do this only when no session is using it.
Leave other sessions' dependency trees, servers, GPU work and caches intact.
Use a frozen install after changing branches, and update dependencies deliberately with pnpm rather than regenerating npm lockfiles.

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

For a private local iOS demo with the original KUKA source PDFs, set `FIELD_GUIDE_DOCUMENTS_DIR=/absolute/path/to/splat-tools/data/reference/kuka` alongside `FIELD_GUIDE_PACKS=miris-pilot/1` in the iOS build command.
Set `FIELD_GUIDE_MANUAL_INDEX_DIR` to the `splat-tools` `pipeline.pack.manual_index` output directory to include the complete searchable text from those same sources.
Both iOS and Android private packaging verify its receipt, original source digests and page inventory before replacing accepted resources.
The document copy stage checks the retained catalog's PDF headers and SHA-256 digests and writes the original bytes, document catalog and copyright notices into the app's `documents` resources.
Without both explicit settings no KUKA PDFs ship; local inclusion does not grant external redistribution rights.
Verify the course Documentation tab and source attachment open the same local manual without a network connection, and confirm the document edition before using cited maintenance pages.
Run `nice -n 19 node --test tests/course-documents.test.cjs` to check opt-in bundling and corruption refusal without copying real PDFs.

Each unit under `apps/`, `packages/` and `services/` installs with `nice -n 19 pnpm install --frozen-lockfile` and carries its checks as `package.json` scripts: `lint`, `typecheck`, `test` and, in native packages, `codegen`.
Run Jest suites (app, `react-native-on-device`) with `nice -n 19 pnpm test --runInBand`.
`services/instructor-proxy` has no typecheck script; use `nice -n 19 pnpm exec tsc --noEmit -p .`.
`services/voice-agent` previews its agent configuration with `pnpm run plan --manifest <file>`.
The on-device package tests exercise preparation, cancellation, speech/answer adapters and audio ownership with fake providers.
ExecuTorch's dependency postinstall is intentionally skipped to avoid duplicate native-library downloads.
Preparation runs `nice -n 19 node node_modules/react-native-executorch/scripts/download-libs.js` once from `apps/field-guide` before Pods; run it there before a standalone Gradle build too.
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

The obsolete demo Maestro flow and its package command have been removed.
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

Preparation copies `apps/field-guide/instructor.config.example.json` to ignored `instructor.config.json`; the example uses the deployed Miris pilot, and a null `proxyUrl` selects offline-only operation.
The Worker's `.dev.vars.example` requires only `ELEVENLABS_API_KEY` and `AGENT_ID`; keys remain outside git and the app.
The Worker serves a probe and signed ElevenLabs WebSocket sessions for both text and voice, with no shared cache.
The pilot session route is public and rate limited, not authenticated per operator.
The retired answer and custom-LLM routes return 404; Anthropic keys and model/shared-secret configuration are no longer required.
Use fake provider responses in tests; incomplete direct agent replies fail without committing typed navigation.

For voice-agent setup, copy `.env.example` and provide `ELEVENLABS_API_KEY` and an available account `VOICE_ID`.
Run `nice -n 19 pnpm run plan --manifest <file>` in `services/voice-agent` to inspect the exact prepared text documents, tool schemas and English managed-agent configuration without remote writes.
For the Miris pilot use `../../data/pack/miris-pilot/1/manifest.json`; schema 3 directions are validated without rewriting the source pack.
The plan and sync never upload original PDF bytes, splats or MobileCLIP vectors.
Pass `--manual-index <directory>` or set `FIELD_GUIDE_MANUAL_INDEX_DIR` to bind the agent to the complete local KUKA source corpus, whose pages are read by `search_manual` and `get_manual_page` client tools.
The same files and source digests must ship with the matching private app.
Full manual texts are not hosted in RAG by default; the inspected pilot workspace has a 1 MiB RAG quota, insufficient for both complete manuals alongside its existing documents.
Optional `--host-manuals` uses the same pages but checks hosted capacity first; changing a paid subscription requires separate authorization.
Once an agent records complete manual scope, sync refuses to silently omit `--manual-index`.
Use `--state <file>` for an independent dry plan or provisioning state.
After inspecting an authorized plan, run `nice -n 19 pnpm run sync --manifest <file>`.
Sync stores document digests/IDs in ignored `agent.json` immediately, requests every RAG index and leaves the agent unchanged while any index is pending or failed.
A pending-index error is recoverable by rerunning sync after ElevenLabs finishes indexing; the retry reuses uploaded documents.
Ensure the account has enough RAG capacity before sync; provider responses identify quota and permission failures.
Preserve `agent.json` across retries; do not share it across accounts or worktrees that publish independently.
The provisioning key needs knowledge-base read/write and indexing, agent/tool write, pronunciation dictionary read/write and voice access.
The Worker's key only needs the permissions to obtain the configured agent's signed URL.
Managed generation uses GPT-4.1 Mini through ElevenLabs; no separate model-provider key is needed.
Set the returned `AGENT_ID` on the existing `field-guide-instructor` Worker, then deploy the replacement and ship the matching app together; older apps do not implement the new read-only tools or the direct text-session path.
Live conversations incur provider usage and require explicit approval for paid validation.
Verify ambiguity clarification, exact part evidence, full-manual citations, supplied-vector similarity, cancelled typed navigation, course-to-scene framing and route-loss fallback before claiming acceptance.
Offline full-manual search is lexical and source-bound; it does not run a MobileCLIP query encoder on the phone.
Known-component similarity compares prepared image/text rows and returns stable IDs with scores, never inferred physical relationships.
Physical Qwen validation is tracked in [issue 28](https://github.com/Xget7/splat-field-guide/issues/28).
For authorized distribution, `apps/field-guide/scripts/testflight.sh --no-upload` exports locally; signing needs a configured team and account.

## Development framing audit

In a Debug viewer, open Dev and choose Check framing to audit every procedure target at the current viewport size.
The audit owns framing and highlights until it finishes; avoid procedure or layout changes during the run.
It uses the guide context distance and prepared step direction, waits for the framing animation plus a margin, then samples a 12 by 12 grid in each target's clipped projected bounds with native picks.
A visible fraction below 0.3 is flagged, including targets entirely off-screen; an assembly accepts its own and descendant labels.
These are projected-box occupancy scores, so sparse geometry can score low even without another part in front.
Each target is logged as a FRAMING_AUDIT JSON line, followed by FRAMING_AUDIT_REPORT for the full report.
The dev-only Metro runtime interface also exposes `globalThis.fieldGuideFraming.run()` (`run('home')` records a home-direction baseline on the same pack) and `globalThis.fieldGuideFraming.report`; retrieve it through the approved Metro debugger evaluation tool.
For screenshots, await `globalThis.fieldGuideFraming.showStep(procedureId, zeroBasedStepIndex)` and then call `restore()` when finished.
From the library, `globalThis.fieldGuideOpenFraming()` opens the first bundled guide for debugger-driven audits.
Release builds expose neither the audit action nor the debugger hooks.

For native candidate selection, generate a shortlist with `pipeline.pack.native_views shortlist` in splat-tools and inject the resulting JSON into the connected development runtime.
Call `globalThis.fieldGuideFraming.measureCandidates(input)` and inspect `globalThis.fieldGuideFraming.candidateReport` until `complete` is true or `error` is present.
The pass logs one FRAMING_CANDIDATE line per pose and a final FRAMING_CANDIDATE_REPORT, or FRAMING_CANDIDATE_ERROR with the incomplete report.
Do not reload, change the viewport or run a normal audit during candidate measurement.
The input and report bind pack ID and version, geometry hashes, viewport, canonical target sets and candidate identities.
Use the splat-tools selector to write the complete native choices, re-export with `--native-views`, rebuild the same isolated app and run the normal prepared audit once.
Use the approved simulator tooling for every app action, screenshot and Metro debugger operation, with the session's isolated bundle ID, device and Metro port.
