# Provenance

What was inherited from SplatKit and what was built for this guide ([ADR 0002](adr/0002-pruned-splatkit-copy.md)).

## Inherited

Source: SplatKit (MIT, same author), commit `62cee54d884bd20c7dd450e8e6525e3d4c0e1652` (30 September 2026).
Imported byte for byte into `packages/react-native-splat/engine/`, then pruned in later commits:

| Folder | SplatKit folder | Role |
| --- | --- | --- |
| `engine/splat-core` | `packages/splat-core` | SPZ decoding, Morton order, maths |
| `engine/splatkit-engine` | `packages/splatkit-engine` | Frame loop, orbit camera, GPU record layout |
| `engine/splatkit-ios` | `packages/splatkit-ios` | Metal backend and shaders |

Not imported: SplatKit's release tooling (`packages/splatkit-ios/distribution`), the Android backend (imported later from the same commit), the React Native bridge and the example apps.
Inherited code is alpha quality and is changed only where the guide needs it.

## Built for this guide

Everything else in the repository.
