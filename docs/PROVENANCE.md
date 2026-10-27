# Provenance

Field Guide is [MIT licensed](../LICENSE) to Xget7.
Shipped dependency terms and full license texts are indexed in [third-party notices](../THIRD_PARTY_NOTICES.md) and bundled in the app.

## Source and resource identities

| Material | Source identity |
| --- | --- |
| SplatKit C++/Metal | [Xget7/splatkit](https://github.com/Xget7/splatkit), import revision `3e800ff4883f7ddc0c0e7cb331401fc72f63c782`, with LOD tree building, `.lodsplat` loading and GPU LOD selection; [retained license](../packages/react-native-splat/engine/LICENSE) |
| SplatKit Vulkan/Nitro Android | [Xget7/splatkit revision 3e800ff](https://github.com/Xget7/splatkit/tree/3e800ff4883f7ddc0c0e7cb331401fc72f63c782), imported surface, buffers, GPU LOD selection, visibility, radix sorting and rendering with a Field Guide Kotlin/JNI binding; MIT under the retained SplatKit license |
| vk-bootstrap | [v1.4.307](https://github.com/charles-lunarg/vk-bootstrap/tree/v1.4.307), MIT; [retained license](../packages/react-native-splat/engine/splatkit-android/licenses/vk-bootstrap.txt) |
| Vulkan Memory Allocator | [v3.2.1](https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator/tree/v3.2.1), MIT; [retained license](../packages/react-native-splat/engine/splatkit-android/licenses/VulkanMemoryAllocator.txt) |
| PicoSHA2 | [revision 161cb3f](https://github.com/okdshin/PicoSHA2/tree/161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29), standalone Android SHA-256 header; [MIT license](../packages/react-native-splat/engine/splat-core/vendor/picosha2/LICENSE) |
| SPZ | [nianticlabs/spz](https://github.com/nianticlabs/spz/tree/affd0ecea7fbb4c265ee119475af7ee5b2997482), pinned by CMake |
| zstd | SPZ's 1.5.6 dependency, using BSD-3-Clause terms from its dual-license distribution |
| App/native dependencies | Exact JS/pod versions in [package-lock.json](../apps/field-guide/package-lock.json) and [Podfile.lock](../apps/field-guide/ios/Podfile.lock) |
| Kokoro ONNX/voice | [onnx-community revision 1939ad2](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231), quantized model and af_heart |
| Phoneme configuration | [hexgrad revision 0439302](https://huggingface.co/hexgrad/Kokoro-82M/tree/04393022a04dcb701fd2061b8d5dbe23ac7be751), config.json |
| FluidAudio frontend | Five adapted Swift files from [revision 2a2e382](https://github.com/FluidInference/FluidAudio/tree/2a2e382f80e07720fb511183de1731813a90a39a/Sources/FluidAudio/TTS), with [adaptations](../packages/react-native-on-device/ios/KokoroFrontend/README.md) |
| Misaki/BART resources | [FluidInference revision 006395f](https://huggingface.co/FluidInference/kokoro-82m-coreml/tree/006395f65025af251858b1ab0a7178a6a1e73f9f), derived from [PeterReid revision a5631b2](https://huggingface.co/PeterReid/graphemes_to_phonemes_en_us/tree/a5631b285d18d59483c32c0c3379cb9fac924f4b) |
| Geist | Bundled font binaries and [OFL text](../apps/field-guide/assets/fonts/Geist-OFL.txt) |
| Apple/Android frameworks and system libraries | Platform-provided implementations under their SDK/system terms |

[kokoro-models.json](../apps/field-guide/scripts/kokoro-models.json) records immutable download URLs and individual hashes.
ONNX Runtime's dependency notices remain bundled alongside its MIT license.
The selected speech frontend links no eSpeak code or data.

## Preparation tools

Capture, annotation, reconstruction, training and pack export live in the separate `splat-tools` workspace.
That workspace retains its tool versions, model identities, source receipts and preparation-only licenses.

| Tool | Use and terms |
| --- | --- |
| Object Capture/Create ML/Xcode | Apple SDK/tool terms for reference preparation and native builds |
| CMake/GoogleTest | BSD-3-Clause; GoogleTest is pinned to 1.15.2 |
| JS/Ruby build tools | Versions in package/Gem lockfiles with upstream distribution notices |
| Wrangler/Workers/Claude | Wrangler Apache-2.0/MIT and hosted provider terms |

## Capture and authored material

| Material | Ownership and verification |
| --- | --- |
| Photos/depth | Author's 124 Polycam photos of the 2010 Gol Trend; raw material is excluded from git/releases and requires author permission |
| Capture identity | Ordered photograph names, bytes and digests retained with the preparation receipts in `splat-tools`; published source identities are bound by the pack manifest |
| Guide content | Authored under the root license, with [source qualifications](../content/gol-trend-engine-bay/SOURCES.md) and owner review requirements |
| Masks | Eight-part reviewed prompts/keyframes; accepted revisions bind captures and imported byte identities have explicit receipt limits |
| Pack | [Pinned manifest](../content/gol-trend-engine-bay/manifest.json) binds the LOD tree, its node labels and source identities to the part mapping |
| AR | Author-supplied Object Capture/Create ML output and reviewed landmark picks, with physical alignment acceptance pending |
| V8 assembly | "V8 Engine" by little.bucket, CC BY-NC 4.0; [pinned source/prepared identities and order](../apps/field-guide/assets/ar/v8-engine.json), with final-pose baking and original geometry/materials retained |

Exact producing settings and model checkpoint identities remain with the external preparation receipts; byte identity alone does not recover execution settings.
The Vulkan import excludes streaming, render policy and CPU sorting; its [source receipt](../packages/react-native-splat/engine/splatkit-android/UPSTREAM) identifies the retained files.
The retained engine contains guide-specific labelled tree building and loading, picking, highlight and camera behaviour; its imported-source identity and license must accompany redistribution.
