# Start from a pruned copy of SplatKit, marked as inherited alpha

Status: accepted

The renderer comes from SplatKit, my open-source splat SDK, which is alpha code with more features than this product needs.
We copy only what the guide uses (loading, sorting, Metal and Vulkan drawing, the orbit camera), import it untouched in one commit, and list it in `PROVENANCE.md` as inherited alpha.
New work is held to a higher bar and lives in its own modules.

**Pros**
- Days of GPU work reused instead of rewritten.
- A reader can see exactly what was inherited and what was built for this guide.

**Cons**
- Inherited code keeps its alpha quality; there is no time to refactor it.
- Fixes here do not flow back to SplatKit automatically.

Considered: depending on the published SplatKit packages (mixes product work into the SDK), and a binary-only engine (hides the work a reviewer most wants to see; SplatKit is public anyway).
