# Use one cloud per tier without LOD

Status: accepted.

A guide shows one equipment assembly, with one part label per splat.

Crop during export and load one tier, removing the inherited LOD tree.

- New Brush runs record seed 42 and a 10M growth ceiling; the historical run grew to 2.7M before export cropping.
- Runtime haze/sparse filtering carries labels together; the engine does not draw every exported splat.
- Only the high tier exists; smaller export or capped retraining depends on device performance.
