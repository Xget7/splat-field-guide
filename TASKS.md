# Miris delivery work

This is the current implementation and acceptance backlog.
Architecture lives in [design](docs/specs/field-guide-design.md).
All items below remain open unless their completion evidence is recorded here.

## Current foundation

The app contains pack verification, a native viewer, sessions, procedures, saved continuation and an instructor with online/offline capabilities.
Startup has an empty catalog; no former demo content or synthetic test pack ships.
Zustand is installed; WatermelonDB and TanStack Query are selected but not installed or integrated.
Miris preparation in the separate `splat-tools` checkout includes accepted-mask lifting, export, notes, procedures, Brick evidence and part vectors; these do not establish app integration.

## Product and preparation

- [ ] Fix the Miris demonstration path, supported languages, voice expectations, target devices and delivery format.
- [ ] Finish reviewed annotations for the four-robot pilot, with especially careful review of R01 and R02, in `splat-tools`.
- [ ] Verify the camera-to-reconstruction transformation, coordinate conventions and assumed units before accepting the lifted export.
- [x] Implement multi-view confirmed lifting and produce a Miris lift, recorded by the publication receipt.
- [ ] Review lifted coverage, including occluded parts and whether further views need annotation.
- [x] Export a Miris pack with stable IDs, node labels, bounds, anchors, authored records and supplied vectors, recorded in `splat-tools/data/pack/miris-pilot/1/manifest.json` and `publication.json`.
- [ ] Revalidate the regenerated pack against current content and the full app contract; the receipt is not visual acceptance.
- [ ] Agree on the minimum delivery contract using those outputs and the existing pack consumer interface.
- [ ] Segment and lift the whole cell, including fences, gates, barriers, cabinets/panels, body/transport and racks, from the proposals in `content/miris-pilot/cell.md`.
- [ ] Reconcile the R01/R02 disagreement between session guides with the owner before extending annotations.
- [ ] Confirm the car process, tool function and transport sequence with the owner; the seven-step narrative is inferred.
- [ ] Review and extend both contracts for proposed `supports`, `guards`, `monitors`, `stores`, `processes` and `controls` relations with evidence.
- [ ] Obtain matching assembly/operating and accessory instructions, confirm installed models and resolve inherited QUANTEC-2 K/P citations before authoring service schedules.
- [ ] Complete the single annotated Turtle projection, including procedures, aliases and details, and verify parity with the manifest.

Preparation and model work belongs in the separate workspace.
Annotation drafts, source captures and the running teaching service must be preserved during repository cleanup.

## App integration

- [ ] Implement secure remote compressed chunk delivery, authenticated manifest trust, on-device processing, verified installation, atomic activation and failure recovery, connecting pack selection to startup.
- [ ] Add CAD file, node and alignment joins by stable segmentation ID.
- [x] Widen node labels to SFGL v2 unsigned 16-bit values in export, validation, picking and both renderer copies before freezing the installer contract.
- [ ] Expose supplied relation navigation in the viewer.
- [x] Implement grounded on-device generation behind the instructor answerer seam, after the remote proxy and before scripted fallback; hardware acceptance remains open.
- [ ] Integrate WatermelonDB semantic records and TanStack Query API delivery without duplicating persistent records in Zustand.
- [x] Validate vector-space identity and implement supplied-vector comparison returning stable part IDs.
- [ ] Resolve selected IDs through the active reconstruction's mappings and connect them to existing viewer highlight and framing.
- [ ] Connect reviewed Miris information and procedures to the existing guide/instructor interfaces.
- [ ] Test interrupted installation, incompatible vectors, wrong-reconstruction mappings and replacement preserving stable identities.
- [ ] Agree on how the pipeline supplies query vectors for free-text questions; the app never runs an encoder.

Contract and app-interface work can proceed while annotations are refined.
Visual acceptance must use accepted exported data.

Schema 2 now accepts optional `relations` (Brick `feeds`, plus `carries`, `drives` and `adjacent`, each with authored or measured evidence), a `model` Turtle file and a `semantic` vector block; see [design](docs/specs/field-guide-design.md#pack-and-delivery).
Pack tooling verifies the size and SHA-256 of the model and vectors files, checks vector rows are finite unit vectors, and bundles and archives both files.
Component graph navigation, supplied-vector ranking and connection-grounded instructor prompts are pure source interfaces; no screen offers relation navigation yet.
The current exported manifest and publication receipt provide handoff evidence; acceptance of regenerated content and loading installed vectors remain open.
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

No Miris pack opening on a simulator or physical device is recorded.

- [ ] Open the integrated Miris pack on a simulator for functional review, then on target hardware for physical acceptance.
- [ ] Verify orbit, pinch, part picking, every accepted highlight, procedure framing and mount/unmount recovery on physical target hardware.
- [ ] Measure Miris frame time, idle drawing, load time, memory and thermal behaviour; adjust its export tier if needed.
- [ ] Verify prepared-device offline browsing and vector comparison on physical iOS and Android; test missing resources separately on a fresh device.
- [ ] Verify the agreed voice flow, pronunciation, interruption, cancellation, answer fallback and continuation on eligible hardware.
- [ ] Run affected interface tests, lint, types and relevant platform builds, and remove temporary build output.
- [ ] Record Miris-specific evidence and deliver the agreed demo artifact only when explicitly requested.

## Completion criteria

The first delivery opens a verified four-robot Miris pack, selects and frames accepted parts, presents reviewed information and supports the agreed instructor flow.
The product objective extends this to the whole cell and confirmed car process, with CAD, manuals, procedures and relations joined by segmentation ID and complete annotated Turtle alongside the manifest.
Stable IDs survive replacement; invalid files, incompatible vectors and wrong-reconstruction mappings are rejected without losing the last usable installation.
Prepared-data browsing and supplied-vector comparison work offline on physical iOS and Android.
The viewer targets 60 fps on the chosen acceptance device and draws no unchanged idle frames; record load time, memory and thermal behavior.
Only the Miris experience and its required resources ship, with matching notices and passing interface tests, lint, types and relevant builds.
Demonstration devices, languages, voice expectations and delivery format remain to be fixed above.

## Preparation evidence

The active external session is `splat-tools/data/analysis/miris-pilot/teaching-02`; accepted masks are in `references/` and `teaching-state.json`, not draft counts.
Read the current `data/pack/miris-pilot/1/publication.json` and `manifest.json` in that workspace for reconstruction/lift identities, counts, bytes and consumer validation.
The receipt identifies `final-pruned-vertex.ply` and a completed lift; scale remains assumed and non-metric, and coordinate/coverage acceptance is still open.
Authored content has 44 parts with notes, including inherited visual/anatomy references, and 12 maintenance procedures, three per robot, based on the 127-page KR QUANTEC extra V6 specification.
That source supplies no lubrication, oil-change, belt or cable-replacement schedule; inherited pages 287 and 353 belong to an unavailable QUANTEC-2 K/P reference.
The cell research register has 25 proposed non-robot components and 35 candidate relations, none integrated into accepted segmentation or the pack.
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
Runtime tier metadata now requires lowercase SHA-256 digests and label bytes equal to the SFGL v2 header plus twice the node count, matching native readers.
The follow-up passed 782 app tests, seven pack tooling tests, 49 proxy tests, 12 voice-agent tests, app ESLint and app/service types.
The event fix is pinned to upstream commit `c857707186c25497df4ad71b03a8f3b4efe1c230`.
Independent source review found no actionable correctness issues in the stable functional changes; it excluded the ongoing native cleanup and did not independently rerun builds or hardware checks.
Final cleanup checks passed on-device (21 tests), splat (three tests), root tooling (seven tests), native package lint/types and app types.
Two clean codegen runs matched 84 files.
Unsigned iOS Simulator Debug and Android arm64 Debug builds passed, with no discarded AR/semantic resources in either bundle.
The final integrated app run passed 64 suites, 782 tests, one snapshot, lint, formatting and types.
Build outputs and temporary tooling were removed; no device interaction or physical acceptance was performed.

SFGL v2 widening passes app tests, app/package lint and types, pack/archive tooling and GPU-independent native tests, including labels 256 and 65535.
The iOS engine compiles against the simulator SDK without launching a simulator; full app compilation still needs Pods, Metal shader compilation needs the installed Metal Toolchain, and Android and physical-device acceptance remain unverified.
Pipeline label, tree-export and lifting checks pass with this worktree as `FIELD_GUIDE_ROOT`; the concurrent procedure-content assertion remains outside this label change.
