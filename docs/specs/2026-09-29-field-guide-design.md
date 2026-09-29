# Splat Field Guide: design

Status: draft for review, 2026-09-29.
Vocabulary: [CONTEXT.md](../../CONTEXT.md).
Decisions and their trade-offs: [docs/adr](../adr/).
Research behind them: [docs/research](../research/).

## 1. Purpose

A phone app that guides a person through maintenance of real equipment they are standing next to.
It shows a photoreal Gaussian-splat capture of the equipment, highlights any part on touch, walks through procedures step by step with the relevant parts highlighted, and answers spoken questions through an instructor that works offline.
The first equipment is the engine bay of a 2010 VW Gol Trend 1.6.

It is built in seven days as a demonstration for the engineers and CTO of a company that does this for defence training on tablets.
It must show mobile 3D rendering, React Native native-module craft, offline-first design, on-device AI and a GPU asset pipeline, all end to end and all mine.

## 2. Success criteria

- A 60 to 90 second video recorded on a physical iPhone 17 Pro, in airplane mode, showing: orbiting the engine bay, tapping a part to highlight and explain it, running a procedure by voice with each step highlighting its parts, and asking the instructor a free question answered on device.
- A TestFlight build of the same app.
- An Android APK that runs the same guide on a physical Xiaomi Mi 9.
- A public repository whose README, architecture notes and ADRs let a reviewer understand every decision in minutes.
- Every claim in the docs states whether it was verified on a physical device or an emulator.

## 3. Scope

In:
- One pack for one piece of equipment, about eight parts and three procedures.
- iOS (Metal) and Android (Vulkan) from one React Native 0.87 app.
- Orbit, pinch zoom, optional gyroscope look, tap to pick, animated framing.
- Highlight: emphasise the parts of the current step or the picked part, dim the rest.
- Instructor with tools on iOS (Apple Foundation Models); commands on both platforms; remote instructor for Android when online.
- Hands-free voice during a running procedure, push-to-talk always.
- Offline-first packs: one bundled, updates downloaded and verified.
- The pipeline from photos to pack on Modal.

Out, stated as next steps in the README:
- AR anchoring of the guide onto the real equipment (ARKit, ARCore).
- Apple Vision Pro: the C++ core and Metal backend carry over, drawing through Compositor Services instead of a view; the app layer would follow React Native's visionOS fork.
- More than one piece of equipment, pack authoring inside the app, tablet layout.
- Accounts, device management, enterprise distribution, syncing progress to a server.
- Languages other than English.

## 4. Architecture

```
splat-field-guide/
  packages/react-native-splat/     the library: engine inside, React Native outside
    cpp/                           shared core: cloud and labels, highlight, pick, orbit camera, framing, C interface
    ios/                           Metal backend and the Swift view (inherited backend, new view)
    android/                       Vulkan backend, Kotlin view and thin JNI (inherited backend, new view)
    src/                           TypeScript: <SplatView>, types, errors
  apps/field-guide/                the React Native app
    src/domain/                    Pack, Part, Procedure, Session; highlight and framing derivation
    src/instructor/                command router, instructor adapters, tools
    src/voice/                     listening and speaking
    src/packs/                     pack store: install, verify, update
    src/ui/                        screens and components
  pipeline/                        Python on Modal: capture to pack, plus the pack server
  content/gol-trend-engine-bay/    authored parts and procedures (YAML), reviewed against the owner's manual
  docs/                            specs, ADRs, research, ARCHITECTURE.md, PROVENANCE.md
```

Seams, each with the adapters that justify it:
- **Renderer** (C++): Metal and Vulkan backends.
- **Platform** (C interface `sfg.h`): the Swift view and the Kotlin view.
- **Instructor** (TypeScript): on-device Apple, remote, scripted.
- **Pack source** (TypeScript): bundled pack and pack server.

Everything that is not GPU work lives once in C++ ([ADR 0004](../adr/0004-shared-core-owns-behaviour.md)).
Everything the person does flows into one session, and the picture is derived from it: the UI, commands and the instructor all dispatch the same session events, and highlight and framing are computed from session plus pack, never set directly.

## 5. Modules

### 5.1 Engine core (C++17, `cpp/`)

Interface, as the C functions the platform views call:
- `sfg_create(config)` and `sfg_destroy(engine)`.
- `sfg_load(engine, spzPath, labelsPath)` returns a status; the cloud loads, labels are validated against it and both are uploaded.
- `sfg_resize(engine, width, height, scale)`.
- `sfg_draw(engine, seconds)` returns whether a frame was drawn; nothing is drawn when nothing changed.
- `sfg_orbit(engine, dAzimuth, dElevation)`, `sfg_dolly(engine, factor)`, `sfg_set_attitude(engine, quaternion)`.
- `sfg_set_camera_limits(engine, limits)` keeps the camera inside the well-captured angles.
- `sfg_set_highlight(engine, emphasisedLabels, count)`; an empty set means no highlight.
- `sfg_frame(engine, bounds, seconds)` animates the orbit anchor and radius to fit the bounds.
- `sfg_pick(engine, x, y)` returns the part label under the point, or zero.
- `sfg_project(engine, points, count, outXY)` for pinning part labels over the view.
- `sfg_camera_state(engine, out)`.

Inside:
- The cloud keeps part labels as one more field and permutes them with every other field during Morton reordering, so labels never lose alignment.
- `labels.bin` is rejected if its count differs from the cloud's.
- Picking casts the view ray against splat ellipsoids at about three sigma and returns the nearest confident hit; the cloud stays resident for it.
- The highlight becomes a 256-entry table of colour and opacity multipliers, one per label, handed to the backend each frame it changes.
- Inherited from SplatKit: SPZ decoding, Morton order, maths, the orbit camera.
  Dropped: walk camera, collider, tiles and streaming, level of detail, render policy.

### 5.2 GPU backends

Each backend implements `Renderer`: `upload(cloud)`, `resize(...)`, `draw(frameParams)`.
The 32-byte GPU splat record carries the part label in the slot SplatKit used for level of detail, so the record does not grow.
Shaders multiply each splat's colour and opacity by its label's table entry before culling, so dimmed splats cost less.
Metal (iOS) and Vulkan (Android) are inherited and pruned; the label lookup is new.

### 5.3 React Native library (`packages/react-native-splat`)

Exposed with Nitro Views ([ADR 0005](../adr/0005-nitro-views.md), pending its spike; fallback Fabric codegen).

```ts
type PartLabel = number // 1..255, 0 is none

interface SplatViewProps {
  source: { splatPath: string; labelsPath: string }
  highlight: PartLabel[]            // derived by the app from the session
  cameraLimits?: CameraLimits
  motionLook?: boolean              // gyroscope
  onReady(): void
  onError(e: { code: 'load-failed' | 'labels-mismatch' | 'gpu-unavailable'; message: string }): void
}

interface SplatViewMethods {
  orbit(dAzimuth: number, dElevation: number): void    // sync, callable from a gesture worklet
  dolly(factor: number): void
  frame(bounds: Bounds, seconds: number): void
  pick(x: number, y: number): Promise<PartLabel>
  project(points: ArrayBuffer, out: ArrayBuffer): number // sync, for label overlays
}
```

Threading: each view has its own render thread on both platforms that owns the GPU and drains queued calls.
Methods only enqueue; `project` reads the last published camera snapshot.
Gestures come from react-native-gesture-handler on the UI thread and call `orbit` and `dolly` directly; no per-frame traffic touches the JS thread.

### 5.4 App domain (`apps/field-guide/src/domain`)

```ts
type SessionEvent =
  | { type: 'start'; procedureId: string } | { type: 'next' } | { type: 'back' }
  | { type: 'repeat' } | { type: 'select'; partId: PartId | null } | { type: 'end' }

interface SessionState { procedureId: string | null; stepIndex: number; selectedPart: PartId | null }

function reduce(state: SessionState, event: SessionEvent, pack: Pack): SessionState
function highlightFor(state: SessionState, pack: Pack): PartLabel[]
function framingFor(state: SessionState, pack: Pack): Bounds | null
```

A pure reducer, not a state-machine library: the session has three fields and six events.
Selecting a part during a procedure overrides the step highlight until the next step.

### 5.5 Commands and instructor (`src/instructor`)

The command router runs first on every utterance and every typed question.
It maps fixed phrases to session events: next, back, repeat, stop, "start <procedure>", and "show me / where is <part or alias>".
Anything else goes to the instructor ([ADR 0007](../adr/0007-commands-before-instructor.md)).

```ts
interface Instructor {
  readonly kind: 'apple' | 'remote' | 'scripted'
  available(): Promise<boolean>
  answer(question: string, tools: InstructorTools): AsyncIterable<string>
}
```

Tools: `getPartInfo`, `getCurrentStep`, `listProcedures`, `startProcedure`, `nextStep`, `previousStep`, `showPart`.
Tools dispatch session events and return the new state, so the instructor can never drive the picture any other way.
Selection order: iOS apple, then scripted; Android remote when online, then scripted.
The scripted instructor answers from part descriptions by name match and says when it cannot.
The system prompt tells the instructor to answer from the pack only, to say so when it does not know, and to repeat safety cautions from the steps.

### 5.6 Voice (`src/voice`)

Speech recognition on device (Expo speech recognition: on-device on iOS, offline preferred on Android), with part names and aliases as contextual hints.
Speech output through the platform synthesiser.
Half duplex: listening pauses while the app speaks, so it never hears itself.
Continuous listening only while a procedure runs; a push-to-talk button is always visible.

### 5.7 Pack store (`src/packs`)

- First launch copies the bundled pack from the app into application support (iOS, excluded from backup) or internal files (Android), verifies it and activates it.
- Updates: read `index.json` from the pack server, download a newer version into a temporary folder, verify every file's SHA-256 natively (never in JS), rename the folder into place, then switch the active pointer.
- An interrupted or corrupted download is deleted and never activated.
- The app never needs the network to open an installed pack ([ADR 0006](../adr/0006-offline-first-packs.md)).

### 5.8 Pipeline (`pipeline/`, Modal)

Each stage is a Modal function keyed by the hash of its inputs, storing outputs on a Modal Volume, so reruns skip finished work ([ADR 0008](../adr/0008-pipeline-on-modal.md)).

1. **Ingest**: a Polycam raw export or a folder of photos becomes sorted JPEGs, with depth and gravity kept when present.
2. **Poses**: COLMAP on GPU; the model is levelled with the gravity vectors and scaled to metres with the LiDAR depth ([ADR 0009](../adr/0009-poses-from-colmap.md)).
3. **Train**: gsplat with the MCMC strategy, capped at the tier's splat budget, full resolution, 30k steps, inside the equipment's crop box.
4. **Export**: PLY to SPZ with no filtering, then decode that SPZ; every later stage works on the decoded cloud, in its order ([ADR 0003](../adr/0003-part-labels-sidecar.md)).
5. **Masks**: SAM 3.1, one text prompt per part (with optional click points from the content file), propagated through the photo sequence.
6. **Lift**: render the final cloud from every photo's camera with gsplat and accumulate each splat's contribution to each part's mask; a splat takes the part with the clear majority of its weight, otherwise zero; then a neighbourhood vote cleans stray labels.
   Per-part bounds (robust percentiles) and a label anchor are computed here.
7. **Review**: a turntable render of each part highlighted, for a human to approve before packing.
8. **Pack**: `labels.bin`, `manifest.json` from the content YAML plus computed bounds and camera limits, hashes, and a smaller tier if the Mi 9 needs one.
9. **Publish**: copy to the packs volume and update `index.json`; a Modal web endpoint serves packs, and the remote instructor endpoint lives beside it.

## 6. Contracts

Pack folder:
```
<packId>/<packVersion>/
  manifest.json
  <tier>/cloud.spz
  <tier>/labels.bin
```

`labels.bin`: a 16-byte header (magic `SFGL`, u16 version 1, u16 bytes per label 1, u32 splat count, u32 reserved 0), then one u8 part label per splat in SPZ order.

`manifest.json` (abridged):
```json
{
  "schemaVersion": 1,
  "packId": "gol-trend-engine-bay",
  "packVersion": 1,
  "title": "VW Gol Trend 1.6 engine bay",
  "tiers": [{ "id": "high", "splatCount": 1500000,
              "cloud": { "path": "high/cloud.spz", "bytes": 0, "sha256": "" },
              "labels": { "path": "high/labels.bin", "bytes": 0, "sha256": "" } }],
  "camera": { "home": { "azimuth": 0, "elevation": 35, "radius": 1.2 },
              "limits": { "minElevation": 10, "maxElevation": 80, "minRadius": 0.25, "maxRadius": 2.5 } },
  "parts": [{ "id": "coolant-reservoir", "label": 3, "name": "Coolant reservoir",
              "aliases": ["coolant tank", "expansion tank"], "summary": "", "details": "",
              "bounds": { "min": [0, 0, 0], "max": [0, 0, 0] }, "anchor": [0, 0, 0] }],
  "procedures": [{ "id": "check-coolant", "title": "Check the coolant level",
                   "steps": [{ "id": "locate", "text": "", "parts": ["coolant-reservoir"], "caution": "" }] }]
}
```
The app refuses a manifest whose `schemaVersion` it does not know.
Part ids are stable across versions; labels may change between versions because they only tie a tier's splats to parts.

## 7. Key flows

- **Tap a part**: tap gesture, `pick(x, y)`, label to part, `select` event, highlight re-derived, part card slides up; tapping empty space clears it.
- **Run a procedure**: "start checking the oil" or a tap on the procedure, `start` event, the first step's parts highlighted and framed, the step read aloud; "next" advances.
- **Ask a question**: "what does this do?" goes past the router to the instructor, which calls `getCurrentStep` and `getPartInfo` and answers aloud; if it calls `showPart`, the picture follows.
- **First launch offline**: bundled pack installed and verified, then the guide opens with no network.
- **Pack update**: on launch with network, a newer `index.json` version downloads in the background and activates on the next open of the guide.

## 8. Errors

- A pack that fails verification is never activated; the previous one stays.
- A labels file that does not match its cloud is a load error shown to the person, not a silent fallback to no labels.
- If no instructor is available the question is answered by the scripted instructor, which says what it can and cannot do.
- If the microphone or speech permission is denied, push-to-talk explains why and the guide stays fully usable by touch.
- Thermal pressure lowers the render scale, then the frame rate; the instructor and voice are never cut mid-answer.

## 9. Performance targets

Targets to verify on the physical devices, not promises:

| | iPhone 17 Pro | Xiaomi Mi 9 |
| --- | --- | --- |
| Splats (tier) | up to 1.5M | up to 500k |
| Orbiting | 60 fps or better | 30 fps or better |
| Idle | no frames drawn | no frames drawn |
| Pack open to first frame | under 3 s | under 6 s |
| "next" to highlight change | under 300 ms after speech ends | under 300 ms after speech ends |
| Instructor first words | under 1.5 s | online only |

## 10. Verification

- **C++** (ctest, no GPU): labels file validation; labels stay aligned through reordering (property test over random clouds); picking on a synthetic cloud; framing maths; highlight table.
- **TypeScript** (jest): session reducer; command router phrase table; highlight and framing derivation; pack install atomicity with a fake file system, including interrupted downloads; instructor selection order.
- **Pipeline** (pytest): SPZ order round trip; manifest schema; lifting on a synthetic scene with known labels.
- **On device**: a written checklist run on the iPhone 17 Pro and the Mi 9, recording device and OS: airplane-mode first launch, pick every part, every procedure by voice, three free questions, performance overlay readings, and screenshots of every highlighted part checked for visual defects.

## 11. Schedule

Seven days, Tuesday 29 September to Tuesday 6 October, in three parallel tracks: engine and library (A), pipeline and content (B), app (C).

| Day | A | B | C |
| --- | --- | --- | --- |
| Wed 30 | import and prune, builds on both platforms, Nitro spike | poses and training on Modal; second capture if the first splat shows gaps | scaffold, domain, reducer, command router |
| Thu 1 | labels in the cloud, highlight in Metal and Vulkan, pick, framing, C interface | masks and lifting, first labelled pack | pack store, bundled install, screens |
| Fri 2 | library API, gestures, label overlays | parts and three procedures written and reviewed, review renders, pack v1 | part card, procedure player |
| Sat 3 | Android pass | pack server and remote instructor endpoint | instructor with tools, voice |
| Sun 4 | Mi 9 performance, low tier if needed | | polish on both platforms, TestFlight upload |
| Mon 5 | | | README, ARCHITECTURE, PROVENANCE, video |
| Tue 6 | buffer and send | | |

Cut order if time runs out, first to go: remote instructor on Android, Android voice (buttons stay), pack downloads (bundled pack only), the second capture, gyroscope look, label overlays (part cards stay).
Never cut: tap to highlight, a procedure whose steps highlight their parts, the on-device instructor on iPhone, offline launch, the video.

## 12. Risks

- **Nitro on React Native 0.87 is unproven**: a day-one spike decides; Fabric codegen is the fallback.
- **SAM 3.1 weights are gated**: SAM 2.1 with click prompts is the fallback.
- **Thin parts (hoses, wires) lift poorly**: the demo's parts are chunky ones (reservoirs, caps, dipstick, battery, fuse box); crop boxes per part in the content file constrain lifting.
- **Mi 9 performance**: a smaller tier from the pipeline.
- **Apple Foundation Models tool quirks through the React Native wrapper**: tools act on the session and the app re-reads state instead of trusting callbacks.
- **TestFlight external review takes about a day**: upload by Sunday.

## 13. Provenance

The engine is imported from SplatKit (public, alpha) at a recorded commit in one commit, pruned in the next, and never refactored beyond what the new modules need ([ADR 0002](../adr/0002-pruned-splatkit-copy.md)).
`PROVENANCE.md` lists every inherited folder with that commit, and every new module.
