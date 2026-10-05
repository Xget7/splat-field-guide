# Working on Field Guide

## Before editing

- **Names:** read [CONTEXT.md](CONTEXT.md) before introducing or renaming an equipment, guidance, pack or AR concept.
- **Decisions:** read the relevant [ADR](docs/adr/) before changing a module's interface, ownership, model order, pack format or platform choice.
- **Evidence:** use the [research index](docs/research/README.md) when checking capture measurements, historical alternatives, speech choices or provisional AR claims.
- **Pipeline:** read [pipeline/README.md](pipeline/README.md) before touching capture stages, annotations, export or pack preparation.
- **Splat:** read [react-native-splat](packages/react-native-splat/README.md) before changing the view, engine lifecycle or generated interface.
- **Speech/model:** read [react-native-on-device](packages/react-native-on-device/README.md) before changing audio, transcription, generation or speech resources.
- **App:** read [app setup](apps/field-guide/README.md) for device preparation and [REQUIREMENTS.md](REQUIREMENTS.md) plus [TASKS.md](TASKS.md) before changing acceptance claims.

Complete this step when the owned module, its interface and the evidence needed to verify the change are identified.

## Repo map

| Path | Owns |
| --- | --- |
| `apps/field-guide/src/app` | Composition and navigation |
| `apps/field-guide/src/domain` | Pure pack/session rules, tours and highlight/framing derivation |
| `apps/field-guide/src/features` | Library, guide detail, viewer and AR presentation |
| `apps/field-guide/src/modules` | Catalog, pack paths, progress and instructor coordination |
| `apps/field-guide/src/shared` | UI primitives, general hooks and route contracts |
| `packages/react-native-splat` | Nitro view, C interface, C++ geometry and Metal rendering |
| `packages/react-native-on-device` | Transcription, Apple generation, Kokoro and audio coordination |
| `services/instructor-proxy` | Worker request policy, Claude credentials and stream translation |
| `pipeline`, `content` | Capture stages and authored maintenance content |
| `scripts`, `data/pack` | Demo preparation, archive packaging and ignored prepared artifacts |
| `tests`, `docs` | Interface checks and supporting records |

Dependencies flow from app composition to features/modules, then domain/shared.
Modules do not import features or app composition; domain has no React/native dependencies and shared has no business dependencies.
ESLint enforces this direction; import implementations directly instead of adding barrels.

## Prepare and verify

Run commands from the stated directory, using fakes rather than paid requests.

| Directory | Purpose | Command |
| --- | --- | --- |
| Root | Prepare demo | `nice -n 19 scripts/prepare.sh --pack /path/to/gol-trend-engine-bay-1.tar.gz` |
| Root | Engine framework | `nice -n 19 packages/react-native-splat/scripts/build-ios-engine.sh` |
| `apps/field-guide` | Start/run | `npm start`, `nice -n 19 npm run ios` |
| `apps/field-guide` | Tests | `nice -n 19 npm test -- --runInBand` |
| `apps/field-guide` | Lint and types | `nice -n 19 npm run lint`, `nice -n 19 npm run typecheck` |
| Each native package | Install/codegen | `npm ci`, `nice -n 19 npm run codegen` |
| Each native package | Lint and types | `nice -n 19 npm run lint`, `nice -n 19 npm run typecheck` |
| `packages/react-native-on-device` | JS tests | `nice -n 19 npm test -- --runInBand` |
| `services/instructor-proxy` | Install/tests/types | `npm ci`, `nice -n 19 npm test`, `nice -n 19 npx tsc --noEmit` |
| Root | Pipeline checks/lint | `nice -n 19 uv run pipeline/preflight.py` |
| Root | Verify exported pack | `nice -n 19 uv run pipeline/export_checks.py --pack data/pack/gol-trend-engine-bay/1 --labels data/segment/lift/all/labels.npy` |
| Root | Pipeline regression tests | `nice -n 19 uv run --with pytest pytest tests/pipeline` |

Omit `--pack` once the public release exists, or supply `FIELD_GUIDE_PACK_URL`; matching pack files and engine fingerprints are reused.
Preparation includes the pinned Kokoro fetch and CocoaPods installation.
Pipeline export checks require the corresponding capture/training artifacts; a missing source is a blocker to report, not evidence of a passed real-pack check.
Nitro outputs in `nitrogen/generated` are intentionally committed with their specifications.

Build and test the C++ core and Metal implementation on the Mac, from root:

```sh
nice -n 19 cmake -S packages/react-native-splat/engine/splatkit-ios -B packages/react-native-splat/build/checks -DCMAKE_BUILD_TYPE=Release
nice -n 19 cmake --build packages/react-native-splat/build/checks --parallel 2
nice -n 19 ctest --test-dir packages/react-native-splat/build/checks --output-on-failure
```

Build the app without signing, from root:

```sh
nice -n 19 xcodebuild -workspace apps/field-guide/ios/FieldGuide.xcworkspace \
  -scheme FieldGuide -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/field-guide/ios/build/agent-simulator \
  COMPILATION_CACHE_ENABLE_CACHING=NO CODE_SIGNING_ALLOWED=NO build
```

Keep every xcodebuild's derived data under `apps/field-guide/ios/build/`, disable compilation caching and delete that build folder when finished.
Complete verification when the affected interface tests, lint/types and relevant build pass, with device-only acceptance left explicitly unchecked.

## Implementation and writing rules

- Design deep modules with small interfaces; callers and tests cross the same seam.
- Apply the deletion test: useful modules keep complexity from spreading into callers.
- Two adapters justify a seam; one is a hypothetical seam.
- Reproduce a bug with a failing screen, module-interface or C-interface test, then fix it and see that test pass.
- Keep few essential behaviour tests, extend existing ones and remove implementation-only tests once interface coverage replaces them.
- Match surrounding naming, idiom and comment density; comments explain why in plain sentences.
- Name meaningful or repeated literals for events, URLs, headers, messages and limits.
- Use ASCII hyphens or commas; U+2014 and U+00B7 are forbidden in code, comments, docs and commits.
- Put each full Markdown sentence on its own physical line.
- Keep human READMEs short, operational instructions here, glossary definitions implementation-free, ADRs concise and research historical.
- Distinguish source/simulator checks from physical acceptance; update affected docs with behaviour changes.
- Commit small logical steps with one plain imperative sentence, without co-author, generated or other trailers.
- Publish, deploy, upload or make paid calls only when explicitly requested.

Finish with the relevant checks passing, temporary artifacts removed, and an accurate report of unresolved device or external prerequisites.
