# Local geometry preparation with Modal SAM

Status: accepted.

The completed Brush run and CPU geometry stages are reusable, while SAM needs CUDA.

Run COLMAP, Brush, lifting and export locally, with SAM 3.1 on Modal, superseding [ADR 0008](0008-pipeline-on-modal.md).
Use a separate Cloudflare Worker for the runtime Claude instructor.

- The [pipeline recipe](../../pipeline/README.md) records capture-bound masks and verified publication; historical annotations require explicit retrospective import.
- Demo preparation consumes a verified archive without rerunning paid training.
- No Modal pack server or universal stage cache is implemented.
