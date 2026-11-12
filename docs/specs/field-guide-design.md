# Miris architecture map

Read [first principles](first-principles.md) for the domain rules behind these interfaces.

Miris is a course-first factory guide with iOS and Android viewer and instructor foundations; CAD, remote content installation and course-wide retrieval remain planned.
Statements below describe current code unless marked **Planned** or **Proposal**; proposals require contract decisions before implementation.
Use [tasks](../../TASKS.md) for status/acceptance and [operations](../agents/checks.md) for commands.

## Find the owning area

Read the owning area and its linked interface/tests before editing.

- Startup, dependencies or navigation: [App](#app).
- Guide discovery: [Library](#library).
- Manifest, runtime files or updates: [Pack and delivery](#pack-and-delivery).
- Multi-tenant sync, CAS or deployment choices: [Scale proposal](#scale-proposal).
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
Startup validates explicitly bundled packs through the native reader and shows a startup error on failure; builds bundle no packs by default.
The global workspace opens before any native scene: Organizations leads to an organization's courses, then a course, module and activity.
The global sidebar contains Organizations, My progress, Downloads and Help; Courses is scoped to the organization.
The bundled demo supplies one local default Miris organization without implying a remote membership directory.
Explore cell and saved continuation resolve available catalog entries.
**Rule:** features never import app composition or construct unrelated provider lifecycles.
**Read:** [startup](../../apps/field-guide/src/app/App.tsx), [navigation](../../apps/field-guide/src/app/navigation/RootNavigator.tsx), [platform wiring](../../apps/field-guide/src/app/platform.ts).
**Verify:** [app tests](../../apps/field-guide/src/app/tests/App.test.tsx).

## Library

**Owns:** course entry, module presentation, discoverable guides, availability and session opening.
**Rule:** discovery chooses a session start; guide rules own subsequent position.
The landscape shell uses shared charcoal surfaces, blue actions, system typography and an 8-point spacing scale; native highlight styling is independent.
Course tabs own module presentation, documentation and the course Assistant; clickable breadcrumbs navigate outward without discarding the Assistant draft.
My progress reports only the validated saved continuation, without inferring completion, time spent or aggregated learning analytics.
Module actions open actual bundled activities, course questions use the grounded turn runner, and the native document adapter opens hash-verified local originals.
Remote course downloading remains unavailable; the download action opens the current local-resource availability page.
Downloads separates verified Voice & AI models from course content: offline course readiness requires every required course file to be installed and verified.
Ready entries and saved continuation enter guide/viewer interfaces.
**Read:** [public interface](../../apps/field-guide/src/features/library/index.ts), [views](../../apps/field-guide/src/features/library/views.ts), [catalog](../../apps/field-guide/src/features/pack/catalog.ts), [tokens](../../apps/field-guide/src/ui/courseTokens.ts).
**Verify:** [library tests](../../apps/field-guide/src/features/library/tests/library.test.tsx).

## Pack and delivery

**Owns:** content validation; planned delivery adds verified installation, activation and recovery.
**Rule:** stable part IDs outlive reconstructions; labels, bounds and anchors belong to a particular representation.
Activate matching files and records together; failed replacement must preserve the last usable installation.
Schema 3 adds prepared part and step view directions; schema 2 remains readable.
The current schema uses `.lodsplat` and one unsigned 16-bit little-endian label per tree node, with zero unlabelled and 1-65535 available part labels.
SFGL v2 uses a 16-byte header (`SFGL`, u16 version 2, u16 width 2, u32 node count, u32 reserved zero), followed by exactly `nodeCount * 2` bytes; all integers are little-endian.
Readers reject SFGL v1; GPU uploads independently pad labels to four-byte words.
Highlighting currently uploads a 65,536-entry style lookup, 2 MiB plus a 16-byte reveal prefix per frame slot; CPU storage is heap-allocated.
A part's `parent` is Brick `brick:hasPart`; optional `relations` add `feeds` (`brick:feeds`, media flow), `carries` (kinematic support), `drives` (actuation), `supports` (stationary mechanical support), `routes` (visible routed connection without media or flow direction) and `adjacent` (measured proximity, stored once).
Each relation names two different known parts, appears once and keeps `authored` or `measured` evidence with a source.
The parser rejects cycles in the parent hierarchy and the combined `carries`/`supports` graph; other predicates follow their own rules rather than a global DAG constraint.
Turtle uses Brick `hasPart`/`feeds` and Miris extensions `carries`, `supports`, `drives`, `routesTo` and `adjacentTo`; these extensions are not Brick predicates.
Evidence kind records provenance, not certainty; authored demo facts and qualified manual applicability retain their source qualifications.
The optional `model` file is the single annotated Brick/Turtle graph alongside the manifest; tooling verifies and bundles its bytes, and the app never parses it.
Exported notes, hierarchy, vectors and procedure links retain source evidence; aliases and details remain omitted from Turtle.
Mechanical relation sources retain the KUKA document edition, section, page and figure; a visual route cannot become a documented media feed.
Tours group components under their machine using supplied support/carrying links; search disambiguates local names by machine.
Manual references are currently prose attached to part IDs; structured document bindings and CAD joins remain planned.
Schema 2 permits absent `relations`, `model` and `semantic` blocks; graph queries traverse supplied facts.
**Planned installation contract:**
Immutable versions live at `Application Support/<bundle-id>/packs/<packId>/<packVersion>/`, containing manifest bytes, signature and runtime files; persist relative paths and exclude `packs/` from backup at every launch.
Same-tree staging at `packs/<packId>/.staging-<packVersion>/` names chunks by SHA-256 for resume; installations never depend on cache/temp files.
Verify the size-capped raw manifest signature before parsing, using compiled Ed25519 key IDs rotated/revoked by app update.
The signed manifest binds pack identity/version, required schema/SFGL/LODSPLAT versions, chunk sizes/hashes and final file hashes; reject rollback below the highest activated version and reused versions with different digests.
Preflight important-usage capacity for remaining chunks, final files and margin while retaining the previous installation; verify chunks, final hashes and headers before renaming staging into place.
Atomically replace `packs/<packId>/active.json` containing `packVersion` and `manifestSha256` as the sole activation commit.
At launch, validate pointer/manifest/signature/sizes, remove staging without a verified manifest and retain active/previous versions; a verified newer version remains inactive until committed.
Digest-check geometry/labels on every load and vectors on read; failed verification marks a version unusable and falls back to the previous usable installation, then a verified bundled pack.
Remove installed files only by unlink after viewers/sessions release their version; never overwrite, truncate or rename them.
Remount by `packId@packVersion`, releasing old GPU resources before decoding the replacement so records, highlights and picks cannot cross versions.
**Planned CAD contract:**
A CAD join belongs to a representation mapping: part ID, CAD file `{path, bytes, sha256}`, node path and a 4x4 similarity transform from CAD to splat frame, with its scale, the reconstruction SHA-256 it applies to, the registration method and the residual in splat units.
Articulated equipment carries one join per rigid link in its captured pose.
CAD is authored/adopted reference geometry for the approximate recreation, with origin evidence; use cross-fade or post-splat overlay until soft-depth composition passes hardware acceptance.
**Read:** [types](../../apps/field-guide/src/features/pack/pack.ts), [parser](../../apps/field-guide/src/features/pack/parsePack.ts), [component graph](../../apps/field-guide/src/features/pack/graph.ts), [bundled source paths](../../apps/field-guide/src/features/pack/bundledPack.ts), [validation entry](../../scripts/validate-pack.cjs), [label format](../../packages/react-native-splat/engine/splat-core/include/splat/formats/PartLabels.h).
**Verify:** [parser tests](../../apps/field-guide/src/features/pack/tests/parsePack.test.ts), [graph tests](../../apps/field-guide/src/features/pack/tests/graph.test.ts), [pack tooling tests](../../tests/pack-build.test.cjs).
**Pending:** [installation and replacement](../../TASKS.md#app-integration); a network request cache is not a file installer.

## Scale proposal

**Proposal:** separate an authorized metadata control plane from immutable binary delivery; CloudFront/S3, CAS, MMKV and direct SQLite/FTS5 are not integrated.
A course is independent of its distribution packs; stable component IDs are resolved within an organization/equipment scope, with course/content version and representation identity retained in requests and mappings.
Reject stale picks and instructor actions when session/representation identity changes.

- **Edge:** proposed `/catalog/*` serves authorized deltas, `/blobs/*` serves private immutable objects through signed access, and `/agents/*` serves authenticated sessions and answers.
  Backend tenant authorization and per-route caching remain necessary with WAF; HTTP/3 fallback preserves verification guarantees.
- **Sync:** scope cursors by authorized dataset, apply deltas and tombstones transactionally, and provide full resync when a cursor expires.
  Discover catalogs separately from installing detailed content.
- **Storage:** keep preferences separate from credentials in platform secure storage and from the installation's authoritative `active.json`.
  A SHA-256 CAS would revise the installation layout, requiring version-to-blob references and filesystem/database crash recovery.
  SHA-256 proves integrity, manifest signatures authenticate publication, and backend checks authorize access.
- **GC:** protect active/previous installations, user-retained offline content, staging and session leases acquired before file access; apply LRU only to eligible content.
  Reconstruct references after crashes; define logout, tenant switching and offline authorization before cross-tenant deduplication.
- **Background work:** platform transfer adapters own scheduling and task recovery; shared verification may run natively, while Miris owns installation policy.
  Background URLSession and Android transfer/job adapters handle restart, URL renewal and verified chunk resume.
- **Capacity:** catalog size and active-world size are separate budgets.
  Target one mounted world; measure load/pick latency, replacement memory and GPU/thermal behavior alongside local inference.
  Download chunks are transport units; worlds exceeding device budgets require a separate spatial residency/tiling contract.

### Prepared framing directions

Schema 3 requires `viewDirection: { azimuth, elevation }` in degrees on every part and authored procedure step, within the manifest camera limits.
The generated parts tour inherits each part's direction.
Schema 2 remains readable with home-direction fallback so installed legacy packs retain access while preparation migrates; that fallback makes no visibility claim.
The consumer parser, also loaded by `scripts/validate-pack.cjs`, rejects missing schema 3 directions, non-finite angles and directions outside the limits.
Selection takes precedence over the active step for bounds, highlights and direction, while an overview uses home.
A subsequent push-in preserves the user's orbit.

Preparation shortlists ten alternative directions at least 20 degrees apart plus home for each distinct target set, using capture support and projected target-splat quality.
It retains the whole delivered cloud and uses the app's doubled-context bounding-sphere framing distance, radius limits and 65 degree vertical field of view.
The shortlist checks whether each camera lies inside a half-opacity Gaussian support ellipsoid; those directions remain diagnosable but cannot win selection.
The CPU visibility approximation is no longer used to choose export directions.
A development-only native candidate pass frames each candidate instantly, waits for its published drawn pose and centred target projection, then samples the normal 12 by 12 native-pick grid independently for every root target.
Assemblies accept descendant labels through the same guide highlight contract as the normal audit.
Bounded batches of eight immutable native picks reduce measurement overhead without changing the grid or scoring.

A complete measurement pass must match the pack identity, geometry hashes, viewport, target sets, candidate IDs, requested poses and CPU quality components.
Every target must reach 0.3 projected-box coverage whenever any safe measured candidate can show all targets at that floor.
If simultaneous floors are impossible, selection maximizes the weakest target exactly before considering quality.
Eligible quality is `0.55 * nativeCoverage + 0.30 * captureSupport + 0.15 * crispPixels`, with named constants in preparation.
Native coverage is the mean per-target projected-box occupancy, preventing a union score from hiding an absent target.
Within 0.0001 quality, home proximity breaks ties.
Capture support averages Gaussian angular support with a 20 degree sigma over the nearest three training views whose frusta contain the target centre and whose distance is between one half and twice the framing distance.
The capture poses and target centres share the pack placement transform; absent qualifying captures score zero.
The shortlist's crispness proxy is the share of projected target splats with opacity at least 0.5 and three-sigma support diameter at most six pixels at a reference viewport height of 768 points.
This target-only proxy does not measure front-most pixel sharpness, and native coverage alone does not establish image quality or how much of the target's own surface is visible.
Those limitations remain explicit rather than treating the CPU approximation as native reconstruction-quality evidence.

The exporter accepts `--native-views` containing the shortlist, complete native measurements and derived selections, rechecks their binding and copies directions into schema 3.
Its receipt records the native measurements, component scores, best measured weakest-target coverage, safe-candidate count and every target set below 0.3, including zero.
Without that input, export creates an explicitly unmeasured home-direction bootstrap for acquiring geometry and candidate measurements, with no CPU visibility rescore.
The final normal prepared audit checks the re-exported pack through the same direction source as the guide.
The reference landscape iPad split viewport is 982 by 1024 points; other viewport shapes require separate native validation.
A finite shortlist does not prove enclosure or that no continuous camera direction could improve a target.

## Semantic data

**Owns:** compatible-vector ranking to stable part IDs; persistent prepared knowledge and reconstruction mappings are planned.
**Rule:** reject incompatible vector spaces even when dimensions match.
Zustand holds transient state and progress uses AsyncStorage; WatermelonDB and TanStack Query are selected for persistent records and API state but are not installed.
**Proposal:** direct SQLite via native bindings with FTS5 would replace the selected persistence approach only after deciding ownership, migrations and index maintenance.
Use one writer and bounded asynchronous queries; FTS5 serves text search, relational indexes serve IDs/edges, and supplied-vector ranking remains separate.
The manifest binds vector-space identity, encoder/weights/preprocessing, normalized dimensions and image/text rows per part.
[Cosine ranking](../../apps/field-guide/src/features/semantic/domain/partVectors.ts) validates space, dimensions and buffer size; tooling checks finite unit-length float32 rows.
Preparation supplies every embedding, including query vectors; mobile compares supplied vectors without encoders or inferred physical facts.
**Read:** [public interface](../../apps/field-guide/src/features/semantic/index.ts), [pack types](../../apps/field-guide/src/features/pack/pack.ts), [app dependencies](../../apps/field-guide/package.json), [integration tasks](../../TASKS.md#app-integration).
**Verify:** [vector tests](../../apps/field-guide/src/features/semantic/tests/partVectors.test.ts).
**Pending:** reading the vectors file from an installed pack, reconstruction identity for mappings and persistent records.

## Guide

**Owns:** deterministic session transitions, selection overrides, child expansion, framing and saved continuation.
**Rule:** viewer and instructor submit events; guide rules decide the resulting procedure position and emphasis.
A session is the current position; progress is its saved continuation.
A session start with a null procedure opens free exploration with selection and camera controls, without guidance, steps, an Assistant or progress writes.
Entering free exploration from the course preserves any existing saved learning continuation.
Course activities show a compact current-instruction card instead of the legacy guidance dropdown and full step-list sidebar.
**Read:** [public interface](../../apps/field-guide/src/features/guide/index.ts), [session rules](../../apps/field-guide/src/features/guide/domain/session.ts), [highlight/framing](../../apps/field-guide/src/features/guide/domain/derive.ts), [progress storage](../../apps/field-guide/src/features/guide/data/progressStorage.ts).
**Verify:** [session tests](../../apps/field-guide/src/features/guide/tests/session.test.ts), [progress tests](../../apps/field-guide/src/features/guide/tests/progressStorage.test.ts).

## Instructor

**Owns:** grounded turns, accepted session actions and online/offline voice coordination.
**Rule:** commands resolve locally; provisional or cancelled answers never commit session actions.
Typed answers fall back from direct ElevenLabs text sessions to ExecuTorch generation to scripted guidance on both iOS and Android.
Local generation explains supplied pack text; Apple Foundation Models is not a fallback.
The online Miris pilot retrieves prepared text through ElevenLabs RAG, retaining pack identity/version and supplied source qualifications.
Active stable part ID, procedure and step come from application session state; exact lookup and name/alias search run against the bundled manifest before a world is mounted.
Structured manual figures, course identities independent of pack identity and full-manual retrieval remain planned; no live voice or physical acceptance is implied.
Agent tools resolve validated domain actions through guide rules before viewer mutation or procedure advancement.
Local prompts prioritize subject, procedure and safety, followed by sourced connections/notes and measured proximity; required context exceeding the budget fails the turn.
Each generated answer starts fresh; cancellation, malformed output and token-limit stops fail the turn.
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
Nitro HybridView/Fabric hosts Swift/CAMetalLayer or Kotlin/JNI/TextureView, crossing the app-owned `sfg_*` C adapter into SplatKit.
The current source contract passes file paths and hashes, not file descriptors; native workers load and pick while render threads own GPU work.
The loader maps read-only files, verifies geometry/labels and decodes CPU arrays before GPU packing/upload; `mmap` is not end-to-end zero-copy or a bound on decoded memory.
The shared C++ core owns behavior; Metal/Vulkan adapters draw and own backend-specific LOD, visibility, sorting and compositing policies.
Picking returns a uint16 label or zero, exposed as a Nitro promise; its current leaf scan and hit sorting require latency measurement as worlds grow.
The app host sets a `.lodsplat` budget of 1,500,000 splats before loading a world; this bounds hierarchy selection without cropping the complete pack and is distinct from the actual post-culling draw count.
The host renders at 0.75 scale, while the engine exposes native selected/drawn statistics that the current app diagnostics do not publish.
The Dev panel labels its manifest-derived count as Pack splats; the selected count may be below the budget because of LOD and culling, and target-device GPU, memory and thermal acceptance remains outstanding.
SplatKit changes land upstream first; the imported revision and file hashes live in `engine-source.json` and artifact verification rejects source drift.
The app-owned adapter applies Miris policy through SplatKit interfaces; generic rendering/loading mechanisms remain upstream.
**Planned emphasis contract:**
Per-label {target, context, hidden} states use one-byte updates on change and a small style palette; descendants inherit target status.
View-dependent cutaway fades non-target splats in front of target bounds; picking must match styled/cutaway output.
Merged nodes carry dominant labels, so styling is exact only at leaves.
**Read:** [Nitro contract](../../packages/react-native-splat/src/SplatView.nitro.ts), [C adapter](../../packages/react-native-splat/adapter/include/sfg/sfg.h), [GPU stages](../../packages/react-native-splat/engine/splatkit-ios/README.md), [import receipt](../../packages/react-native-splat/engine-source.json), [loader](../../packages/react-native-splat/engine/splat-core/src/loading/SplatWorldLoader.cpp), [picking](../../packages/react-native-splat/engine/splatkit-engine/src/pick/PickIndex.cpp).
**Verify:** [adapter tests](../../packages/react-native-splat/adapter/tests/SfgTest.cpp), [Metal tests](../../packages/react-native-splat/engine/splatkit-ios/tests), [profiling operations](../agents/checks.md#gpu-profiling).

## On-device capabilities

**Owns:** microphone ownership, recognition, synthesis, interruptions and supported local generation.
**Rule:** cancellation rejects stale callbacks and releases active resources; instructor owns equipment evidence and answer policy.
ExecuTorch supplies Whisper Base English with VAD, Kokoro synthesis and Qwen2.5 1.5B Instruct generation on both platforms; model definitions own exact versions.
The initial locale is `en-US`; recognition has no per-pack vocabulary bias.
Separate worklet runtimes keep recognition, synthesis and answers independent; CPU XNNPACK avoids GPU contention, while shared memory and thermal limits still require hardware acceptance.
`react-native-audio-api` supplies one echo-cancelled microphone/playback module shared with the online PCM audio link.
Missing models leave reading, typing and scripted guidance available.
Shared startup preparation verifies pinned `modelAssets.json` files, downloads missing files, checks size/SHA-256 and promotes staging before exposing paths to inference.
It survives navigation, supports pause/retry and reconnect recovery, and reports readiness separately from course installation and online availability.
Workers share verified files without preloading all inference models or gating online answers.
Files persist in Documents; restore/inference need no network, while the startup coordinator may download missing files.
The English POS tagger is omitted because Brown Corpus data is not cleared for commercial use; lexicon/neural phonemization remain available.
**Read:** [lazy entry points](../../packages/react-native-on-device/src/index.ts), [capability contracts](../../packages/react-native-on-device/src/capabilities.ts), [model preparation](../../packages/react-native-on-device/src/local/modelStore.ts), [inference](../../packages/react-native-on-device/src/local/inference.ts), [audio](../../packages/react-native-on-device/src/local/audio.ts), [online audio link](../../packages/react-native-on-device/src/AudioLink.ts).
**Verify:** [capability tests](../../packages/react-native-on-device/__tests__), [device acceptance](../../TASKS.md#acceptance).

## Online services

**Owns:** ElevenLabs credentials, signed conversation sessions, prepared knowledge synchronization and agent configuration.
**Rule:** incomplete streams fail; provider credentials remain outside the app; live requests and sync require explicit authorization.
The Cloudflare Worker exposes an uncached probe and a rate-limited signed-session issuer for one Miris pilot agent.
Text-only and voice sessions connect directly to ElevenLabs over WebSocket; managed generation and native RAG replace the Anthropic and custom-LLM routes.
The pilot issuer is public and has no operator identity or membership verification; rate limits are not authorization.
All app copy and agent prompts are English.
Prepared knowledge documents retain pack identity/version, stable component IDs, hierarchy, procedures and evidenced relations.
Original manufacturer PDFs remain local until third-party processing permission is established; missing whole-factory locations and emergency exits remain unknown.
`search_parts` matches supplied names/aliases and returns ambiguous candidates without selection; `get_part` reads exact installed facts and directed relations without mutation.
`show_part` and procedure tools validate IDs through guide rules; typed navigation stays provisional until a complete answer, and cancelled/failed turns do not commit it.
A course question can select and frame a component in a bundled scene before that scene has been opened.
Course and activity conversations share bounded in-memory history keyed by pack identity/version; backgrounding closes connections.
Authored step narration uses local speech with outgoing agent audio muted to avoid sending the narration back as microphone input.
Existing offline Qwen/scripted answers and local voice remain separate fallbacks.
MobileCLIP vectors retain their independent comparison seam and are not uploaded or treated as compatible with ElevenLabs RAG vectors.
Sync saves immutable document IDs by content digest before indexing, starts indexing for every document and preserves the active agent until all indexes succeed.
Retries reuse saved documents; stale remote documents and legacy secrets are not deleted automatically because other agents may reference them.
Ephemeral session credentials must not be cached across users.
**Read:** [Worker routes](../../services/instructor-proxy/src/index.ts), [voice/text client](../../apps/field-guide/src/features/instructor/data/agent/agentClient.ts), [part knowledge](../../apps/field-guide/src/features/instructor/domain/agent/partKnowledge.ts), [agent configuration](../../services/voice-agent/src/agentConfig.ts), [sync](../../services/voice-agent/src/sync.ts).
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
