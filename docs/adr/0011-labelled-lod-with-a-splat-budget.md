# A labelled LOD tree drawn within a splat budget

Status: accepted; replaces [ADR 0002](0002-pruned-splatkit-without-lod.md).

A wide orbit of the engine bay puts about 2.5 million splats in view, so drawing the whole cloud costs most where detail matters least.
Export builds SplatKit's LOD tree from the cropped cloud and its part labels, and the viewer draws at most 1.6 million splats a frame, refining to the leaves close up.

- A leaf keeps its splat's part, and a merged node takes the part carrying most of its leaves' opacity, so highlight and dimming hold at every level.
- Picks read the leaves only, because a merged node spans the gaps between its parts.
- Haze and sparse floaters leave at export, before the build; the app loads only the tree and its node labels.
- The tree ships at SH degree 1, about 302 MB for the high tier against 695 MB at SH degree 3.
- The engine copy takes SplatKit's tree, selection and renderers with only the label patches its `UPSTREAM` files list, so later syncs inherit upstream LOD work; [provenance](../PROVENANCE.md) records the revision.
- The verified offline pack of [ADR 0004](0004-verified-offline-pack.md) carries the tree and node labels in place of the SPZ cloud and per-splat labels.
- The high tier still needs physical performance acceptance on the iPad and the iPhone.
