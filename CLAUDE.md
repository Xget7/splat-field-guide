# Working on Miris

The product is the Miris factory guide; existing paths retain the Field Guide name.
Read [architecture](docs/specs/field-guide-design.md) before changing concepts, interfaces, ownership, native behavior or pack contracts.
Read [tasks](TASKS.md) before claiming integration or acceptance and [operations](docs/agents/checks.md) before preparation, checks, builds or GPU profiling.
`AGENTS.md` is a symlink to this file.

## Ownership and operations

- Preparation, annotation, reconstruction, training and export belong to `../splat-tools`; read its README and operations before working there.
- SplatKit changes land in its own repository first, then integrate the upstream revision here.
- This repository owns mobile validation, bundling and release packaging.
- Run installs, builds, tests and stages with `nice -n 19`; use fakes for paid providers.
- Publish, deploy, upload and make paid calls only when explicitly requested.
- Preserve GPU rendering, profiling, diagnostics, accepted annotations and other sessions' servers.

## Code

- Use cohesive modules with small interfaces; callers and tests cross the same seam.
- Inject concrete dependencies at app composition; real adapters preserve cancellation, failure and ownership contracts.
- Two real adapters justify a seam; avoid hypothetical abstraction.
- Import another app slice through `index.ts` or `views.ts`, and pack/platform files directly; respect ESLint dependency directions.
- App tests live in their slice's `tests` folder; shared fakes/setup use root `tests` and `@tests/*`.
- Reproduce bugs with a failing interface test, fix them and rerun; remove implementation-only tests once interface coverage replaces them.
- Explain why in comments, name meaningful repeated literals and commit Nitro outputs with their specifications.
- Completion requires affected tests, lint/types and relevant builds; remove temporary output and report unresolved hardware/source prerequisites.
- Source/simulator checks do not establish physical acceptance.

## Documentation

Use README for orientation, design for contracts/decisions, TASKS for acceptance/evidence and operations for commands.
Consolidate into those files instead of adding roadmaps, status pages, ADR files or package READMEs.
Keep [notices](THIRD_PARTY_NOTICES.md) aligned with shipped resources and preserve upstream source/license records.
Use ASCII hyphens or commas, never U+2014 or U+00B7, and put each full Markdown sentence on its own physical line.
Commit small logical steps with one imperative sentence and no trailers.
