# A local pipeline with COLMAP and Modal SAM

Status: superseded on 2026-10-27 by the owner's extraction of all Python preparation into the separate `splat-tools` workspace.

The original engine capture used COLMAP and Brush locally, with SAM 3.1 on Modal for marking and mask propagation.
Capture-stage technology, training recipes, source receipts and preparation licenses now belong to `splat-tools`.

- Camera recovery, masks and publication share capture identities.
- Scale comes from an approximate battery dimension and needs physical verification.
- Demo preparation consumes a verified archive without repeating training.
- SAM execution requires model access, credentials and its upstream restricted-use license retained with the external tooling.
