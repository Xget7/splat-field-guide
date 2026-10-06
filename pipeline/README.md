# From capture to pack

Local COLMAP/Brush, Modal SAM 3.1, then local lifting and verified publication turn the Gol Trend's 124 photos into the demo pack.
For an app build, use the [quickstart](../README.md#quickstart); capture stages need the author's original photos and annotations, not just the release archive.
Run the commands below from the repository root, and use [AGENTS.md](../AGENTS.md#prepare-and-verify) for fake-backed tests/lint.

## Inputs

| Input/tool | Requirement |
| --- | --- |
| Polycam export | Preserve originals, depth and camera JSON; ingested JPEGs need supported EXIF orientation and Apple acceleration metadata |
| Local tools | Python 3.12+, uv, Node 26+, COLMAP 4.2.x and exiftool; `brew install uv colmap exiftool` |
| Brush | Apple silicon macOS binary 0.3.0 at `tools/brush/brush-app-aarch64-apple-darwin/brush_app`, or `training.py --brush <path>` |
| SAM | Modal account, approved Hugging Face model access and named `huggingface` secret containing `HF_TOKEN` |
| Authored content | [pack.yaml](../content/gol-trend-engine-bay/pack.yaml), [knowledge](../content/gol-trend-engine-bay/knowledge.md) and [source qualifications](../content/gol-trend-engine-bay/SOURCES.md) |

Tools/resources and licenses are in [provenance](../docs/PROVENANCE.md).
Captured LiDAR depth is preserved; exported scale uses an approximate 0.242 m battery side, with physical dimensions still to verify.

## Capture stages

| Stage | Command | Accepted output |
| --- | --- | --- |
| Ingest | `nice -n 19 uv run --project pipeline python -m pipeline.pack.ingest --source data/input-polycam --out data/capture` | Originals, metadata-preserving JPEGs and `capture.json`; matching inputs/output reused, changed inputs require a new directory |
| Recover poses | `nice -n 19 uv run --project pipeline python -m pipeline.pack.poses` | Fresh COLMAP database, complete reconstruction and `poses.json`; split/partial reconstructions rejected |
| Tracker cameras | `nice -n 19 uv run --project pipeline python -m pipeline.pack.cameras` | `pipeline/pack/cameras.json`, bound to exact photo bytes and three COLMAP binaries |
| Inspect training | `nice -n 19 uv run --project pipeline python -m pipeline.pack.training --plan` | Input/tool identities and invocation; starts no training |
| Train | `pipeline/pack/train_local.sh` | `data/splat/engine_30000.ply`, log and `training.json`; existing output rejected |
| Mark | `modal deploy --module pipeline.pack.sam_live` | Reviewed per-part prompts/masks in accepted revisions |
| Track | `modal run --module pipeline.pack.sam_track` | All eight parts under `data/segment/tracks/<part>`, with scores and source/checkpoint identities |
| Download marks | `modal volume get sfg-spike-frames /marks data/segment` | `data/segment/marks/<part>/current.json` and its complete `sets/` tree |
| Lift new annotations | `nice -n 19 uv run --project pipeline python -m pipeline.pack.lift_all` | PLY-order `labels.npy`, previews and source-bound `report.json` |
| Publish new version | `nice -n 19 uv run --project pipeline python -m pipeline.pack.export --pack-version 2` | Verified candidate promoted to `data/pack/gol-trend-engine-bay/2` |

Pose recovery records CPU SIFT/exhaustive matching with one OPENCV camera, 16384 features, 3200-pixel extraction limit, no guided matching and mapper seed 0.
Training records 30000 steps, resolution 2832, seed 42, 10M splat ceiling, SH degree 3 and exports every 2000 steps; the ceiling is not a target count.
The historical run produced 2696872 PLY splats before cropping; its original COLMAP/Brush settings lack receipts, so a new run does not claim bit-identical reproduction.

Before marking, authenticate with `modal setup`, configure the secret in Modal's console, then upload the exact ingested JPEGs:

```sh
modal volume create sfg-spike-frames
modal volume put sfg-spike-frames data/capture/jpg /jpg
nice -n 19 uv run --project pipeline python -m pipeline.pack.preflight
```

Open the deployment's URL, mark the frames selected by `mask_tools.PARTS`, review each mask and save; stop the marking app with `modal app stop sfg-sam-live` when done.
`mask_tools.py` owns shared photo orientation/mask handling; `lift.py` is shared lifting geometry plus a single-part diagnostic.
The old `sam_clicks.py` spike was removed.

## Annotation identity

| Boundary | Guarantee |
| --- | --- |
| Capture | Ordered photo names, byte counts and SHA-256 values; checked before remote GPU work and on the remote volume |
| Browser | Authoritative saved prompts/masks restored without prediction; local storage only a capture-bound draft associated with a saved revision |
| Save | Complete part prompt set, including deletions/empty sets; stale capture/revision rejected and late cleared-prompt responses ignored |
| Revision | `/marks/<part>/sets/<revision>/` committed before `current.json`; failed replacement leaves the previous accepted set readable |
| Track/lift | Exact capture, reconstruction and saved-mask identities; tracking records SAM source/checkpoint/Torch and chosen variant; foreign or missing parts rejected |

The SAM image pins source `2345a4a`, Torch 2.8.0 and torchvision 0.23.0.
With four or more keyframes, tracking scores variants against two held-out difficult frames before using all keyframes; `--variant` records a deliberate override.
Negative tracker scores do not vote during lifting.

Historical masks/tracks predate these identities and need an explicit retrospective import; that records supplied bytes without recovering their original SAM environment/checkpoint.
For the shipped capture:

```sh
nice -n 19 uv run --project pipeline python -m pipeline.pack.import_annotations \
  --marks data/segment/marks --tracks data/segment/tracks \
  --confirm-capture 7baafdfa4989ed599629887d69701a400e35d6e005801c1cbe7f711b0cd9af74 \
  --out data/pack/.sources/annotations
nice -n 19 uv run --project pipeline python -m pipeline.pack.lift_all \
  --marks data/pack/.sources/annotations/marks --tracks data/pack/.sources/annotations/tracks \
  --out data/pack/.sources/lift
nice -n 19 uv run --project pipeline python -m pipeline.pack.export --labels data/pack/.sources/lift/labels.npy --replace
nice -n 19 uv run --project pipeline python -m pipeline.pack.export_checks --labels data/pack/.sources/lift/labels.npy
```

## Publication and distribution

| Contract | Behaviour |
| --- | --- |
| Geometry | Photo gravity levels the cloud; crop/placement carry cloud and labels together, including rotations and spherical harmonics |
| Binary | SPZ gzip version 3 in RUB coordinates; unchanged SFGL header and byte-per-splat labels |
| Manifest | Schema 1, optional `sources` extension: capture/reconstruction digests, `ply`, `labels`, `liftingReport`, `content`, `knowledge` file identities and exact `partLabels` mapping |
| Source paths | Portable provenance references, not pack-relative shipped files; source artifacts excluded from the release archive |
| Verification | Actual [app parser](../apps/field-guide/src/pack/parsePack.ts), file digests/counts, independent SPZ decoding, transformed source/labels and part bounds before promotion |
| Replacement | Existing versions rejected unless `--replace`; temporary candidate and rollback preserve the old pack on failure, without simultaneous-reader atomic exchange |
| Diagnostics | `publication.json` inside the pack directory holds placement/geometric checks; retained locally, excluded from the archive |
| Distribution check | `node scripts/validate-pack.cjs <pack-directory>` validates app schema and shipped bytes without replaying the capture |
| Preparation | `scripts/prepare.sh [--pack <archive>]` accepts the pinned manifest plus verified files, reuses a matching cache and rejects unexpected archive entries |

`export_checks.py` needs the corresponding original source artifacts; a missing source fails verification.
Review previews, highlighted parts and procedures against the real engine before releasing changed content; geometric consistency does not establish correct physical annotations.
After reviewed publication, update the pinned [release manifest](../content/gol-trend-engine-bay/manifest.json), then package:

```sh
cp data/pack/gol-trend-engine-bay/1/manifest.json content/gol-trend-engine-bay/manifest.json
nice -n 19 scripts/package-pack.sh
```

Packaging writes deterministic `data/pack/releases/gol-trend-engine-bay-1.tar.gz` and `.tar.gz.sha256`, accepting optional `--pack <directory>` and `--out <archive>`.
When authorised to publish, fill `PUBLISHED_REPOSITORY` in `scripts/prepare.sh` and upload both files under tag `pack-gol-trend-engine-bay-1`; `FIELD_GUIDE_PACK_URL` overrides the default URL.
The package command does not upload anything; ignored local packs/archives do not travel with git.
Preparation also builds/reuses the engine, fetches pinned Kokoro resources, installs app JS/Ruby dependencies and runs `bundle exec pod install`; a missing TypeScript compiler is bootstrapped before pack validation.

## Provisional AR extension

The viewer archive excludes the separately trained recognition reference.
Read the [registration journal](../docs/research/08-engine-object-registration.md#pipeline-propuesto) and [latest audit](../docs/research/10-object-tracking-training-audit.md) before authoring it.

| Entry point | Role |
| --- | --- |
| `reconstruct_reference.swift` | Object Capture model, poses and capture identities; inspect `--check` before reconstruction |
| `register_reference.py` | Digest-bound camera fit to COLMAP and `publication.json` placement |
| `prepare_reference.py`, `cleanup_reference.py` | Root transform and bounded fragment removal, preserving geometry/textures |
| `train_reference.py --mode standard --angles front --plan` | Explicit latest Standard/Front choice; requires `--source` and `--output`, remove `--plan` only to start training |
| `author_ar_landmarks.swift`, `publish_landmarks.py` | Reviewed raw mesh picks, digest-bound conversion and pack-bound candidate; changed models rejected |
| `watch_reference.py`, `monitor_reference.py`, `probe_reference.swift` | Training/reference diagnostics |
| `watch_ar.py` | Explicit `--device`, JSONL/state files and optional replay verdict; Debug app console metadata only, not images/audio or model confidence |

The current app [landmarks](../apps/field-guide/assets/ar/landmarks.json) remain a candidate until the trained-reference frame and physical alignment are verified.
Create the output directory before redirecting the monitor's human-readable stdout:

```sh
mkdir -p data/diagnostics
uv run --project pipeline python -m pipeline.ar.watch_ar --device '<connected iPhone identifier>' --expect detected > data/diagnostics/ar-monitor.log
uv run --project pipeline python -m pipeline.ar.watch_ar --check-capture data/diagnostics/ar-live.jsonl --expect detected
```

Reaching the 512 KiB limit retains an incomplete-capture error that also fails replay; a positive recognition verdict still requires separate alignment measurement.
