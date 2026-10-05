# Splat Field Guide: original design

Status: historical plan from 2026-09-29, reconciled with the implementation on 2026-10-05.
Current targets are in [REQUIREMENTS.md](../../REQUIREMENTS.md), evidence in [TASKS.md](../../TASKS.md), and architecture in the [root README](../../README.md) and [agent guide](../../AGENTS.md).

## Original intent

Build a mobile maintenance guide around the engine bay of a 2010 VW Gol Trend 1.6.
The intended demonstration joined capture preparation, native rendering, named parts, procedure guidance and an offline instructor.
The engine came from an inherited SplatKit copy; it was not all new work for this guide.

## What changed

| Original proposal | Implemented direction |
| --- | --- |
| iOS and Android together | iOS/iPadOS 26+, with Android native adapters deferred |
| Sky-blue highlight | Marine blue #0A6CFF, with the rest slightly dimmed |
| Tablet layout later | iPad-first layout alongside iPhone portrait |
| AR anchoring later | Provisional iPhone iOS 27 recognition/four-landmark check; full masks still proposed |
| Apple-first instructor with tools | Commands first, Claude/Apple/scripted order and validated text replies |
| Expo recognition, platform speech, half duplex and push-to-talk | Native Apple transcription, bundled Kokoro/Apple output and continuous voice with interruption |
| First-launch verified installation and pack-server updates | Prepared resources copied at build time; downloaded updates deferred |
| All-Modal, input-hash-cached pipeline | Local COLMAP/Brush/lifting/export, with SAM on Modal |
| LiDAR metric scale | Approximate battery-derived scale, with physical dimensions still to verify |
| Lifting onto decoded final SPZ | PLY-order lifting, with cloud/labels cropped and exported together |
| Fixed tier budgets and every splat drawn | Recorded Brush growth ceiling and runtime haze/sparse filtering, without LOD |
| Content reviewed against the owner's manual | Authored content with [source qualifications](../../content/gol-trend-engine-bay/SOURCES.md); manual/physical review pending |
| Separate ARCHITECTURE.md | Architecture in the README, AGENTS.md, app setup and ADRs |

Changed decisions supersede the old records in [ADR 0012](../adr/0012-text-instructor-with-ordered-fallback.md), [0013](../adr/0013-local-pipeline-with-modal-sam.md) and [0014](../adr/0014-bare-react-native-with-nitro-packages.md).
[Kokoro](../adr/0015-kokoro-with-vendored-english-frontend.md) records the added speech-output choice.

## Retained contracts

The pack holds versioned authored content, an SPZ cloud and a labels sidecar for each tier.
`labels.bin` uses a 16-byte header: magic `SFGL`, u16 version 1, u16 label width 1, u32 splat count and u32 reserved zero, followed by one u8 label per SPZ splat.
Zero means no part; labels are local to the pack representation, while part IDs persist across versions.
The app accepts schema 1 with an optional source-identity extension; preparation validates the actual app schema and shipped file identities before bundling.
Native loading also checks manifest-provided file digests and the expected decoded splat count.

The session's procedure position and selected part determine highlight and framing.
Selecting a part overrides step emphasis until the step changes; a parent highlight includes its children.
The shared C++ implementation owns picking and camera geometry; the iOS adapter owns its view and scheduling.
Model calls and transcription use separate native interfaces.

## Historical acceptance targets

| Target | Original budget or timing |
| --- | --- |
| iPhone orbit | 60 fps, up to 1.5M splats |
| Android orbit | 30 fps, up to 500k splats, platform now deferred |
| Idle | No unchanged frames drawn |
| iPhone first frame | Under 3 seconds |
| Command response | Under 300 ms after speech ends |
| Instructor first words | Under 1.5 seconds |
| Delivery | 60 to 90 second airplane-mode iPhone video, TestFlight and public repository |

These are historical targets, not measured results.
The current high-tier export has about 2.5M splats before filtering; sustained device frame rate, offline voice, delivered video and TestFlight remain acceptance work.
First-launch offline voice requires transcription/model assets already available on the device.
The seven-day schedule was a planning estimate, not evidence of completion.
