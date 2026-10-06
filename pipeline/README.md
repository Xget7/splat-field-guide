# Pack and AR reference pipeline

The pipeline prepares the guide's runtime pack and its separate provisional AR reference.
The [consumer design](../docs/specs/field-guide-design.md#pack-contract) defines the pack contract; [AGENTS.md](../AGENTS.md#capture-and-reference-operations) contains execution commands.
Demo builds consume an archive through the [root quickstart](../README.md#quickstart); capture stages require the author's photos and annotations.

## Pack stages

| Stage | Code | Accepted output |
| --- | --- | --- |
| Ingest | [ingest.py](pack/ingest.py) | Originals, metadata-preserving JPEGs and capture identity |
| Poses/cameras | [poses.py](pack/poses.py), [cameras.py](pack/cameras.py) | Complete COLMAP reconstruction and capture-bound tracker cameras |
| Training | [training.py](pack/training.py) | Brush PLY, log and input/tool receipt |
| Marking | [sam_live.py](pack/sam_live.py), [live_api.py](pack/live_api.py) | Reviewed per-part prompts/masks in accepted revisions |
| Propagation | [sam_track.py](pack/sam_track.py) | Masks, comparison scores and source/checkpoint identities |
| Lifting | [lift_all.py](pack/lift_all.py) | PLY-order labels, previews and source-bound report |
| Export | [export.py](pack/export.py), [export_checks.py](pack/export_checks.py) | Verified pack candidate, then publication |

Local geometry stages use Python/uv, Node for the app parser, COLMAP, exiftool and the Brush binary.
SAM runs on Modal with approved model access and a named Hugging Face secret; tool identities and terms are in [provenance](../docs/PROVENANCE.md#preparation-tools).
[pack.yaml](../content/gol-trend-engine-bay/pack.yaml), [knowledge.md](../content/gol-trend-engine-bay/knowledge.md) and [source qualifications](../content/gol-trend-engine-bay/SOURCES.md) supply authored content.
[artifacts.py](artifacts.py) shares identity and staging helpers; pack-specific mask/geometry helpers stay in `pack/`.

## Acceptance boundaries

Capture identity binds ordered photograph names and bytes.
[masks.py](pack/masks.py) writes a complete accepted revision before promoting `current.json`, rejecting stale capture/revision saves.
Tracking/lifting require exact capture, reconstruction and annotation identities; imported annotation bytes do not establish their producing model environment.
Export transforms cloud and labels together and validates the actual app parser, binary correspondence, digests and bounds.
The publication receipt and source artifacts are required for full verification and remain outside release archives.
Existing pack versions require explicit replacement; staged candidates and rollback preserve accepted content on failure.
Physical part correctness, authored content and metric dimensions require owner review before publication.
Archive packaging includes only manifest-referenced runtime files; [prepare.sh](../scripts/prepare.sh) accepts the pinned manifest and verified files.

## AR reference stages

| Stage | Code | Output |
| --- | --- | --- |
| Reconstruct | [reconstruct_reference.swift](ar/reconstruct_reference.swift) | Textured Object Capture USDZ, photo poses and identities |
| Register/prepare | [register_reference.py](ar/register_reference.py), [prepare_reference.py](ar/prepare_reference.py), [cleanup_reference.py](ar/cleanup_reference.py) | Digest-bound candidate registration and reviewed rigid assembly |
| Train | [train_reference.py](ar/train_reference.py) | Local Create ML reference, logs, progress and disk-guard state |
| Landmarks | [author_ar_landmarks.swift](ar/author_ar_landmarks.swift), [publish_landmarks.py](ar/publish_landmarks.py) | Reviewed mesh picks converted to a pack-bound candidate |
| Inspect | [probe_reference.swift](ar/probe_reference.swift), [watch_ar.py](ar/watch_ar.py) | Network integrity checks and bounded device diagnostics |

The app copies a separately prepared reference when present; it is excluded from the viewer archive.
[Open work](../TASKS.md) covers reference-frame validation and physical recognition/alignment before semantic overlay rendering.
