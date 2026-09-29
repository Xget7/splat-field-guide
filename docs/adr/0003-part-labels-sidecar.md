# Part labels live in a sidecar aligned to the final SPZ order

Status: accepted

SPZ v4 has no per-splat extension, only file-level records.
Each pack therefore ships `labels.bin`, one part label per splat in the exact order of the pack's SPZ file, and the manifest records the splat count and the SPZ hash it belongs to.
The pipeline lifts labels onto the decoded final SPZ, never onto an earlier PLY, because conversion can drop splats.

**Pros**
- Any SPZ reader still opens the file.
- One byte per splat; trivial to load and to check.

**Cons**
- Two files must stay in step; a mismatched pair is rejected at load, not repaired.
- The engine must carry labels through its own reordering, so the cloud permutes them with every other field.
