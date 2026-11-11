# Miris architecture map

Read [first principles](first-principles.md) for the domain rules behind these interfaces.

Miris targets an iOS guide to the whole factory cell and car process, joining splats, CAD and local ML through stable segmentation IDs.
The current app has viewer, guide and instructor foundations; Miris delivery and semantic integration are pending.
Use [tasks](../../TASKS.md) for status/acceptance and [operations](../agents/checks.md) for commands.

## Find the owning area

Read the matching area, then its linked interface and tests before editing.
Each area names the complexity it owns and the rule that callers must preserve.

- Startup, dependencies or navigation: [App](#app).
- Guide discovery: [Library](#library).
- Manifest, runtime files or updates: [Pack and delivery](#pack-and-delivery).
- Persistent knowledge or vector ranking: [Semantic data](#semantic-data).
- Procedure position, selection or continuation: [Guide](#guide).
- Commands, answers or voice modes: [Instructor](#instructor).
- Gestures, overlays or native readiness: [Viewer presentation](#viewer-presentation).
- Drawing, geometry, load lifetime or profiling: [Native viewer and GPU](#native-viewer-and-gpu).
- Microphone, synthesis or local generation: [On-device capabilities](#on-device-capabilities).
- Provider requests, credentials or agent configuration: [Online services](#online-services).
- Shared presentation or platform access: [Shared foundations](#shared-foundations).
- Annotations, lifting or embeddings: [External preparation](#external-preparation).

## App

**Owns:** startup, navigation and dependency composition; screens receive configured capabilities.
Startup supplies no pack until real Miris content is integrated; the course shell presents the Automotive Assembly Line demonstration without mounting a native scene.
**Rule:** features never import app composition or construct unrelated provider lifecycles.
**Read:** [startup](../../apps/field-guide/src/app/App.tsx), [navigation](../../apps/field-guide/src/app/navigation/RootNavigator.tsx), [platform wiring](../../apps/field-guide/src/app/platform.ts).
**Verify:** [app tests](../../apps/field-guide/src/app/tests/App.test.tsx).

## Library

**Owns:** the course entry shell, module presentation, discoverable guide entries, availability and opening a session.
**Rule:** discovery chooses a session start; guide rules own its subsequent position.
**Read:** [public interface](../../apps/field-guide/src/features/library/index.ts), [presentation](../../apps/field-guide/src/features/library/views.ts), [catalog](../../apps/field-guide/src/features/pack/catalog.ts).
**Verify:** [library tests](../../apps/field-guide/src/features/library/tests/library.test.tsx).

The course shell uses `ui/courseTokens.ts` for neutral charcoal surfaces, system typography and 8-point spacing.
Controls have a minimum 48-point touch area; 16/24-point corner radii distinguish controls and page surfaces.
The sidebar collapses in narrow windows and the hero and module cards stack below 1056 points or with large text.
`CourseNavigation`, `CourseOverview`, `CourseComposer` and `ModuleCard` compose the entry screen without a WebView.
Course tabs use text only, the source attachment is a filename card, and the composer has exactly two grounded example questions and an upward send control.
The viewer chrome shares the charcoal palette and the yellow primary with the course shell.
The primary marks only the current step or part, active tools and the forward action, with black ink on filled controls; warnings use orange so they never read as the primary.
Native part-selection tint remains an independent renderer contract; UI palette changes do not alter GPU highlighting.
The three module names are demonstration presentation, not installed learning content or a new pack identity.
Course-wide answers, PDF opening and downloads currently show explicit availability states; no remote request or generated equipment claim is made.
The entry links to Downloads, where course content and shared Voice & AI resources have separate status cards.
The sidebar selects global destinations Courses, Downloads and Help; only Courses renders the selected course breadcrumb and its Course, Modules, Documentation and Assistant tabs.
Switching a global destination preserves the course tab and draft without presenting course navigation inside Downloads or Help.
A ready model set is labelled Models ready, never evidence that a course is available offline.
The demonstration course remains unavailable offline until its required content has a verified installation; a catalog scene alone does not satisfy that condition.
Model controls pause, continue or retry the existing ExecuTorch preparation, while unavailable course delivery has no simulated download action.
Ready catalog entries and saved continuation still enter the existing guide and viewer interfaces.

## Pack and delivery

**Owns:** content validation; planned delivery adds verified installation, activation and recovery.
**Rule:** stable part IDs outlive reconstructions; labels, bounds and anchors belong to a particular representation.
Activate matching files and records together; failed replacement must preserve the last usable installation.
The current schema uses `.lodsplat` and one unsigned 16-bit little-endian label per tree node, with zero unlabelled and 1-65535 available part labels.
SFGL v2 has ASCII `SFGL` at offset 0, u16 version 2 at offset 4, u16 width 2 at offset 6, u32 node count at offset 8 and u32 reserved zero at offset 12, all integers little-endian.
The payload starts at offset 16, aligned to two bytes, and contains exactly `nodeCount * 2` bytes without trailing padding.
Readers reject SFGL v1; regenerate existing packs before packaging.
GPU label uploads pad to four-byte words, with two labels per word, independently of the file layout.
Highlighting uses a 65,536-entry storage-buffer style lookup, including zero, to preserve per-label fades across the full range without uniform-buffer limits or changes to captured rendering.
The lookup occupies 2 MiB plus a 16-byte reveal prefix per frame slot; CPU styles and upload staging live on the heap.
A part's `parent` is Brick `brick:hasPart`; optional `relations` add `feeds` (`brick:feeds`, media flow), `carries` (kinematic support), `drives` (actuation), `supports` (stationary mechanical support), `routes` (visible routed connection without media or flow direction) and `adjacent` (measured proximity, stored once).
Each relation names two different known parts, appears once and keeps `authored` or `measured` evidence with a source; `carries` and `supports` form one acyclic mechanical graph.
The optional `model` file is the single annotated Brick/Turtle graph alongside the manifest; tooling verifies and bundles its bytes, and the app never parses it.
The exporter includes notes, hierarchy evidence, vector metadata and procedure steps with next-step and stable component links; aliases and details remain omitted.
Mechanical relation sources retain the KUKA document edition, section, page and figure; a visual route cannot become a documented media feed.
The generated tour introduces each top-level machine before its components, follows supplied support and carrying links within that machine and orders only the machine roots by the home camera.
Search results show the owning machine for repeated local component names.
Manual references are currently prose attached to part IDs; CAD file/node/transform joins and the proposed cell relation kinds have no contract yet.
Schema 2 treats absent `relations`, `model` and `semantic` keys as none; the [component graph](../../apps/field-guide/src/features/pack/graph.ts) answers connections, neighbours, the carries chain, the feed path and the top-level assembly from the pack alone.
Planned installation contract, not yet implemented:
An installation is the immutable directory `Application Support/<bundle-id>/packs/<packId>/<packVersion>/`, holding the signed manifest bytes, its signature and every runtime file; nothing inside is written after it is renamed into place.
Staging lives in `packs/<packId>/.staging-<packVersion>/` inside the same directory tree, with each transport chunk named by its SHA-256 so the files present are the resume state; caches and temporary directories hold nothing an installation depends on.
`packs/` is excluded from backup at directory level and the exclusion is asserted again at every launch.
Activation has one commit point: atomically replacing `packs/<packId>/active.json`, which holds `packVersion` and `manifestSha256`; no symlink or key-value store records activation, and persisted paths are relative and resolved at launch.
Trust roots are Ed25519 public keys with key IDs compiled into the app, rotated or revoked only by an app update; the app verifies the signature over the exact manifest bytes, with a size cap, before parsing them.
The signed manifest carries `packId`, `packVersion`, the required schema, SFGL and `.lodsplat` versions, each transport chunk's digest and size and each runtime file's final digest.
The app refuses a manifest whose `packVersion` is below the highest it has activated for that `packId`, or that reuses an activated `packVersion` with a different manifest digest.
Before transfer the app requires important-usage capacity for the remaining chunks, the final files and a margin, and keeps the previous installation until the new one is ready.
A chunk is accepted only when its digest matches; final files must match their manifest digests and their format headers before staging is renamed to its version.
At launch an installation is usable when its pointer, manifest, signature and file sizes agree; the engine digest-verifies geometry and labels on every load and the vectors file is digest-verified when read.
Recovery at launch deletes staging that matches no verified manifest, treats a verified version newer than the active one as installed but not activated, and keeps only the active and previous versions.
A failed verification marks the version unusable and falls back to the previous installation, never to partial data; a bundled pack is the fallback only when no installed version verifies.
Installed files are removed only by unlink, after no mounted viewer or open session references their version, and are never truncated, overwritten or renamed.
A new installation takes effect by remounting the viewer keyed by `packId@packVersion`, never by changing the source under a mounted session, so records, highlight and picks cannot cross versions and the old world's GPU memory is released before the new one is decoded.
Planned CAD contract, not yet implemented:
A CAD join belongs to a representation mapping: part ID, CAD file `{path, bytes, sha256}`, node path and a 4x4 similarity transform from CAD to splat frame, with its scale, the reconstruction SHA-256 it applies to, the registration method and the residual in splat units.
Articulated equipment carries one join per rigid link in its captured pose.
The Miris source is photographs and point clouds of an approximate recreation, so CAD for it is authored or adopted reference geometry made exact by this project, and each join records that origin as its evidence.
CAD never depth-tests against splats until a soft-depth composite is accepted on hardware; a cross-fade or an overlay drawn after the splats comes first.
**Read:** [types](../../apps/field-guide/src/features/pack/pack.ts), [parser](../../apps/field-guide/src/features/pack/parsePack.ts), [component graph](../../apps/field-guide/src/features/pack/graph.ts), [bundled source paths](../../apps/field-guide/src/features/pack/bundledPack.ts), [validation entry](../../scripts/validate-pack.cjs), [label format](../../packages/react-native-splat/engine/splat-core/include/splat/formats/PartLabels.h).
**Verify:** [parser tests](../../apps/field-guide/src/features/pack/tests/parsePack.test.ts), [graph tests](../../apps/field-guide/src/features/pack/tests/graph.test.ts), [pack tooling tests](../../tests/pack-build.test.cjs).
**Pending:** [installation and replacement](../../TASKS.md#app-integration); a network request cache is not a file installer.
Secure remote chunk transfer, manifest authentication, on-device processing, viewer relation controls and acceptance of the regenerated export are pending.

## Semantic data

**Owns:** compatible-vector ranking to stable part IDs; persistent prepared knowledge and reconstruction mappings are planned.
**Rule:** WatermelonDB owns local records, TanStack Query owns API state and Zustand holds transient state.
Use one database writer; reject incompatible vector spaces even when dimensions match.
The optional pack `semantic` block names the vector space (64-hex id, encoder, weights digest, preprocessing, dimensions, `normalized: true`), the `vectors` file and one row per part and kind (`image` or `text`).
The vectors file holds little-endian float32 rows in row order, so its byte count must equal rows times dimensions times four; tooling also checks each row is finite and unit length.
[Part vectors](../../apps/field-guide/src/features/semantic/domain/partVectors.ts) rank one kind by cosine and refuse another space id, a wrong-length query and a buffer that disagrees with the manifest.
Mobile receives both comparison vectors; it does not generate embeddings or infer physical relationships from similarity.
**Read:** [public interface](../../apps/field-guide/src/features/semantic/index.ts), [pack types](../../apps/field-guide/src/features/pack/pack.ts), [app dependencies](../../apps/field-guide/package.json), [integration tasks](../../TASKS.md#app-integration).
**Verify:** [vector tests](../../apps/field-guide/src/features/semantic/tests/partVectors.test.ts).
**Pending:** reading the vectors file from an installed pack, reconstruction identity for mappings and persistent records.
WatermelonDB and TanStack Query are not installed.
The preparation pipeline produces every embedding, query vectors included; the app is a viewer and query client and never runs an encoder.

## Guide

**Owns:** deterministic session transitions, selection overrides, child expansion, framing and saved continuation.
**Rule:** viewer and instructor submit events; guide rules decide the resulting procedure position and emphasis.
A session is the current position; progress is its saved continuation.
**Read:** [public interface](../../apps/field-guide/src/features/guide/index.ts), [session rules](../../apps/field-guide/src/features/guide/domain/session.ts), [highlight/framing](../../apps/field-guide/src/features/guide/domain/derive.ts), [progress storage](../../apps/field-guide/src/features/guide/data/progressStorage.ts).
**Verify:** [session tests](../../apps/field-guide/src/features/guide/tests/session.test.ts), [progress tests](../../apps/field-guide/src/features/guide/tests/progressStorage.test.ts).

## Instructor

**Owns:** grounded turns, accepted session actions and online/offline voice coordination.
**Rule:** commands resolve locally; provisional or cancelled answers never commit session actions.
Typed answers fall back from the remote proxy to ExecuTorch generation to scripted guidance on both iOS and Android.
Local generation explains supplied pack text and never computes embeddings; Miris hardware acceptance remains open.
Prompts list the subject's supplied connections with their evidence source, so answers about what a part is connected to stay grounded.
The local flow uses ExecuTorch 0.11.0 for Whisper Base English recognition with VAD, Kokoro synthesis and Qwen2.5 1.5B Instruct generation.
The initial locale remains `en-US`.
The Whisper preset has no per-pack vocabulary-bias option.
CPU XNNPACK is selected for both platforms to avoid sharing the viewer's GPU; memory, thermal behaviour and grounded answer quality still need physical acceptance.
Recognition, synthesis and answers use separate worklet runtimes so long generation cannot occupy the recognizer's queue.
The on-device prompt admits the subject, its steps and safety note, then supplied connections, notes and measured proximity nearest first, with optional evidence yielding to the budget.
Required procedure and safety context exceeding the prompt budget fails the turn rather than losing instructions.
Generation starts a fresh session per answer, uses greedy sampling and reserves 384 reply tokens; cancellation, malformed responses and token-limit stops fail the turn.
Keep its three concerns behind separate internal interfaces:

- **Turn policy:** [router](../../apps/field-guide/src/features/instructor/domain/router.ts), [turn runner](../../apps/field-guide/src/features/instructor/domain/turn/turnRunner.ts), [grounding](../../apps/field-guide/src/features/instructor/domain/grounding.ts); [turn tests](../../apps/field-guide/src/features/instructor/tests/turnRunner.test.ts).
- **Voice lifecycle:** [voice-session contract](../../apps/field-guide/src/features/instructor/domain/voice/voiceSession.ts), [mode controller](../../apps/field-guide/src/features/instructor/domain/mode/modeController.ts); [mode tests](../../apps/field-guide/src/features/instructor/tests/modeController.test.ts).
- **Composition and presentation:** [factory](../../apps/field-guide/src/features/instructor/createInstructor.ts), [public interface](../../apps/field-guide/src/features/instructor/index.ts), [views](../../apps/field-guide/src/features/instructor/views.ts); [composition tests](../../apps/field-guide/src/features/instructor/tests/createInstructor.test.ts).

## Viewer presentation

**Owns:** native readiness, gestures, camera conversion and projected overlays.
**Rule:** translate guide state into native inputs and picks into selection events; keep procedure policy in guide and GPU scheduling in the engine.
**Read:** [state interface](../../apps/field-guide/src/features/viewer/index.ts), [views](../../apps/field-guide/src/features/viewer/views.ts).
**Verify:** [screen tests](../../apps/field-guide/src/features/viewer/tests/ViewerScreen.test.tsx), [pick tests](../../apps/field-guide/src/features/viewer/tests/pickInputs.test.ts).

## Native viewer and GPU

**Owns:** load ownership, geometry, picking, LOD, render-thread lifetime and GPU resources.
**Rule:** reject stale loads; report ready after the accepted first frame; stop rendering when detached and sleep when unchanged.
The shared C++ core owns behavior; Metal/Vulkan adapters draw, with the current 1.6-million-splat budget.
SplatKit changes land upstream before integration here.
The target boundary is SplatKit's public API at a pinned revision, with no app patches to engine sources.
Pack policy and identity requirements remain app-owned; generic rendering and loading mechanisms belong upstream.
The source importer in `packages/react-native-splat/scripts/engine-artifact.rb --import-source <repository> <full-commit>` exports committed package files without patching them and records their hashes in `engine-source.json`.
When that receipt exists, artifact verification also rejects source changes, missing files, extra files and executable-mode changes.
The current customized engine has not yet migrated to this importer; its native bindings still require the downstream C API.
Planned emphasis contract, not yet implemented:
Emphasis is a per-label state in {target, context, hidden} plus a view-dependent cutaway, and the engine owns the style of each state; a target's descendants are targets.
Highlight state is uploaded when it changes, as a one-byte state per label with a small style palette, not as a full style table every frame.
Splats outside the target set that lie in front of the target's projected bounds are faded by the cutaway, whatever their label, so fences, housings and neighbouring equipment cannot hide the target.
Merged tree nodes carry their dominant label, so styling is exact only at leaves.
A pick returns what the drawn frame shows, after styles and cutaway.
**Read:** [Nitro contract](../../packages/react-native-splat/src/SplatView.nitro.ts), [C interface](../../packages/react-native-splat/engine/splatkit-engine/include/splatkit/sfg.h), [GPU stages](../../packages/react-native-splat/engine/splatkit-ios/README.md), [import receipt](../../packages/react-native-splat/engine/splatkit-engine/UPSTREAM).
**Verify:** [C-interface tests](../../packages/react-native-splat/engine/splatkit-engine/tests/sfg/SfgTest.cpp), [Metal tests](../../packages/react-native-splat/engine/splatkit-ios/tests), [profiling operations](../agents/checks.md#gpu-profiling).

## On-device capabilities

**Owns:** microphone ownership, recognition, synthesis, interruptions and supported local generation.
**Rule:** cancellation rejects stale callbacks and releases active resources; instructor owns equipment evidence and answer policy.
ExecuTorch owns local speech recognition, phonemization, synthesis and answer generation on both platforms.
`react-native-audio-api` supplies one echo-cancelled microphone/playback module shared with the online PCM audio link.
The previous native Apple Foundation Models, platform speech and ONNX/Kokoro implementations are removed; a missing local model leaves reading, typing and scripted guidance available.
The app starts shared offline preparation automatically: verify device files, then download missing resources when the device has a network route.
The course, chat and voice observe the same checking, progress, ready or error state; offline availability is shown separately from online service availability.
Preparation survives screen changes, permits pause and retry, and recovers when the network route returns without retry loops.
Workers reuse the same verified device files, not a separate 1.8 GB set per account.
Downloading files never preloads Qwen, Whisper or Kokoro into memory and does not gate online answers.
It downloads only the pinned files in `modelAssets.json`, verifies size and SHA-256, and promotes each staged file after verification.
A complete set must pass verification before any inference factory can obtain local paths.
Verified files persist in the app's Documents directory; restore and inference make no network requests, while the startup coordinator may prepare missing files after restore.
The English part-of-speech tagger is omitted because its upstream Brown Corpus data is not cleared for commercial use; lexicon and neural phonemization remain available.
Preparing models is separate from downloading or activating a Miris scene pack.
**Read:** [lazy entry points](../../packages/react-native-on-device/src/index.ts), [capability contracts](../../packages/react-native-on-device/src/capabilities.ts), [model preparation](../../packages/react-native-on-device/src/local/modelStore.ts), [inference](../../packages/react-native-on-device/src/local/inference.ts), [audio](../../packages/react-native-on-device/src/local/audio.ts), [online audio link](../../packages/react-native-on-device/src/AudioLink.ts).
**Verify:** [capability tests](../../packages/react-native-on-device/__tests__), [device acceptance](../../TASKS.md#acceptance).

## Online services

**Owns:** secrets, signed voice sessions, provider stream translation and agent configuration.
**Rule:** incomplete streams fail; provider credentials remain outside the app; live requests and sync require explicit authorization.
Online voice uses ElevenLabs with Claude through the Worker; preparation models belong elsewhere.
**Read:** [Worker routes](../../services/instructor-proxy/src/index.ts), [stream handling](../../services/instructor-proxy/src/chatStream.ts), [agent configuration](../../services/voice-agent/src/agentConfig.ts), [sync](../../services/voice-agent/src/sync.ts).
**Verify:** [proxy tests](../../services/instructor-proxy/test), [agent tests](../../services/voice-agent/test); [configuration operations](../agents/checks.md#instructor-configuration).

## Shared foundations

**Owns:** business-free UI primitives and platform capability ports.
**Rule:** no feature imports into these modules; app composition supplies adapters.
Feature callers use `index.ts` or `views.ts`; pack and platform files use direct imports.
**Read:** [UI/theme](../../apps/field-guide/src/ui/theme.ts), [ports](../../apps/field-guide/src/platform/ports.ts), [storage port](../../apps/field-guide/src/platform/storage.ts), [dependency enforcement](../../apps/field-guide/.eslintrc.js).
**Verify:** [UI tests](../../apps/field-guide/src/ui/tests), [connectivity tests](../../apps/field-guide/src/platform/connectivity/tests), [shared test support](../../tests).

## External preparation

**Owns:** accepted annotations, reconstruction, lifting, embeddings, authored evidence and export.
**Rule:** verify camera-to-upright transforms before export; only accepted masks establish labels, and supplied relationships retain evidence.
**Read in the sibling workspace:** `splat-tools/README.md` and `splat-tools/operations.md` in the separate preparation checkout.
**Mobile prerequisites:** [preparation tasks](../../TASKS.md#product-and-preparation), [recorded handoff](../../TASKS.md#preparation-evidence).

## Cross-area changes

Follow the data: installed pack to guide to viewer; request to instructor to accepted guide action.
Keep invariants with their owner, inject dependencies at composition and test through the interface callers use.
For a change crossing areas, read both linked interfaces and their tests before editing; follow [contribution rules](../../CLAUDE.md).
