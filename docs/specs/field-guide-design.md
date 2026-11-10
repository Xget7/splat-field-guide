# Miris architecture map

Miris turns prepared factory content into an offline guide with part selection, procedures and an instructor.
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
Startup supplies no pack until real Miris content is integrated; the library shows its empty state.
**Rule:** features never import app composition or construct unrelated provider lifecycles.
**Read:** [startup](../../apps/field-guide/src/app/App.tsx), [navigation](../../apps/field-guide/src/app/navigation/RootNavigator.tsx), [platform wiring](../../apps/field-guide/src/app/platform.ts).
**Verify:** [app tests](../../apps/field-guide/src/app/tests/App.test.tsx).

## Library

**Owns:** discoverable guide entries, availability and opening a session.
**Rule:** discovery chooses a session start; guide rules own its subsequent position.
**Read:** [public interface](../../apps/field-guide/src/features/library/index.ts), [presentation](../../apps/field-guide/src/features/library/views.ts), [catalog](../../apps/field-guide/src/features/pack/catalog.ts).
**Verify:** [library tests](../../apps/field-guide/src/features/library/tests/library.test.tsx).

## Pack and delivery

**Owns:** content validation; planned delivery adds verified installation, activation and recovery.
**Rule:** stable part IDs outlive reconstructions; labels, bounds and anchors belong to a particular representation.
Activate matching files and records together; failed replacement must preserve the last usable installation.
The current schema uses `.lodsplat` and one label byte per tree node, with zero unlabelled and 1-255 available part labels.
A part's `parent` is Brick `brick:hasPart`; optional `relations` add `feeds` (`brick:feeds`, media flow), `carries` (kinematic support), `drives` (actuation) and `adjacent` (measured proximity, stored once).
Each relation names two different known parts, appears once and keeps `authored` or `measured` evidence with a source; `carries` stays acyclic.
The optional `model` file is the Brick/Turtle graph of the same facts; tooling verifies and bundles it, and the app never parses it.
Schema 2 treats absent `relations`, `model` and `semantic` keys as none; the [component graph](../../apps/field-guide/src/features/pack/graph.ts) answers connections, neighbours, the carries chain, the feed path and the top-level assembly from the pack alone.
**Read:** [types](../../apps/field-guide/src/features/pack/pack.ts), [parser](../../apps/field-guide/src/features/pack/parsePack.ts), [component graph](../../apps/field-guide/src/features/pack/graph.ts), [bundled source paths](../../apps/field-guide/src/features/pack/bundledPack.ts), [validation entry](../../scripts/validate-pack.cjs), [label format](../../packages/react-native-splat/engine/splat-core/include/splat/formats/PartLabels.h).
**Verify:** [parser tests](../../apps/field-guide/src/features/pack/tests/parsePack.test.ts), [graph tests](../../apps/field-guide/src/features/pack/tests/graph.test.ts), [pack tooling tests](../../tests/pack-build.test.cjs).
**Pending:** [installation and replacement](../../TASKS.md#app-integration); a network request cache is not a file installer.
Viewer controls for moving along relations and agreement on the exporter's real output are also pending.

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
Typed answers fall back from Claude to Apple generation to scripted guidance; Android skips Apple generation.
Prompts list the subject's supplied connections with their evidence source, so answers about what a part is connected to stay grounded.
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
**Read:** [Nitro contract](../../packages/react-native-splat/src/SplatView.nitro.ts), [C interface](../../packages/react-native-splat/engine/splatkit-engine/include/splatkit/sfg.h), [GPU stages](../../packages/react-native-splat/engine/splatkit-ios/README.md), [import receipt](../../packages/react-native-splat/engine/splatkit-engine/UPSTREAM).
**Verify:** [C-interface tests](../../packages/react-native-splat/engine/splatkit-engine/tests/sfg/SfgTest.cpp), [Metal tests](../../packages/react-native-splat/engine/splatkit-ios/tests), [profiling operations](../agents/checks.md#gpu-profiling).

## On-device capabilities

**Owns:** microphone ownership, recognition, synthesis, interruptions and supported local generation.
**Rule:** cancellation rejects stale callbacks and releases active resources; instructor owns equipment evidence and answer policy.
iOS uses CPU Kokoro with system fallback; Android uses system voices and has no local generation.
Fresh-device offline availability depends on prepared system assets.
**Read:** [lazy entry points](../../packages/react-native-on-device/src/index.ts), [input](../../packages/react-native-on-device/src/SpeechInput.nitro.ts), [output](../../packages/react-native-on-device/src/SpeechOutput.nitro.ts), [audio link](../../packages/react-native-on-device/src/AudioLink.nitro.ts), [generation](../../packages/react-native-on-device/src/LanguageModel.nitro.ts).
**Verify:** [native capability tests](../../packages/react-native-on-device/__tests__), [device acceptance](../../TASKS.md#acceptance).

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
**Read in the sibling workspace:** [overview](../../../splat-tools/README.md), [operations](../../../splat-tools/operations.md).
**Mobile prerequisites:** [preparation tasks](../../TASKS.md#product-and-preparation), [recorded handoff](../../TASKS.md#preparation-evidence).

## Cross-area changes

Follow the data: installed pack to guide to viewer; request to instructor to accepted guide action.
Keep invariants with their owner, inject dependencies at composition and test through the interface callers use.
For a change crossing areas, read both linked interfaces and their tests before editing; follow [contribution rules](../../CLAUDE.md).
