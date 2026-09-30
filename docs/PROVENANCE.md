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

### Pruned

The guide shows one small world from an orbit camera, so the rest of SplatKit went:

- level of detail, tiled streaming, colliders, walking and the gyroscope camera;
- CPU sorting and its worker pool, with the Metal paths that drew in CPU order;
- the tile rasterizer, render policies, linear blending and the benchmark;
- the GLB decoder and encoder and SplatKit's command-line tools;
- the Swift `SplatMetalView` and the Objective-C `SKSplatEngine`, replaced by the Nitro view.

Kept: SPZ decoding, the Morton reorder, the frame loop and the GPU pipeline (visibility, radix sort, front-to-back compositing).
The walk camera became an orbit camera.

Not imported: SplatKit's release tooling (`packages/splatkit-ios/distribution`), the Android backend (imported later from the same commit), the React Native bridge and the example apps.
Inherited code is alpha quality and is changed only where the guide needs it.

## Built for this guide

Everything else in the repository.
