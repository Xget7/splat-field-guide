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
App/package tools need Node 22.11+; the proxy needs Node 26+; pipeline tools need Python 3.12+, uv and Node for the consumer parser.
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
  -derivedDataPath apps/field-guide/ios/build/final-shape \
  COMPILATION_CACHE_ENABLE_CACHING=NO CODE_SIGNING_ALLOWED=NO build
```

Keep xcodebuild DerivedData under `apps/field-guide/ios/build/`, disable compilation caching and delete the temporary build directory afterward.
Verification completes when affected interface tests, lint/types and the relevant build pass, with unresolved hardware/source prerequisites recorded.

## Capture and reference operations

Read the process record and inspect stage `--help`/`--plan` before execution.
Use `nice -n 19 uv run --project pipeline python -m pipeline.pack.<stage>` from root for `ingest`, `poses`, `cameras`, `training`, `preflight`, `import_annotations`, `lift_all`, `export` and `export_checks`.
`training --plan` starts no training; `pipeline/pack/train_local.sh` invokes the execution path.
Before authorized SAM execution, configure Modal and its `huggingface` secret with approved `HF_TOKEN`, then upload the exact ingested JPEGs to `sfg-spike-frames:/jpg`.
Use `modal deploy --module pipeline.pack.sam_live` for marking and `modal run --module pipeline.pack.sam_track` for propagation; stop the marking app after use.
Download the complete accepted marks revision tree from `/marks` before lifting.
After reviewed export, update the pinned content manifest and package the archive; publishing requires explicit authorization.

AR Python stages use `pipeline.ar.<stage>`: `register_reference`, `prepare_reference`, `cleanup_reference`, `train_reference`, `publish_landmarks` and `watch_ar`.
The reference training recipe uses explicit `--mode standard --angles front --plan` with `--source` and `--output`; remove `--plan` only when training is authorized.
Build `reconstruct_reference.swift`, `author_ar_landmarks.swift` and `probe_reference.swift` with `nice -n 19 xcrun swiftc`, following their file headers.
For physical AR diagnostics, `watch_ar --device <identifier> --expect detected` captures metadata; `--check-capture <jsonl> --expect detected` replays it without a phone.
Create the destination directory before redirecting stdout; a recognition verdict leaves landmark alignment unchecked.

## Implementation and writing rules

- Design deep modules with small interfaces; callers and tests cross the same seam.
- Apply the deletion test: useful modules keep complexity from spreading into callers.
- Two adapters justify a seam; one is hypothetical.
- Import implementations directly, with dependency directions enforced by app ESLint.
- Put tests beside their code and shared app fakes/setup in `src/testing`.
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
