# Miris first principles

## Goal and operator

Miris is a state-of-the-art viewer of spatially aware Gaussian splats joined with CAD, manuals and component knowledge.
It serves an operator who starts from zero: explain the factory machine by machine, what each machine does, what each piece is, where the manual describes it and how the pieces relate.
The first world is the Miris factory cell with four robots.
This is the product direction, not a claim that CAD, delivery or the complete operator experience already exists.
Use [architecture](field-guide-design.md) for implementation ownership and [tasks](../../TASKS.md) for integration and physical acceptance.

## Facts that determine the design

A Gaussian splat reconstruction represents appearance through spatial Gaussians with position, shape, opacity and colour information.
Rendering their contributions can reproduce a photographed scene, but does not identify a motor, explain a hose's contents or establish which joint a housing drives.
The pipeline's `pipeline/pack/mask_lift.py` makes this distinction concrete: it projects Gaussians through calibrated cameras and attributes their rendering contributions to labelled pixels.
Those pixels must acquire meaning from reviewed annotation.

A reconstruction can change its Gaussian count, ordering and geometry when retrained or exported into another tree.
Therefore a Gaussian index or numeric label cannot identify a physical component across reconstructions.
A stable segmentation ID identifies the component; a representation-specific mapping connects that ID to the current geometry.
Names, coordinates, vector row positions and CAD node names must never replace that ID as the domain's join key.

A phone must render and respond while carrying a large world in limited memory and within a thermal budget.
Annotation review, reconstruction, mask lifting, model encoding and manual processing require source material and preparation resources that do not belong in that interactive loop.
Therefore all such work happens in the preparation pipeline, including every query embedding.
The phone is a viewer and query client: it consumes prepared facts and can compare supplied vectors, but never runs an embedding encoder or infers physical relationships from similarity.
Speech and answer-generation capabilities described in the architecture do not change this boundary.

An operator cannot distinguish a convincing reconstruction or fluent answer from verified equipment knowledge merely by looking at it.
Therefore evidence is part of the domain, not optional explanatory decoration.
Appearance supports identification review; a manual supports an authored claim; a recorded measurement supports proximity.
None substitutes for the others, and silence in a source remains unknown.

## The stable ID is the backbone

Every component layer hangs from the stable part ID and from nothing else.
The ID outlives any particular reconstruction; its numeric label, bounds and anchor do not.
Relations join two IDs, and representation mappings additionally identify the reconstruction whose geometry they describe.
For example, the inspected pack maps `r01-arm` to label `1`, but neither that number nor its current position defines the arm's identity.

| Layer | What it holds | Keyed how | Produced where | Consumed how | Status today |
| --- | --- | --- | --- | --- | --- |
| Segmentation | Gaussian/tree membership, bounds, anchor | Stable ID to representation label; label bytes in node order | Accepted masks, lifting and export in pipeline | Picking, highlighting, framing | Export and viewer primitives exist; persistent reconstruction mapping integration is open |
| Hierarchy | Component ownership | Child `id` to `parent` ID | Authored pack content | Assembly lookup and descendant expansion | Manifest and Brick export exist |
| Embeddings | Image/text vectors and vector-space identity | `semantic.rows[].part`, with `kind` | Pipeline encoders | Supplied-vector cosine ranking returns IDs | Part export and ranking exist; installed-file loading and query-vector supply are open |
| CAD | Geometry and structure reference, alignment | Per ID: CAD file, node inside it, transform to splat frame | External preparation | Joined spatial inspection | Reserved domain place only; no pack fields or implementation yet |
| Relations | Containment, flow, carrying, actuation, proximity and evidence | Endpoint IDs | Authored sources or pipeline measurements | Graph queries and grounded explanations | Graph functions exist; viewer relation navigation is open; hierarchy evidence is incomplete |
| Manuals and knowledge | Notes, descriptions and manual references | Part ID | Reviewed content and manual processing in pipeline | Part explanations and instructor grounding | Notes and prose citations exist; structured manual references are absent |

The table's implemented fields come from [pack.ts](../../apps/field-guide/src/features/pack/pack.ts), [graph.ts](../../apps/field-guide/src/features/pack/graph.ts) and [partVectors.ts](../../apps/field-guide/src/features/semantic/domain/partVectors.ts).
Pipeline paths in this document are relative to the separate `splat-tools` repository.

## From painted mask to highlighted part

1. Establish the part ID in the teaching/content vocabulary and paint or correct its mask on a source photo.
   Accept the reviewed pixels before they can establish labels; drafts, uncertain decisions and generated proposals are not accepted masks.
   `splat-tools/operations.md`, under teaching review, describes immutable accepted references and explicitly unaccepted proposals.
2. Lift accepted masks through cameras registered to the reconstruction.
   `pipeline/pack/mask_lift.py` weights votes by alpha and transmittance, restricts surface votes and bounds growth behind the labelled surface.
   This derives membership from accepted evidence; it does not certify unseen geometry or equipment identity.
3. Export the representation and its ID mapping together.
   `pipeline/pack/export.py` checks capture/session provenance, places and crops the cloud, gates distant labels, builds the LOD tree and derives bounds and anchors including descendants.
   It assigns manifest labels from part order, so those numbers are export mappings, never durable identity.
4. Attach authored knowledge, relationships and prepared vectors to those same IDs.
   `pipeline/pack/part_vectors.py` embeds accepted-mask crops and part sentences outside the app, aggregates image vectors and records the vector-space identity.
   `pipeline/pack/semantic_model.py` emits the Brick graph from manifest parts and relations.
5. Validate and deliver matching files and records, then activate them as one usable installation.
   Validation and bundling exist; mobile installation and activation are still required before this is an integrated Miris path.
6. Resolve a selected ID through the active pack and highlight its representation.
   [derive.ts](../../apps/field-guide/src/features/guide/domain/derive.ts) already expands selected parts through descendants, emits their labels in `highlightFor` and combines their bounds in `framingFor`.
   Supplied-vector retrieval returns `partId`, so it must enter this same selection path rather than introduce a separate geometry identity.

The inspected `publication.json` lists `r01` through `r04` as having no directly labelled splats.
They are assembly IDs whose geometry and highlighting derive from their children, not missing robots to be given fabricated labels on arbitrary Gaussians.

## The pack is the contract

Keep annotations consolidated by layer inside the pack, keyed by ID: `manifest.json` contains parts, hierarchy, relations, notes and vector-row mappings; `semantic/model.ttl` is intended to express the same facts as a Brick graph.
Binary geometry, node-label payloads and vector values remain referenced files, not per-part annotation documents.
The current Turtle projection is incomplete, as listed under Known gaps.
The phone consumes the manifest and never parses Turtle.

[pack.ts](../../apps/field-guide/src/features/pack/pack.ts) and [parsePack.ts](../../apps/field-guide/src/features/pack/parsePack.ts) define the actual schema:

- Identity and presentation: `schemaVersion: 2`, `packId`, `packVersion`, `title`, `camera.home` and `camera.limits`.
- Parts: `parts[]` contains `id`, `label`, `parent`, `name`, `aliases`, `summary`, `details`, `notes`, `bounds` and `anchor`.
  Notes have `topic` and `text`, with at most one note per supported topic.
- Geometry: `tiers[]` contains `id`, `splatCount`, `nodeCount`, `world` and `labels`.
  Leaves are captured splats after export filtering; node counts also include merged LOD nodes.
  Each `labels.bin` has a 16-byte SFGL header and one label byte per node, with zero unlabelled and 1-255 available part labels.
- Relationships: `relations[]` contains `type`, `from`, `to` and `evidence`.
  Evidence contains `kind: authored | measured` and `source`; only measured evidence may also contain non-negative `distance`.
  `parent` separately represents containment.
- Knowledge sequence: `procedures[]` contains `id`, `title` and `steps`, whose fields are `id`, `text`, `parts` and `caution`.
  Step `parts` are stable IDs; the parser prepends a generated parts tour.
- Semantic payload: `semantic.space` contains `id`, `encoder`, `weightsSha256`, `preprocessing`, `dimensions` and `normalized: true`.
  `semantic.vectors` references little-endian float32 values in `semantic.rows` order, where each row names `part` and `kind: image | text`.
  File size is row count times dimensions times four; equal dimensions alone never establish vector compatibility.
- Files and provenance: `model`, tier files and `semantic.vectors` use `{path, bytes, sha256}`.
  Optional `sources` includes `captureSha256`, `reconstructionSha256`, `ply`, `labels`, `liftingReport`, `content`, `knowledge` and `partLabels`.
  If supplied, `sources.partLabels` must agree exactly with the parts' ID-to-label mapping.

Schema 2 permits missing `relations`, `model` and `semantic`; absence means no supplied capability, not permission to invent its data.
The parser rejects duplicate IDs or labels, unknown references, hierarchy cycles, self-relations, duplicate relations, reversed duplicate adjacency and carries cycles.
It also rejects duplicate `(part, kind)` vector rows and inconsistent vector byte counts.
[scripts/validate-pack.cjs](../../scripts/validate-pack.cjs) reuses the consumer parser and additionally verifies runtime file sizes and SHA-256 digests, world/label headers and counts, known label values, finite unit vector rows and unlinked file paths.
It verifies the Turtle file's bytes, not its semantic equivalence to JSON.

The inspected export at `splat-tools/data/pack/miris-pilot/1/manifest.json` contains 44 parts, comprising four robot assemblies and forty component groups.
It contains 113 explicit relations: 24 carries, 16 drives, 12 feeds and 61 adjacent, in addition to the parent hierarchy.
Its 88 vector rows are 512-dimensional, one image and one text row per part.
The `high` tier contains 1,395,393 leaves and 1,554,657 nodes; `world.lodsplat` is 171,240,232 bytes.
These are properties of this inspected export, not future pack requirements or proof of physical acceptance.

## Brick expresses distinct kinds of connection

Containment, flow, motion and proximity answer different questions and must remain separate predicates.
The export imports Brick 1.5, defines Miris equipment classes as subclasses of `brick:Equipment`, and uses `cell:<part-id>` entities with `miris:partId` literals.
The mappings in `pipeline/pack/semantic_model.py` are:

| Manifest fact | Graph predicate | Meaning |
| --- | --- | --- |
| Child `parent` | Parent `brick:hasPart` child | Component containment |
| `feeds` | `brick:feeds` | Media flows from subject toward object |
| `carries` | `miris:carries` | Subject mechanically supports and moves object |
| `drives` | `miris:drives` | Subject's motors actuate object's joint |
| `adjacent` | `miris:adjacentTo` | Measured proximity, symmetric and stored once |

`hasPart` and `feeds` belong to Brick; `carries`, `drives` and `adjacentTo` are explicitly declared Miris object properties in `urn:miris:schema#`.
A motor housing's actuation is not a controller's supervisory command, so `brick:controls` is not used for it.
Brick 1.5 reserves that relationship for controllers commanding equipment, as explained in its [controller documentation](https://docs.brickschema.org/modeling/controllers).
`pipeline/pack/export_checks.py` explicitly rejects `brick:controls` in this export.

The exporter attaches relation evidence through reified `rdf:Statement` records with subject, predicate, object, evidence kind, source and optional distance.
The app's `relationsOf`, `neighbours`, `chainThrough`, `feedPath` and `assemblyOf` traverse supplied facts.
Traversal is not new evidence: a feed path cannot establish the hose's unknown contents, and proximity cannot establish mechanical support.
`chainThrough` follows the first incoming carrier and stops at outgoing branches; its result is a traversal convention, not proof of a unique physical chain.

## Evidence determines what may be said

Only accepted masks establish segmentation labels.
Authored relations must cite their source, including the manual figure and page when the claim is manual-backed.
Measured relations must state the method and retain the relevant reconstruction context and units.
An unsupported claim stays unknown; a qualified source must remain qualified in the operator's explanation.

For example, `content/miris-pilot/knowledge.md` explicitly treats the KUKA anatomy reference as guidance, not proof of the exact robot model, and leaves hose contents and some motor identities unresolved.
These qualifications matter even when a relation's `kind` is `authored`: that field describes provenance, not certainty.

The current adjacency calculation in `pipeline/pack/export.py` takes the fifth percentile of nearest-neighbour distances pooled in both directions between labelled Gaussian centres.
`publication.json` records its threshold and gaps and marks the placement units as approximate, non-metric metres derived from an assumed scale.
Such a gap describes this reconstruction; it is not a certified clearance measurement.

## Division of work and delivery

The preparation pipeline owns annotation, reconstruction, lifting, every embedding, relation extraction or authoring, manual processing and export.
The app repository owns mobile validation, bundling, release packaging and the eventual installation lifecycle.
The phone renders, selects, frames, browses, queries and explains supplied knowledge.
It may rank supplied vectors in the declared space; it must never run an encoder, promote similarity into a physical edge, or treat a generated answer as new equipment evidence.

A large spatial world must ultimately arrive from a remote source in compressed chunks, verified by digest, and activate together with matching records.
A failed replacement must preserve the last usable installation.
Otherwise a correct part ID could highlight geometry from a different reconstruction or present stale knowledge as current.

Today, [pack_archive.cjs](../../scripts/pack_archive.cjs) creates compressed tar archives and can download an archive into the host preparation cache, validate it against an explicit manifest and replace that cache with rollback on rename failure.
[copy_bundled_packs.cjs](../../scripts/copy_bundled_packs.cjs) validates and copies runtime files for bundling.
These are host tools, not a phone installer or resumable chunk protocol.
Digest verification establishes agreement with the expected manifest; it does not by itself authenticate where that manifest came from.
The mobile remote-download trust contract, chunked transfer, installation, activation and replacement recovery remain open.
Startup still supplies an empty catalog, as recorded in [architecture](field-guide-design.md#app) and [tasks](../../TASKS.md#app-integration).

## Known gaps

- **Graph parity:** `semantic_model.py` exports identity, classes, summaries, geometry, hierarchy and explicit relation evidence, but omits `details`, notes/manual citations, aliases, procedures and vector-space/row metadata.
  The inspected Turtle is therefore not the complete same-facts counterpart required by the principle.
  Adjacency symmetry is described in prose but not declared as `owl:SymmetricProperty`.
- **Evidence coverage:** `parent` has no evidence field and containment triples have no reified evidence.
  Some authored `feeds` and `carries` edges cite visual routing or visual interpretation without a manual figure/page; `drives` cites page groups with inferred correspondence.
  The parser requires only a non-empty source string, so it cannot enforce the stronger citation requirement or confirm the asserted relationship.
  Notes carry prose citations rather than structured manual references.
- **Representation ownership:** `Part` embeds `label`, `bounds` and `anchor` directly, while `sources.reconstructionSha256` is optional and no persistent reconstruction mapping is integrated.
  The exporter assigns labels by array order; ID stability across replacement is a rule, not an implemented cross-version identity check.
- **Provenance handoff:** the export includes `sources.cameras` and `sources.labelClasses`, but the app's `PackSources` omits them.
  Runtime `packFiles` excludes source artifacts and `publication.json`, so mobile file verification alone does not verify the complete evidence chain or retain the receipt's scale details.
- **Validation scope:** `export.py` can fall back to consumer validation with `relations`, `model` and `semantic` stripped after a rejection.
  That fallback cannot establish acceptance of the complete contract, although this inspected receipt reports `full manifest accepted`.
- **Integration:** CAD by ID has no implementation; installed vector loading, pipeline-supplied free-text query vectors, persistent records, viewer relation navigation and mobile delivery/activation are open.
  Existing graph and ranking interfaces do not establish an end-to-end Miris experience or physical acceptance.

Reserve only the CAD file reference, node reference and transform to the splat frame per ID for future CAD work.
The query-vector supply mechanism, relation navigation interaction and remote installation protocol remain undecided; this document does not invent them.

## Review invariants

1. Every component fact joins through a stable part ID; numeric labels and geometric mappings belong to the matching representation.
2. Only accepted masks establish labels, and source uncertainty survives export and explanation.
3. All embeddings, including query vectors, are produced outside the phone; comparison requires matching vector-space identity.
4. Containment, flow, carrying, actuation and proximity remain distinct, with evidence for their claims; similarity never creates physical relations.
5. Pack references resolve to known IDs, hierarchy and carries remain acyclic, and duplicate symmetric edges are rejected.
6. JSON and Brick must express consistent facts by ID; any omitted layer remains an explicit gap rather than an assumed equivalence.
7. Activate geometry, mappings and records together only after verification, and retain the last usable installation on replacement failure.
8. Report source interfaces, integrated mobile behaviour and physical acceptance separately; an exported pack is not proof of all three.
