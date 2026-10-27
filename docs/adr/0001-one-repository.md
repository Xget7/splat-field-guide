# One repository at the pack contract

Status: superseded on 2026-10-27 by the owner's extraction of splat preparation into the separate `splat-tools` workspace.

The original decision kept the pipeline, app and native packages together so producer and consumer changes could share verification.
The mobile repository now owns pack consumption and validation through [validate-pack.cjs](../../scripts/validate-pack.cjs); `splat-tools` owns capture, annotation, reconstruction, training and export.

Both workspaces retain the versioned pack contract and their own checks.
