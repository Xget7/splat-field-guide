# No level of detail; the pipeline sets the splat count

Status: accepted

A guide shows one piece of equipment, not a world, so the pipeline crops the capture to the equipment and trains to a fixed splat budget per tier.
The engine draws every splat of the pack it loads and drops SplatKit's level-of-detail tree.

**Pros**
- Part labels map one to one onto drawn splats; no merged nodes to label.
- Less engine code and less memory.

**Cons**
- A tier too large for a device simply runs slower; there is no runtime fallback.
  The pipeline produces a smaller tier if the oldest test phone needs one.
