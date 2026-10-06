# A verified offline pack with aligned part labels

Status: accepted.

SPZ has no per-splat label extension, and the guide must open without a server.
Bundle manifest-referenced SPZ and labels.bin files, keeping one label byte aligned with each splat through lifting, export, filtering and reordering.
Preparation and native loading verify manifest digests and counts before accepting content.

- The [pack contract](../specs/field-guide-design.md#pack-contract) covers binary layout and source identities.
- Only explicitly bundled versions and their runtime files enter the app.
- Android copies APK assets to verified app-private files because the core maps file paths.
- Downloaded updates need installation, authenticity and replacement rules.
- Offline speech and generation also depend on prepared system assets.
