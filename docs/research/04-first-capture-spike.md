# First capture spike

Run on 2026-09-29 on an M4 Pro (24 GB) with the first capture of a 2010 VW Gol Trend 1.6 engine bay.
Throwaway: the scripts are not part of the pipeline; the numbers inform its design.

## Capture

Polycam photo mode, "Raw data" export: 124 HEIF photos at 2832 x 2124, one 768 x 576 LiDAR depth PNG per photo, and per-photo camera JSON.
The camera JSON is empty in photo mode: every translation is 0, width and height are 0 and `fx` is a negative placeholder.
So poses must come from structure from motion (see [ADR 0009](../adr/0009-poses-from-colmap.md)).
The photos form one band at roughly one height, looking down into the bay.

## Poses (COLMAP 4.2, Homebrew, CPU only)

| Run | Features | Registered | Points | Mean reprojection error | Time |
| --- | --- | --- | --- | --- | --- |
| 2000 px, default SIFT | ~8k per photo | 124 / 124 | 32,246 | 1.34 px (at 2000 px) | ~5 min |
| 2832 px, 16k SIFT | ~16k per photo | 124 / 124 | 60,308 | 1.31 px (at 2832 px) | ~24 min |

Guided matching on CPU took 36 minutes for the first of nine blocks and was abandoned; plain exhaustive matching finished in about 4 minutes on the same features.

## Training (Brush 0.3.0, Metal via WebGPU)

At 1600 px Brush trained at about 20 steps per second.
At full resolution (2832 px, 30k steps, default growth) it trained at about 5 steps per second, slowing as splats grew: about 110k splats at step 2,000, 430k at 6,000 and 730k at 8,000.

## What it means for the pipeline

- The capture is good enough to register completely; coverage below the band and close-ups of demo parts are the likely gaps.
- Full-resolution training on this Mac takes hours, which is why training runs on Modal ([ADR 0008](../adr/0008-pipeline-on-modal.md)).
- Splat growth must be capped by a budget, not left to default densification ([ADR 0010](../adr/0010-no-level-of-detail.md)).
