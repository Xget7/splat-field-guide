# Miris factory guide

An iOS guide aiming to join spatially aware Gaussian splats, CAD and local ML for the whole Miris factory cell, explaining the car process to an employee starting from zero.
The current four-robot pilot combines React Native, a native GPU viewer, evidenced component relationships, supplied-vector comparison and grounded ExecuTorch generation.
Online text and voice use ElevenLabs through signed sessions issued by the existing Cloudflare Worker.
Online and offline answers consult the same verified text corpus from both KUKA source PDFs, retaining all 643 pages with source identities and citations.
Full manual access requires explicitly bundled private source resources; see [development](docs/agents/checks.md#javascript-units) and [source restrictions](THIRD_PARTY_NOTICES.md).

Simulator checks cover offline manual retrieval, vector comparison and component selection/framing; live checks cover ElevenLabs text tools and voice transport.
Physical-device acceptance, including [Qwen on the owner's iPhone](https://github.com/Xget7/splat-field-guide/issues/28), remains open.
Whole-cell segmentation, CAD by ID, secure remote chunked delivery, on-device course installation/activation, general viewer relation navigation and figure-aware manual retrieval remain open.
The app and native project paths retain the Field Guide name.
Startup opens the organization and course workspace and loads validated packs explicitly bundled with `FIELD_GUIDE_PACKS`; builds without selected packs have an empty catalog.

- [First principles](docs/specs/first-principles.md): full objective, stable segmentation IDs and evidence boundaries.
- [Architecture](docs/specs/field-guide-design.md): responsibilities, data contracts and native interfaces.
- [Tasks and acceptance](TASKS.md): remaining work and evidence.
- [Development](docs/agents/checks.md): setup, builds, tests and GPU profiling.
- [Agent instructions](CLAUDE.md): contribution rules.
- [Third-party notices](THIRD_PARTY_NOTICES.md): licenses and source identities.

Preparation belongs to the separate `splat-tools` checkout.
This repository consumes prepared packs; it does not train or run semantic encoders.
