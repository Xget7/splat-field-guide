# One repository at the pack contract

Status: accepted.

The pipeline and app share a versioned pack contract, so keep the pipeline, app and native packages in one repository.
Publication validates packs with the app parser through [validate-pack.cjs](../../scripts/validate-pack.cjs), allowing producer and consumer changes to be verified together.

- Contract changes and their checks can land together.
- Each unit retains its own toolchain and tests.
- Extracting the pipeline requires a separately maintained consumer contract.
