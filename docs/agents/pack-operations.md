# Pack operations

Read the [process record](../process.md) and each stage's `--help`/`--plan` before execution.
Stage contracts are in [pipeline/README.md](../../pipeline/README.md).

## Stages

Run stages as modules from root with `nice -n 19 uv run --project pipeline python -m pipeline.pack.<stage>`, for `ingest`, `poses`, `cameras`, `training`, `preflight`, `import_annotations`, `lift_all`, `export` and `export_checks`.
`training --plan` starts no training; `pipeline/pack/train_local.sh` runs it.

## SAM on Modal

Before authorized SAM execution, configure Modal and its `huggingface` secret with an approved `HF_TOKEN`, then upload the exact ingested JPEGs to `sfg-spike-frames:/jpg`.
Use `modal deploy --module pipeline.pack.sam_live` for marking and `modal run --module pipeline.pack.sam_track` for propagation; stop the marking app after use.
Download the complete accepted marks revision tree from `/marks` before lifting.

## Export and archive

Verify an exported pack from root:

```sh
nice -n 19 uv run --project pipeline python -m pipeline.pack.export_checks --pack data/pack/gol-trend-engine-bay/1 --labels data/pack/.sources/lift/labels.npy
```

Source-backed export checks require every corresponding source artifact and the publication receipt; report missing inputs as blockers.
Pipeline unit tests do not establish source-backed export acceptance.
After reviewed export, update the pinned content manifest and run `scripts/package-pack.sh`; publishing requires explicit authorization.

The AR reference has no pipeline stage; it is trained in the Create ML app, as [pipeline/README.md](../../pipeline/README.md#ar-reference) records.
