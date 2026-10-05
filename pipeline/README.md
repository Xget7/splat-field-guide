# From capture to pack

This is the executable recipe for the 124-photo capture of the 2010 Volkswagen Gol Trend engine bay.
The pipeline uses local COLMAP poses, local Brush training, Modal SAM masks and tracking, then local lifting and verified publication.
Every command below runs from the repository root.
Stages have separate entry points so rerunning a diagnostic cannot stand in for a missing stage.

## Use the published demo first

Building the app does not require the original photos, Brush or a GPU.
Run `scripts/prepare.sh --pack /path/to/gol-trend-engine-bay-1.tar.gz` with the author's release archive, or `scripts/prepare.sh` once the release URL is configured.
`FIELD_GUIDE_PACK_URL` overrides the default GitHub Release URL.
Fill the single `PUBLISHED_REPOSITORY` owner/name constant in `scripts/prepare.sh` when publishing the repository.
Preparation checks the pinned [release manifest](../content/gol-trend-engine-bay/manifest.json) and every cloud and labels digest before accepting the pack.
It reuses an already matching pack, builds the engine with its no-argument build script, fetches Kokoro resources through the existing fetch script, installs JavaScript dependencies and runs CocoaPods.
A fresh checkout bootstraps JavaScript dependencies without lifecycle scripts first, because pack acceptance executes the actual TypeScript app parser.
The normal dependency installation still runs after the engine and speech resources are prepared.

## Inputs and tools

The original Polycam export, saved annotations, trained PLY and AR reference artifacts are author-supplied inputs, excluded from git.
The pack release contains the app's offline guide, not the raw capture or recognition reference.
Obtain permission to use the photos and obtain the original Polycam photo-mode export from the author before reproducing the capture stages.
Preserve its HEIF or JPEG photos, depth files and camera JSON together.
For the shipped capture, the 124 JPEGs are 2832 by 2124 pixels and retain Apple acceleration MakerNotes.
The committed tracker-camera artifact records their names, bytes and SHA-256 identities.

Use Python 3.12 or later, `uv`, Node 26 or later, COLMAP 4.2.x, and macOS with Apple silicon for the recorded local training route.
Install the local tools with `brew install uv colmap exiftool` and check `colmap -h` reports the required version.
The pose entry point rejects other COLMAP versions because its recorded flags are version-specific.
Use the macOS arm64 Brush 0.3.0 release from [Brush's releases](https://github.com/ArthurBrussee/brush/releases) and place `brush_app` at `tools/brush/brush-app-aarch64-apple-darwin/brush_app`, or pass `--brush` to `training.py`.
The binary used for the shipped training recipe reports `brush-cli 0.3.0` and has SHA-256 `8380ed40cce870025393e1ea0257e0752351c67a409d827b76dc75ec3a999a71`.
The training entry point records the actual binary digest and version rather than trusting its filename.
Python stage dependencies are declared in each script's `uv` metadata.

## 1. Ingest

Extract the Polycam archive into a separate input directory.
Ingest retains the original export under `originals/`, copies JPEGs without changing their bytes, and converts HEIFs using `sips` followed by an `exiftool` metadata copy.
Conversion must retain the stored pixel dimensions, supported EXIF orientation and Apple acceleration vector or the stage fails before publication.
It records original input digests, conversion method and the ordered JPEG inventory in `capture.json`.
An unchanged input and output are reused; changed inputs require a new output directory.

```sh
nice -n 19 uv run pipeline/ingest.py --source data/input-polycam --out data/capture
```

An arbitrary camera without Apple's acceleration metadata cannot use the current gravity-based exporter.
Polycam camera translations from this export are empty and are not used for poses.
Depth is preserved as source evidence; the current pack scale does not use it.

## 2. Recover poses from scratch

The pose entry point creates a fresh database, extracts SIFT features, matches every photo pair and maps the reconstruction.
It uses one OPENCV camera, up to 16384 features per image, a 3200-pixel extraction limit, CPU extraction and matching, disabled guided matching and mapper seed 0.
COLMAP 4.2's `FeatureExtraction`, `FeatureMatching` and `Mapper` flags are written into the receipt alongside its version and all invoked commands.
Logs, the database, model analysis and `poses.json` stay with the completed reconstruction.
An absent or split reconstruction, or one that fails to place every photo, is rejected.
Failed COLMAP commands and absent reconstructions report the tail of their logs before the temporary candidate is removed.
Reruns reuse only a reconstruction whose capture identity, settings, tool version and binary digests still match.

```sh
nice -n 19 uv run pipeline/poses.py
```

The historical reconstruction predates these receipts, so its original database settings cannot be proved from the existing binaries alone.
The recipe records explicit settings for new runs and preserves the shipped reconstruction's identity rather than claiming a bit-identical reconstruction.

## 3. Generate tracker cameras

Generate camera centres and viewing directions from the exact reconstruction Brush will train on.
The generated artifact binds every camera to the photo name, bytes and digest, and binds the whole set to all three COLMAP binary files.
Tracking checks those identities before requesting a GPU and again checks photo identity on the remote volume.
`pipeline/cameras.json` is the generated artifact for the shipped capture, not a hand-maintained list of poses.

```sh
nice -n 19 uv run pipeline/cameras.py
```

## 4. Train the cloud

Inspect the training plan before deliberately starting Brush.
The plan command records inputs and prints the invocation without starting training.
The training stage uses 30000 steps, maximum resolution 2832, seed 42, maximum 10000000 splats, SH degree 3 and exports every 2000 steps.
The maximum is a ceiling, not a target count; the shipped PLY has 2696872 splats before cropping.
These explicit seed and ceiling values match the installed Brush defaults used by the original shell recipe, whose run did not retain a training receipt.
GPU kernels and tool changes can produce different splats even with identical input bytes and settings.
A completed new run records the final PLY digest, logs and training settings in `training.json`.
An existing output is never silently destroyed.

```sh
nice -n 19 uv run pipeline/training.py --plan
pipeline/train_local.sh
```

`train_local.sh` is only the local training entry point; it no longer resumes a pre-existing COLMAP database or deletes a dataset directory.
The default final PLY is `data/splat/engine_30000.ply`.

## 5. Author and save masks

This stage requires a Modal account and approved access to the SAM model on Hugging Face.
Install the Modal CLI, authenticate with `modal setup`, and create a named `huggingface` Modal secret containing `HF_TOKEN` through the Modal console.
Accept the model's access conditions in the Hugging Face account that owns that token.
Never put the token in a source file or a command recorded in this repository.
Create the `sfg-spike-frames` volume and upload the exact ingested JPEG directory to `/jpg` before deployment.
Keep the historical volume name when restoring this capture because both SAM entry points use it.
The images pin Torch 2.8.0, torchvision 0.23.0 and SAM source commit `2345a4a`.
The tracking report records the checkpoint bytes found in the Hugging Face cache; model access and remote execution still require the author's account.

```sh
modal volume create sfg-spike-frames
modal volume put sfg-spike-frames data/capture/jpg /jpg
uv run pipeline/preflight.py
modal deploy pipeline/sam_live.py
```

Open the URL printed by deployment and mark every part shown by the page.
Selected frame indices live in `mask_tools.PARTS`; change and review that selection if reproducing a different capture.
The owner chooses positive and negative points or a rectangle on the upright photo and reviews SAM's mask before saving.
The server restores authoritative saved prompts and masks in a fresh browser without recomputing them.
Browser storage holds only a capture-bound draft associated with the saved revision.
Saving replaces the complete part's prompt set, including an intentionally empty set.
Changing parts saves deletions too, and clearing a prompt invalidates any outstanding mask response.
A capture or revision mismatch rejects a save before replacing anything.
Masks are stored in the original photo layout, so tracking and COLMAP share pixel coordinates.
Complete saved revisions live under `/marks/<part>/sets/<revision>/`, and `current.json` selects the accepted set.
The new revision is committed before its pointer is committed; failed prediction, writing or volume commit leaves the last accepted set readable.
Old accepted revisions are retained rather than deleted during a save.
Stop the deployed marking app after authoring with `modal app stop sfg-sam-live` to avoid leaving its GPU warm.

## 6. Track every part

The default tracking command enumerates all eight parts.
Each part must have saved keyframe masks before tracking.
With at least four keyframes it hides two difficult keyframes, scores the configured capture-order and view-order variants, then uses the best variant with all saved keyframes.
With fewer keyframes it records the default variant; `--variant` deliberately bypasses scoring and records the requested choice.
The report records part, keyframes, scores, chosen variant, capture identity, reconstruction identity, saved-mask digest, SAM source, Torch version and checkpoint digests.
A negative tracker score means the part was lost, and that mask does not vote during lifting.
Download saved mask revisions as well as tracked output; tracking downloads its own local output but not the author's keyframes.

```sh
modal run pipeline/sam_track.py
modal volume get sfg-spike-frames /marks data/segment
```

Local tracked artifacts publish as complete directories under `data/segment/tracks/<part>/`.
The keyframe download must leave `data/segment/marks/<part>/current.json` and its referenced `sets/` directory together.

## Restore historical annotations explicitly

The original saved masks and tracking reports predate capture and checkpoint identity recording.
They cannot be passed to the new stages as though they had recorded those identities at creation.
For the shipped capture, import the author's original artifacts into a new directory and explicitly supply its capture digest.
The importer checks part identity, mask shapes, prompt correspondence, complete tracking and mask sanity before publishing the imported set.
It records the imported byte identities and labels the binding as retrospective.
This declaration does not recover the original SAM checkpoint, environment or historical execution.

```sh
nice -n 19 uv run pipeline/import_annotations.py \
  --marks data/segment/marks --tracks data/segment/tracks \
  --confirm-capture 7baafdfa4989ed599629887d69701a400e35d6e005801c1cbe7f711b0cd9af74 \
  --out data/pack/.sources/annotations
```

## 7. Lift all parts

Lifting rejects foreign saved masks, changed keyframes, foreign tracking and missing parts.
It composites visible splat contributions from the posed photos, pools votes among neighbouring splats, assigns parents and children, rejects tracker mistakes and drops disconnected stray pieces.
The output is a uint8 label per PLY row, plus the exact PLY, capture, reconstruction, marks and tracking digests and the part-to-label mapping in `report.json`.
Previews follow each photo's actual EXIF orientation.
The complete result is staged before it replaces an older lifting result.
For newly authored annotations, use the defaults; for the imported shipped annotations, use the explicit paths below.

```sh
nice -n 19 uv run pipeline/lift_all.py \
  --marks data/pack/.sources/annotations/marks \
  --tracks data/pack/.sources/annotations/tracks \
  --out data/pack/.sources/lift
```

`lift.py` contains the shared geometry implementation and a single-part diagnostic command, not a second pack-production recipe.

## 8. Export and publish

Export levels the cloud with the photos' gravity, centres and crops the labelled equipment, and applies the same row selection to cloud and labels.
The cloud's positions, scales, rotations and spherical harmonics follow the placement.
The scale is approximate: the battery's longest horizontal side is assumed to be 0.242 metres.
This is not a measured LiDAR scale, and physical dimensions require the owner to verify the battery and equipment.
SPZ remains gzip version 3 in the RUB frame, and the SFGL labels header and byte-per-splat payload are unchanged.

Publication checks the lifting report's PLY digest, labels digest, capture, reconstruction and exact part-to-label mapping before export.
It builds a temporary candidate and validates the manifest through `apps/field-guide/src/domain/parsePack.ts`, using the same parser as the app.
There is no Python mirror of that schema.
It checks every shipped file digest and count, independently decodes SPZ, compares the transformed source cloud and cropped labels, and checks the part bounds before promotion.
A failed check leaves the previous pack intact.
Replacement uses staged directory renames with rollback; it is failure-safe but does not promise simultaneous-reader atomic exchange.
Published versions are immutable by default; create a new `--pack-version`, or explicitly pass `--replace` when preparing a reviewed replacement.
The preparation cache is idempotent; publication is intentionally explicit about replacing a version.

```sh
nice -n 19 uv run pipeline/export.py --labels data/pack/.sources/lift/labels.npy --replace
nice -n 19 uv run pipeline/export_checks.py
```

`manifest.json` records portable source identities and the mapping, while `publication.json` holds placement and geometric diagnostics inside the complete pack directory.
Full export verification requires those original source artifacts and never succeeds by skipping a missing pack or labels comparison.
Distribution integrity checking is separate: `node scripts/validate-pack.cjs <pack-directory>` checks the app schema and shipped bytes without claiming to replay original capture stages.

## 9. Review and package

Review every `views_<part>.jpg`, the coloured `parts.ply`, every highlighted part in the app, and every procedure against the physical engine before releasing changed labels or content.
The tooling establishes file and geometric consistency, not that the owner marked the right physical part.
The supplied archive is pinned by the checked-in release manifest.
After a reviewed publication, copy its manifest to the content snapshot before creating the archive.
Packaging checks all file digests, writes deterministic tar and gzip metadata, and produces a companion archive SHA-256 file.
Preparation rejects extra archive entries rather than extracting arbitrary files.
It never uploads a release.

```sh
cp data/pack/gol-trend-engine-bay/1/manifest.json content/gol-trend-engine-bay/manifest.json
scripts/package-pack.sh
```

Upload `data/pack/releases/gol-trend-engine-bay-1.tar.gz` and its `.sha256` file under release tag `pack-gol-trend-engine-bay-1` only when the author chooses to publish.
No release URL is usable until the repository owner/name is filled in or an override is supplied.

## AR reference extension

The recognition reference is a separate, provisional artifact and is not generated by the pack archive.
Its authoring requires Xcode with the Object Capture and Create ML object-tracking tools and a physical-device alignment check.
`reconstruct_reference.swift` is the one reconstruction entry point and writes its model, camera poses and capture identities.
`register_reference.py` fits those cameras to the current COLMAP reconstruction and pack placement.
`prepare_reference.py` applies the resulting root transform without changing mesh vertices or textures.
`cleanup_reference.py` removes only bounded disconnected fragments and records preserved geometry and texture identities.
`train_reference.py` records source, training mode and viewing angles, and `--plan` prints the choice without training.
The latest author-supplied reference used Standard/Front in Create ML on macOS 27.0.1; the CLI recipe must explicitly name Front to reproduce that choice.
A matching CLI configuration does not prove byte-identical output or successful recognition on the engine.

```sh
nice -n 19 xcrun swiftc -parse-as-library -O pipeline/reconstruct_reference.swift -o /tmp/reconstruct-reference
/tmp/reconstruct-reference --photos data/capture/jpg --check
nice -n 19 /tmp/reconstruct-reference --photos data/capture/jpg --detail medium --output data/ar-reference/gol-trend-engine-bay/medium.usdz
nice -n 19 uv run pipeline/register_reference.py --poses data/ar-reference/gol-trend-engine-bay/medium.poses.json --output data/ar-reference/gol-trend-engine-bay/registration.json
nice -n 19 uv run pipeline/prepare_reference.py --model data/ar-reference/gol-trend-engine-bay/medium.usdz --registration data/ar-reference/gol-trend-engine-bay/registration.json --output data/ar-reference/gol-trend-engine-bay/aligned.usdz
nice -n 19 uv run pipeline/cleanup_reference.py --model data/ar-reference/gol-trend-engine-bay/aligned.usdz --output data/ar-reference/gol-trend-engine-bay/aligned.cleaned.usdz --max-area-percent 1 --max-faces 500 --min-gap-metres 0.05
nice -n 19 uv run pipeline/train_reference.py --source data/ar-reference/gol-trend-engine-bay/aligned.cleaned.usdz --output data/ar-reference/gol-trend-engine-bay/engine-bay.referenceobject --mode standard --angles front --plan
```

Remove `--plan` only when deliberately starting reference training with sufficient scratch disk space.
The author must review the mesh's Up and Front, cleanup and scale before that operation.
The fixed viewport pixels in `author_ar_landmarks.swift` are reviewed feature choices for this reference, not automatic part detection.
Rebuild the helper, review its preview and author new picks when using another mesh.
Raw landmark output records the model digest; `publish_landmarks.py` rejects changed models and transforms those raw points using the digest-bound registration.
It adds pack identity and candidate status for an app-side artifact handoff, without claiming trained-reference origin or physical alignment is verified.

```sh
nice -n 19 xcrun swiftc -O pipeline/author_ar_landmarks.swift -o /tmp/author-ar-landmarks
/tmp/author-ar-landmarks data/ar-reference/gol-trend-engine-bay/medium.usdz data/ar-reference/gol-trend-engine-bay/raw-landmarks.json data/ar-reference/gol-trend-engine-bay/landmarks-preview.png
nice -n 19 uv run pipeline/publish_landmarks.py --raw data/ar-reference/gol-trend-engine-bay/raw-landmarks.json --registration data/ar-reference/gol-trend-engine-bay/registration.json --out data/ar-reference/gol-trend-engine-bay/landmarks.candidate.json
```

Copy a reviewed candidate to the app's AR asset location through the app owner, and retain its pending physical-validation status until measured on the engine.

## Diagnostics and checks

`watch_ar.py`, `watch_reference.py`, `monitor_reference.py` and `probe_reference.swift` are diagnostics, not pipeline stages.
A live AR monitor requires `--device`; it records no images or audio and stops with an incomplete-capture error at its byte limit rather than discarding verdict evidence.
Its human-readable output goes to stdout, so save a log using explicit redirection.
JSONL replay evaluates the same retained samples as the live verdict.

```sh
uv run pipeline/watch_ar.py --device '<connected iPhone identifier>' --expect detected > data/diagnostics/ar-monitor.log
uv run pipeline/watch_ar.py --check-capture data/diagnostics/ar-live.jsonl --expect detected
nice -n 19 uv run pipeline/preflight.py
node --test tests/pipeline/test_mark_page.cjs
nice -n 19 uv run --with 'numpy<2' --with opencv-python-headless --with pillow --with scipy --with pyyaml --with modal --with fastapi --with httpx2 python -m unittest discover -s tests/pipeline
```

Create `data/diagnostics` before redirecting a monitor log.
The obsolete `sam_clicks.py` spike and its dedicated prompt-file checks have been deleted; `mask_tools.py` is the active shared photo-layout and mask implementation.
Do not run Brush, SAM or Create ML merely to run these checks.
The [proxy README](../services/instructor-proxy/README.md) documents the independent online instructor transport and its complete-answer contract.
