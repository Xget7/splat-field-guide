# A pruned SplatKit copy without LOD

Status: accepted.

An equipment guide needs labelled geometry and a bounded viewer rather than a general scene SDK.
Keep a recorded SplatKit source copy with one cloud per tier, export-time cropping and runtime filtering, without a LOD tree.

- Filtering and spatial reordering must preserve labels with splats.
- Engine fixes and source integration are owned here, with revisions and licenses in [provenance](../PROVENANCE.md).
- The high tier needs physical performance acceptance before choosing a smaller export.
- An Android renderer needs a platform adapter to the retained core.
