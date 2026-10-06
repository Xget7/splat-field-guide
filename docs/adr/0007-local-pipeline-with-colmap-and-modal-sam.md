# A local pipeline with COLMAP and Modal SAM

Status: accepted.

Polycam photo-mode camera records cannot supply usable poses, and SAM needs CUDA.
Run COLMAP, Brush, lifting and export locally, with SAM 3.1 on Modal for marking and mask propagation.

- Camera recovery, masks and publication share capture identities.
- Scale comes from an approximate battery dimension and needs physical verification.
- Demo preparation consumes a verified archive without repeating training.
- SAM execution requires model access, credentials and its [restricted-use license](../PROVENANCE.md#preparation-tools).
