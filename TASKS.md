# Miris delivery work

This is the current implementation and acceptance backlog.
Architecture lives in [design](docs/specs/field-guide-design.md).
All items below remain open unless their completion evidence is recorded here.

## Current foundation

The app contains pack verification, a native viewer, sessions, procedures, saved continuation and an instructor with online/offline capabilities.
Startup has an empty catalog; no former demo content or synthetic test pack ships.
Zustand is installed; WatermelonDB and TanStack Query are selected but not installed or integrated.
Miris teaching is active in `../splat-tools`; accepted masks, lifting, export and app integration must not be conflated.

## Product and preparation

- [ ] Fix the Miris demonstration path, supported languages, voice expectations, target devices and delivery format.
- [ ] Finish reviewed annotations for the four-robot pilot, with especially careful review of R01 and R02, in `splat-tools`.
- [ ] Verify the transformation between original cameras and the upright PLY, coordinate conventions and units before lifting.
- [ ] Lift accepted masks and review coverage, including occluded parts and whether further views need annotation.
- [ ] Export a real Miris pack with stable IDs, node labels, bounds, anchors, authored records and compatible supplied vectors.
- [ ] Agree on the minimum delivery contract using those outputs and the existing pack consumer interface.

Preparation and model work belongs in the separate workspace.
Annotation drafts, source captures and the running teaching service must be preserved during repository cleanup.

## App integration

- [ ] Implement verified pack installation, activation and failure recovery, connecting explicit pack selection to the empty startup/catalog.
- [ ] Integrate WatermelonDB semantic records and TanStack Query API delivery without duplicating persistent records in Zustand.
- [x] Validate vector-space identity and implement supplied-vector comparison returning stable part IDs.
- [ ] Resolve selected IDs through the active reconstruction's mappings and connect them to existing viewer highlight and framing.
- [ ] Connect reviewed Miris information and procedures to the existing guide/instructor interfaces.
- [ ] Test interrupted installation, incompatible vectors, wrong-reconstruction mappings and replacement preserving stable identities.
- [ ] Agree separately on a free-text query flow before adding any query encoder or runtime.

Contract and app-interface work can proceed while annotations are refined.
Visual acceptance must use accepted exported data.

Schema 2 now accepts optional `relations` (Brick `feeds`, plus `carries`, `drives` and `adjacent`, each with authored or measured evidence), a `model` Turtle file and a `semantic` vector block; see [design](docs/specs/field-guide-design.md#pack-and-delivery).
Pack tooling verifies the size and SHA-256 of the model and vectors files, checks vector rows are finite unit vectors, and bundles and archives both files.
Component graph navigation, supplied-vector ranking and connection-grounded instructor prompts are pure source interfaces; no screen offers relation navigation yet.
The contract still needs agreement against the exporter's first real Miris pack, and loading the vectors file from an installed pack waits for installation.
Source checks passed 66 app suites with 811 tests, lint, types and nine pack tooling tests; no device, build or physical check was run.

## Runtime cleanup

- [x] Remove discarded demo content, AR product paths, unrelated catalog entries and standalone benchmark screens, including their callers, assets and source records.
- [x] Remove the superseded mobile semantic tokenizer/encoder experiment and its unneeded scripts, resources and retrieval tests.
- [x] Update preparation, packaging, navigation and tests with those removals, retaining required viewer, speech and GPU verification support.
- [x] Reconcile third-party notices with the resources and dependencies that remain in the distributed app.

AR/assembly/placement and standalone benchmark routes, native AR bindings, V8 resources and their build inputs have been removed.
The four unrelated catalog entries and their images have been removed, together with unused coming-soon presentation and types.
All former demo content, previews, ModelView bindings and automatic release downloads have been removed.
Packaging and voice-agent configuration require explicit validated manifest inputs.
Catalog cleanup passed 64 app suites, 782 tests, one snapshot, lint, types and seven tooling tests.
The final removal passed 64 app suites with 781 tests, 62 service tests, nine tooling tests, three splat package tests, lint/types, codegen comparison and production JS bundling.
Unsigned iOS Simulator Debug and Android arm64 Debug builds passed with empty content bundles.
Two identified obsolete local release directories were removed, reclaiming about 699 MB; unidentified archives were preserved.
Visual and physical acceptance remain unchecked.
Keep source provenance for referenced pack inputs and attribution for shipped resources until their corresponding content is removed.

## Acceptance

- [ ] Verify orbit, pinch, part picking, every accepted highlight, procedure framing and mount/unmount recovery on physical target hardware.
- [ ] Measure Miris frame time, idle drawing, load time, memory and thermal behaviour; adjust its export tier if needed.
- [ ] Verify prepared-device offline browsing and vector comparison on physical iOS and Android; test missing resources separately on a fresh device.
- [ ] Verify the agreed voice flow, pronunciation, interruption, cancellation, answer fallback and continuation on eligible hardware.
- [ ] Run affected interface tests, lint, types and relevant platform builds, and remove temporary build output.
- [ ] Record Miris-specific evidence and deliver the agreed demo artifact only when explicitly requested.

## Completion criteria

The demo opens a verified Miris pack for the four-robot pilot, selects and frames accepted parts, presents reviewed information and supports the agreed instructor flow.
Stable IDs survive replacement; invalid files, incompatible vectors and wrong-reconstruction mappings are rejected without losing the last usable installation.
Prepared-data browsing and supplied-vector comparison work offline on physical iOS and Android.
The viewer targets 60 fps on the chosen acceptance device and draws no unchanged idle frames; record load time, memory and thermal behavior.
Only the Miris experience and its required resources ship, with matching notices and passing interface tests, lint, types and relevant builds.
Demonstration devices, languages, voice expectations and delivery format remain to be fixed above.

## Preparation evidence

The active external session is `splat-tools/data/analysis/miris-pilot/teaching-02`; accepted masks are in `references/` and `teaching-state.json`, not draft counts.
The retained reconstruction is `data/analysis/miris-factory/fvdb-full-50-t1e-4-v1/results/output/final-pruned-upright.ply` in that workspace.
Verify its transform against the original OpenCV cameras before lifting; earlier cross-view transfer did not establish coverage.
Preserve the annotation service and source data during mobile cleanup.
Record Miris artifact identities and physical-device evidence here as tasks complete; earlier fixture results do not establish Miris acceptance.

## Architecture audit evidence

The vendored SplatKit packages were reconciled with published `origin/main` at `8a25c57c6c4f62cf682e4c6159cfcae048f7fefe`, retaining the separate event-dispatch fix and documented guide adaptations.
Vulkan CPU camera validation and optional SH8 support are integrated; SH8 remains OFF.
Core/C-interface/Metal checks passed 271 tests with two fixture skips; Android renderer/test targets cross-compiled with SH8 OFF and ON, and both iOS framework slices rebuilt.
Independent source review found no actionable regressions and reran the CPU camera projection check.
Renderer-level valid-invalid-valid camera recovery across both frame slots still needs Vulkan execution covering clear output, submission, failure state and world-ready timing.
These native packages are manually integrated snapshots, not dependencies that automatically track upstream.

The instructor/services audit corrected interruption before audio, retryable limiter failures, legacy generation persona, incomplete stream completion, malformed provider resource responses and Worker URL validation before sync mutations.
Each fix has a regression test that failed before the correction.
The delegated checks passed 34 instructor suites (352 tests and one snapshot), 49 proxy tests, 12 voice-agent tests, app/service TypeScript checks, instructor lint/format checks and a local Worker dry-run bundle.
No deployment or paid request was performed; live provider compatibility and physical voice acceptance remain unchecked.
Caller authentication for answer/session routes and serialization of live sync operations remain unresolved; sync requires an explicit reviewed Miris manifest before deployment.
Native/tooling regressions now cover source validation before bundling, repair of same-size/same-timestamp corrupted copies, linked pack paths and conversation-owner microphone release.
Checks passed 11 root tooling tests, 23 on-device tests (one skipped for unavailable retrieval inputs), four splat package tests, both packages' lint/types and engine artifact fingerprint verification.
The first iOS build was blocked by the local Node library linkage; a temporary Node 26 wrapper using installed simdjson enabled the final successful build.
The upstream SplatKit event-sink teardown race is fixed and selectively integrated, preserving unrelated upstream GPU edits.
The regression crashed before the fix; upstream event tests passed ThreadSanitizer, the imported engine passed 180 tests with one fixture skip under ThreadSanitizer, and Metal passed 269 tests with two fixture skips.
Android arm64 engine/test cross-compilation passed; physical checks remain outstanding.
App fixes cover voice ownership on close/replacement, stale answer and connectivity callbacks, pack directory IDs, non-React public imports and Android keyboard events with listener cleanup.
The app audit passed 64 suites (752 tests and one snapshot), lint and types; the final keyboard regression rerun passed two tests.
Runtime tier metadata now requires lowercase SHA-256 digests and label bytes equal to the SFGL header plus node count, matching native readers.
The follow-up passed 782 app tests, seven pack tooling tests, 49 proxy tests, 12 voice-agent tests, app ESLint and app/service types.
The event fix is pinned to upstream commit `c857707186c25497df4ad71b03a8f3b4efe1c230`.
Independent source review found no actionable correctness issues in the stable functional changes; it excluded the ongoing native cleanup and did not independently rerun builds or hardware checks.
Final cleanup checks passed on-device (21 tests), splat (three tests), root tooling (seven tests), native package lint/types and app types.
Two clean codegen runs matched 84 files.
Unsigned iOS Simulator Debug and Android arm64 Debug builds passed, with no discarded AR/semantic resources in either bundle.
The final integrated app run passed 64 suites, 782 tests, one snapshot, lint, formatting and types.
Build outputs and temporary tooling were removed; no device interaction or physical acceptance was performed.
