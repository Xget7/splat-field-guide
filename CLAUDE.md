# Working on Field Guide

Field Guide is a bare React Native app that turns a Gaussian-splat capture of real equipment into an offline maintenance guide with a voice instructor, built from local Nitro packages, a Cloudflare Worker and a Python pack pipeline.

## Before editing

- **Names:** read [CONTEXT.md](CONTEXT.md) before introducing or renaming equipment, guidance, pack or AR concepts.
- **Ownership:** read [design](docs/specs/field-guide-design.md#ownership) and the relevant [ADR](docs/adr/) before changing an interface, ownership, model order, pack format or platform choice.
- **Evidence:** read the agent [process record](docs/process.md) before checking capture measurements, native bridge/speech decisions or provisional AR claims.
- **Pipeline:** read [pipeline/README.md](pipeline/README.md) before touching capture stages, annotations, export or pack preparation.
- **Splat:** read [react-native-splat](packages/react-native-splat/README.md) before changing its view, engine lifecycle or generated interface.
- **Speech/model:** read [react-native-on-device](packages/react-native-on-device/README.md) before changing audio, transcription, generation or speech resources.
- **Acceptance:** read [app setup](apps/field-guide/README.md), [REQUIREMENTS.md](REQUIREMENTS.md) and [TASKS.md](TASKS.md) before changing acceptance claims.

Proceed when the owned unit, caller/test interface and required evidence are identified.

## Operations

Run every install, build, test and stage with `nice -n 19`, using fakes for paid services.
Publish, deploy, upload or make paid calls only when explicitly requested.

- **Checks:** read [checks](docs/agents/checks.md) before preparing, installing, linting, testing, running codegen or building the engine or iOS app.
- **Android:** read [Android](docs/agents/android.md) before a Gradle build, emulator run or Android verification.
- **Assembly:** read [AR assembly](docs/agents/ar-assembly.md) before preparing or replacing the V8 USDZ.
- **Pack:** read [pack operations](docs/agents/pack-operations.md) before running capture stages, SAM on Modal, export or packaging.

Work is done when affected interface tests, lint/types and the relevant build pass, temporary build output is removed and unresolved hardware/source prerequisites are reported.
Source/simulator checks leave physical acceptance explicitly unchecked.

## Code

- Design deep modules with small interfaces; callers and tests cross the same seam.
- Apply the deletion test: a useful module keeps complexity from spreading into its callers.
- Two adapters justify a seam; one is hypothetical.
- Import implementations directly; app ESLint enforces dependency directions.
- Put app tests and shared fakes/setup in the root `tests` folder; other units keep their own test folders.
- Reproduce bugs red first with a failing screen, module-interface or C-interface test, then fix and rerun it.
- Extend essential behaviour tests and remove implementation-only tests once interface coverage replaces them.
- Comments explain why in plain sentences.
- Name meaningful or repeated event, URL, header, message and limit literals.
- Commit Nitro generated outputs with their specifications.

## Writing

- Use ASCII hyphens or commas; U+2014 and U+00B7 are forbidden in code, comments, docs and commits.
- Put each full Markdown sentence on its own physical line.
- Human READMEs stay short and describe the current code; agent operations live in `docs/agents`, measurements and unresolved prerequisites in the process record.
- Keep glossary definitions implementation-free and ADRs concise.
- Reconcile [third-party notices](THIRD_PARTY_NOTICES.md) and the bundled texts when shipped dependencies/resources change.
- Commit small logical steps with one plain imperative sentence and no trailers.
