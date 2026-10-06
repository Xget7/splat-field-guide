# Splat Field Guide

Field Guide turns a capture of real equipment into a mobile maintenance guide with named parts, procedures and a spoken instructor.
The demo covers the author's Volkswagen Gol Trend engine bay, with tablet layouts on iPad and Android and an iPhone viewer.
Open a guide, explore its parts or follow a procedure; use reading or voice mode for instructor questions.
Physical acceptance and delivery work are listed in [TASKS.md](TASKS.md).

## Quickstart

The commands below run iOS; [Android setup](apps/field-guide/README.md#android) covers its SDK and emulator.
Use an Apple silicon Mac with the prerequisites in [app setup](apps/field-guide/README.md#setup).
From the repository root:

```sh
nice -n 19 scripts/prepare.sh
cd apps/field-guide
nice -n 19 npm run ios
```

Preparation downloads the pack from this repository's release with an authenticated `gh`; `--pack <archive>` or `FIELD_GUIDE_PACK_URL` override it.
Preparation verifies the pack, builds/reuses the engine, fetches pinned speech resources and installs JS/Ruby dependencies and CocoaPods.
Device signing and offline system-asset preparation are in [app setup](apps/field-guide/README.md).

## Read next

- [Design and ownership](docs/specs/field-guide-design.md), [vocabulary](CONTEXT.md) and [targets](REQUIREMENTS.md).
- [Architecture decisions](docs/adr/), [capture and reference pipeline](pipeline/README.md) and [instructor proxy](services/instructor-proxy/README.md).
- [Viewer package](packages/react-native-splat/README.md) and [speech/model package](packages/react-native-on-device/README.md).
- [Provenance](docs/PROVENANCE.md), [third-party notices](THIRD_PARTY_NOTICES.md) and [MIT license](LICENSE).
- [Agent instructions](AGENTS.md) for operational commands and contribution rules.
