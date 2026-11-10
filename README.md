# Miris factory guide

A mobile guide for exploring the Miris factory, identifying robot parts and following authored guidance with an instructor.
React Native, the native GPU viewer and online/offline instructor exist; Miris pack delivery and semantic integration are pending.
The app and native project paths retain the Field Guide name, and startup still opens the previous bundled content.

- [Architecture](docs/specs/field-guide-design.md): responsibilities, data contracts and native interfaces.
- [Tasks and acceptance](TASKS.md): remaining work and evidence.
- [Development](docs/agents/checks.md): setup, builds, tests and GPU profiling.
- [Agent instructions](CLAUDE.md): contribution rules.
- [Third-party notices](THIRD_PARTY_NOTICES.md): licenses and source identities.

Preparation belongs to the separate `../splat-tools` workspace.
This repository consumes prepared packs; it does not train or run semantic encoders.
