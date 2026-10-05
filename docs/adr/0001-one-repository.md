# One repository for the engine, app and pipeline

Status: accepted.

The pipeline and app meet at the pack contract.

Keep the renderer, native packages, app and pipeline together so a contract change can land in one commit.

- Each folder keeps its own toolchain.
- A separate pipeline product would need an extracted pack contract.
