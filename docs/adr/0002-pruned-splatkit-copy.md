# Start from a pruned SplatKit copy

Status: accepted.

SplatKit is my existing open-source SDK, with more features than the guide needs.

Import a recorded revision as source, then prune to loading, sorting, Metal drawing and orbit behaviour.

- Revisions, modifications and licenses are in [PROVENANCE.md](../PROVENANCE.md).
- The Vulkan backend was not imported; Android needs new adapters.
- Inherited alpha code remains identifiable; published packages would couple this work to the wider SDK.
