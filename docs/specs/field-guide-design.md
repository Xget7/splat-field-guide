# Field Guide design

Field Guide presents a captured picture of equipment with named parts, procedures and an instructor.
The library opens a bundled guide into exploration, a maintenance procedure or a parts tour.
Reading mode accepts typed questions; voice mode listens continuously and supports interruption.
Targets and physical acceptance are in [REQUIREMENTS.md](../../REQUIREMENTS.md) and [TASKS.md](../../TASKS.md).

## Pack contract

[parsePack.ts](../../apps/field-guide/src/features/pack/parsePack.ts) is the consumer schema used by preparation and pipeline publication.
Manifest schema 1 contains pack identity/version, tiers, camera limits/home, parts, procedures and knowledge.
Each tier records cloud and label paths, byte counts, SHA-256 digests and a splat count.
The cloud is gzip SPZ version 3 in RUB coordinates.
The little-endian labels.bin header is 16 bytes: `SFGL`, u16 version 1, u16 label width 1, u32 splat count and u32 reserved zero.
One u8 label follows for each SPZ splat; zero means no part and labels 1-255 identify parts within that representation.
Part IDs persist across pack versions; labels and cloud indices belong to a tier.
The optional `sources` field binds capture/reconstruction digests, PLY, labels, lifting report, content, knowledge and the exact part-to-label mapping.
Preparation verifies the pinned manifest and runtime bytes; the native loader verifies supplied digests and the decoded source count.
Filtering and spatial reordering carry labels with every splat attribute.
Source artifacts and publication diagnostics stay outside the distribution archive.

## Session rules

[session.ts](../../apps/field-guide/src/features/guide/session.ts) holds procedure ID, zero-based step position and an optional selected part.
Start resets position and selection; next/back move within procedure bounds and clear selection when position changes.
Repeat clears a selection override; invalid events preserve the state.
Selecting a part overrides step emphasis, and selecting empty space clears selection.
[derive.ts](../../apps/field-guide/src/features/guide/derive.ts) expands selected or step parts through their children for highlight and framing.
With no procedure or selection, framing uses the bounds of all parts.
Stop and Finish clear saved continuation; Explore preserves it, with ordered native storage writes preventing a delayed save from restoring cleared progress.
Instructor replies follow [ADR 0006](../adr/0006-commands-and-ordered-instructor-fallback.md); provisional streams do not commit session actions.

## Ownership

| Unit | Owns |
| --- | --- |
| `src/App.tsx`, `src/app` | Startup, navigation, catalog context and the native progress adapter |
| `src/features/pack`, `src/features/guide` | Pure pack parsing/catalog and session, tour, progress, highlight and framing rules |
| `src/features/instructor` | Command routing, turns, authored grounding, model adapters and voice |
| `src/features/viewport` | Native viewer readiness, gestures, camera conversion, framing and projected markers |
| `src/screens`, `src/ui` | Screen composition and view models, then business-free presentation primitives |
| `react-native-splat` | Shared C++ viewer behaviour, Metal/Vulkan rendering, Nitro views, iOS spatial placement/assembly and provisional AR alignment |
| `react-native-on-device` | Platform speech, iOS Apple generation/Kokoro and audio coordination |
| `instructor-proxy`, `pipeline` | Cloud request policy/stream translation, then pack preparation |

Screens compose the lower units; pack/guide remain free of React and native imports, and UI imports no business code.
The iOS-only AR screen checks recognition and four landmarks with a separately prepared reference; it stays hidden unless `AR_CHECK_ENABLED` is set, and physical alignment and semantic camera masks remain open.

## Spatial assembly

The library opens a standalone V8 assembly tour on iOS, separate from the Gol guide and its procedures.
[ADR 0010](../adr/0010-spatial-assembly-uses-authored-usdz-parts.md) records the representation and ownership.
The prepared USDZ retains 128 named parts; the visual tour groups them into 12 steps with fasteners included alongside their assemblies.
The tour starts with the crankshaft already installed; large parts enter one at a time and repeated fasteners or valve springs enter together.
Going back reverses that sequence while retaining the crankshaft.
The native assembly state machine owns the completed prefix, playback phase and command identity.
RealityKit playback completion from every controller in the active group advances the completed prefix.
Next remains available during forward assembly and completes the current step immediately before animating the following step.
Later parts remain hidden; only the upcoming part or repeated group appears after the preceding movement completes or is explicitly skipped.
Part translations take 1.35 seconds, and the complete preview preserves the current step when returning to the tour.
Compact native glass controls keep the next action above the bottom safe area and secondary actions in an optional menu.
The camera detects horizontal surfaces, and placement rechecks the centre ray against detected plane geometry before creating an anchor.
Scale and rotation apply to the equipment while part animations and the anchor preserve their positions.
The tour starts 50 centimetres above the detected surface, with adjustable elevation from zero to two metres independent of model scale.
Tracking loss hides the equipment until tracking recovers; interruption recovery requests a fresh placement.
This visual sequence is not a reviewed mechanical assembly procedure.
The assembly screen credits little.bucket and the capture's CC BY-NC 4.0 license.
