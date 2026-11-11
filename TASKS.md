# Miris delivery work

This is the current implementation and acceptance backlog.
Architecture lives in [design](docs/specs/field-guide-design.md).
All items below remain open unless their completion evidence is recorded here.

## Current foundation

The app contains pack verification, a native viewer, sessions, procedures, saved continuation and an instructor with online/offline capabilities.
Startup reads explicitly bundled packs through the consumer parser; without FIELD_GUIDE_PACKS the catalog remains empty.
No former demo content or synthetic test pack ships.
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
- [x] Reconcile R01 and R02: the accepted masks and the lifted pack follow the Spanish session guide consistently across views; the English guide reverses them in views 0, 4, 7, 9 and 17 and must be corrected in `splat-tools` session data before reuse.
- [x] Tool function: the owner confirmed on 2026-11-11 that the cell performs resistance spot welding.
- [ ] Confirm the transport sequence and division of work among robots; those parts of the seven-step narrative remain inferred.
- [ ] Review and extend both contracts for proposed `supports`, `guards`, `monitors`, `stores`, `processes` and `controls` relations with evidence.
- [ ] Obtain matching assembly/operating and accessory instructions, confirm installed models and resolve inherited QUANTEC-2 K/P citations before authoring service schedules.
- [ ] Complete the single annotated Turtle projection, including procedures, aliases and details, and verify parity with the manifest.

Preparation and model work belongs in the separate workspace.
Annotation drafts, source captures and the running teaching service must be preserved during repository cleanup.

## App integration

- [x] Reuse the native BundledPacks reader and explicit build selection to open verified bundled packs at startup, including course Explore entry and a visible startup failure when native registration is unavailable.

- [x] Compose the landscape course entry in React Native with shared charcoal tokens, 8-point spacing, sidebar, module cards, document attachment and controlled question draft.
- [x] Share automatic offline model preparation at app lifetime, verify before download, reuse device files and recover on reconnect with cancellation/concurrency tests.
- [x] Separate course offline availability from verified Voice & AI models in entry and Downloads, with model pause, continue and retry controls.
- [ ] Connect course-wide grounded answers, source PDF opening and course module content; the entry currently presents availability states.
- [ ] Connect course download controls to the authenticated installer below, deriving offline readiness from all required verified course files rather than the model cache or a catalog entry.

- [ ] Implement secure remote compressed chunk delivery, authenticated manifest trust, on-device processing, verified installation, atomic activation and failure recovery, connecting pack selection to startup.
- [ ] Add CAD joins by stable segmentation ID per the planned contract in design; the owner holds only photographs and point clouds of an approximate recreation, so reference geometry is authored or adopted and made exact by this project.
- [ ] Remount the viewer per installation identity and test that no highlight or pick crosses pack versions.
- [ ] Replace the per-frame 2 MiB label style upload with a state table uploaded on change and a small palette, and measure it on the iPad.
- [ ] Define the signed manifest envelope (key ID, Ed25519 signature over raw bytes, required format versions, chunk table) in `splat-tools` export and `validate-pack.cjs`.
- [ ] Build the native installer: one background session, chunks named by digest, capacity preflight, rename commit, `active.json` pointer and launch recovery, with fakes at the network seam.
- [ ] Test rollback refusal, reused-version refusal, power loss at each installation state, missing capacity and a corrupted chunk.
- [ ] Implement the projected-bounds cutaway, opacity-based emphasis states and styled picking, with a visual check on inner robot parts.
- [ ] Measure world and label verification plus decode time and remount peak memory on the target iPad, and digest-check vectors on read.
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

Bundled startup integration passes 67 app suites with 830 tests, ten pack-tooling tests and three native-package source tests, with app/package lint and TypeScript checks.
The local miris-pilot/1 copy was refreshed from the canonical 2026-11-11 publication and passed full pack verification.
An unsigned iPad Simulator build succeeded with that pack selected and opened the course entry while retaining verified model files.
The Explore tap landed in the question composer despite targeting its accessibility reference, so native first-frame, picking and highlight checks remain unresolved; no physical acceptance is claimed.

Course entry and preparation checks pass 67 app suites with 822 tests, 26 on-device tests, app/package lint and TypeScript checks, a production iOS JavaScript bundle and an unsigned iOS Simulator build.
The isolated iPad preview completed automatic model download and reported verified readiness after relaunch; microphone, transcription, synthesis and generated answers were not exercised.
Course and assistant navigation were observed in the simulator, but the final Downloads tap check is unresolved because the device automation dispatched taps without the expected navigation.
The next course delivery sequence is verified content installation, source document bindings, grounded course answers, then course voice interaction and physical acceptance.
Model readiness does not complete those tickets; no complete offline course or functional voice acceptance is claimed.

Schema 2 now accepts optional `relations` (Brick `feeds`, plus `carries`, `drives` and `adjacent`, each with authored or measured evidence), a `model` Turtle file and a `semantic` vector block; see [design](docs/specs/field-guide-design.md#pack-and-delivery).
Pack tooling verifies the size and SHA-256 of the model and vectors files, checks vector rows are finite unit vectors, and bundles and archives both files.
Component graph navigation, supplied-vector ranking and connection-grounded instructor prompts are pure source interfaces; no screen offers relation navigation yet.
The current exported manifest and publication receipt provide handoff evidence; acceptance of regenerated content and loading installed vectors remain open.
Source checks passed 66 app suites with 811 tests, lint, types and nine pack tooling tests; no device, build or physical check was run.

## Local inference migration

The local recognition, synthesis and answer adapters now use ExecuTorch 0.11.0 on both platforms, with CPU Whisper Base English, Kokoro and Qwen2.5 1.5B Instruct.
Offline preparation starts automatically after verification and a usable device route; pinned files are verified before inference and reused across workers.
Restore itself is offline; the coordinator downloads missing files, exposes pause/retry and retries after connectivity returns without blocking online operation.
The initial model set is about 1.8 GB and supports `en-US`; it is separate from the Miris scene pack.
The native Apple Foundation Models, platform recognition/TTS and ONNX frontend implementations have been removed.
Physical acceptance of recognition in factory noise, technical part names without vocabulary biasing, pronunciation, answer grounding, interruption, restart offline, memory and thermal behaviour remains open.
Validation passed 67 app suites with 815 tests, 21 local capability tests, ten pack-tooling tests, app/package lint and TypeScript checks, deterministic regeneration of 32 Nitro output files, production JavaScript bundling, an unsigned arm64 iOS Simulator Debug build and an Android arm64 Debug build.
The pre-existing Homebrew Node dylib mismatch required a temporary official Node 26 binary for checks and builds; the original local Xcode environment was restored.
No model inference or microphone interaction was run on a simulator or physical device, and no paid provider call or deployment was made.
Follow-up cleanup removed about 180 MB of obsolete Kokoro/ONNX/CoreML resources and Swift probe output, the unused recognition-hint builder, system-recognizer installation flags and the single-choice voice configuration.
The remaining speech interfaces prepare the installed models and listen or speak directly; voice activation cannot initiate a model download.
Cleanup checks passed 66 app suites with 812 tests, 21 local capability tests, app/package lint and TypeScript checks and production JavaScript bundling.

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
The committed-source importer is implemented, but no upstream revision has been imported with it yet.
Ending the fork still requires upstream reveal/backdrop support, camera/framing compatibility, load identity and failure contracts, native binding migration and native validation.
The optional-label branch is under concurrent revision and has not been integrated here.
Import-tool tests do not establish engine integration or physical acceptance.

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

## Example machine responsibilities

The authored recreation in `splat-tools` revision `5ef447d` gives R01 underbody floor/sill joints, R02 door-opening frames, R03 upper pillars/roof rails and R04 rear-quarter/crossmember joints.
All 44 segmented parts have purpose notes tied to `miris-example-process-v1`, and a seven-step learning procedure links the four responsibilities to their stable robot, arm, wrist and gun IDs.
The 43 dataset images were reviewed for scene context; task allocation is invented at the owner's request and does not establish the true production cycle.
The locally integrated `miris-pilot/1` manifest SHA-256 is `35c3f6ac8e7d9c6e5ac3da900dfe3fed7bb1913c0defd180333c38aa62dec995`; geometry, labels, part bounds, anchors and camera match the prior verified pack.
The 88 vectors were regenerated offline in `teaching-02/vectors-machine-roles-v3`, and four English role queries rank the intended robot first across all text rows.
Component visual retrieval retains the preceding export's ranking results after removing task prose from component embedding sentences.
Full consumer validation passes; source checks pass 835 app tests, app lint/types, ten pack-tooling tests, 24 preparation tests and 128 subtests.
The preparation run skips one optional Turtle parser check and excludes the pre-existing LOD builder CLI mismatch after recording its failure.
The unsigned iOS Simulator Debug build passes, and its bundled pack passes full consumer validation with the exact final manifest digest.
Device verification is blocked by `DEVICE_IN_USE` on the Field Guide iPad after one bounded retry; no other session was reused or closed, and physical acceptance remains open.
The refresh command preserves the existing representation while rebuilding content, graph and vector references; surrounding factory objects still require accepted segmentation before they can be selected.

Robot display names now lead with function: Chassis welder, Door-frame welder, Roof welder and Rear-body welder.
Stable IDs and prior names remain search aliases; robot summaries are one sentence and learning steps start with their action, with the example qualification retained once at the beginning.
This content-only refresh is sourced at `splat-tools` revision `0eb3eb0`, with local manifest SHA-256 `94822c182756dca390816bffc9edfecc4ed40f65f0f177e71b937da5f9aa2c7b`.
Full consumer validation, 24 preparation tests, 128 subtests and four role-retrieval checks pass; the prior optional parser skip and LOD tool prerequisite remain unchanged.
No app code, geometry, accepted masks or stable IDs changed; the updated pack has not been installed or visually accepted on a device.

## Machine ownership and cited relationships

A regression reproduces the screenshot's interleaving of components from different robots when the generated tour globally sorts by camera position.
The tour now presents each machine before its components and follows supplied stationary-support and carrying links within the machine.
Short local component names retain stable IDs and legacy aliases; flat search shows the owning machine and accepts owner-plus-part queries.
KUKA mechanical relations preserve MA KR QUANTEC-2 K+P V6 (26.01.2024), sec. 2.2, pp. 16-17 and sec. 9.9, p. 353, Fig. 9-63 in each edge's source, with an applicability ledger in `splat-tools/content/miris-pilot/cell.md`.
Stationary bases use `supports`; image-only hose routing uses `routes`, without media or flow claims.
Turtle also retains ordered procedure steps, cautions and stable component references; these links express learning order rather than a recovered production dependency.
The exact local manifest SHA-256 is `a2d51b4f71fcc8d1d1f4814c1c150d415e1600526f4a24ee8bb97e3db8915b77`, with the preceding geometry and label files preserved.
The vectors in `teaching-02/vectors-relations-v3` preserve the previous visual comparison values while using independently authored operator summaries; the declared preprocessing identity records the visual-text override.
Checks pass 840 app tests, lint/types, ten pack-tooling tests, 28 preparation tests and 128 subtests, full consumer validation and production iOS JavaScript bundling.
The existing optional preparation skip and unrelated LOD-builder CLI prerequisite remain unchanged.
Both existing iPads reject acquisition with `DEVICE_IN_USE`, and their sessions were preserved.
The new `Miris relationship QA` iPad Air 13-inch M3 simulator, `BC7C5D9B-7843-4221-8964-AA5C953F097B`, was created, but T3 still omits it after discovery and rejects `device_open` with `No device ... on This machine`; it has not been booted or visually accepted.
The app at `apps/field-guide/ios/build/relationship-ui/FieldGuide.app` is prepared with the exact validated pack for the pending simulator installation; no physical acceptance is claimed.

## Blue interface and splat-count clarification

The interface primary is now the supplied reference blue `#00369E`, with white text and a lighter `#7DA7FF` foreground accent for legibility on graphite.
Current-step badges and the enabled voice toggle use the darker fill, and the shared sheen and pressed states use blue instead of yellow.
Calculated contrast is 10.39:1 for white on the primary and 6.47:1 for the foreground accent on raised surfaces.
The Dev panel now calls its manifest-derived number Pack splats; it does not present that number as the count drawn in a frame.
The current local tier contains 3,311,590 leaves and 3,690,045 tree nodes, while the host inherits `kDefaultLodBudget = 1200000` from `SplatWorldLoader.cpp` and uses 0.75 render scale.
The actual selected/drawn count and GPU cost have not been measured on the target iPad, so no higher budget or device performance claim is accepted here.
Validation passes 840 app tests, lint, TypeScript and production iOS JavaScript bundling; this color change has no new simulator or physical acceptance.
