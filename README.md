# Miris factory guide

An iOS guide aiming to join spatially aware Gaussian splats, CAD and local ML for the whole Miris factory cell, explaining the car process to an employee starting from zero.
React Native, the native GPU viewer, supplied-vector ranking, pack graph and grounded Apple Foundation Models generation exist.
The current prepared subset covers four robots; whole-cell segmentation, CAD by ID, secure remote chunked delivery, on-device installation/activation and viewer relation navigation remain open.
No Miris simulator or physical-device acceptance is recorded.
The app and native project paths retain the Field Guide name.
Startup shows an empty library until a validated Miris pack is integrated.

- [First principles](docs/specs/first-principles.md): full objective, stable segmentation IDs and evidence boundaries.
- [Architecture](docs/specs/field-guide-design.md): responsibilities, data contracts and native interfaces.
- [Tasks and acceptance](TASKS.md): remaining work and evidence.
- [Development](docs/agents/checks.md): setup, builds, tests and GPU profiling.
- [Agent instructions](CLAUDE.md): contribution rules.
- [Third-party notices](THIRD_PARTY_NOTICES.md): licenses and source identities.

Preparation belongs to the separate `splat-tools` checkout.
This repository consumes prepared packs; it does not train or run semantic encoders.
