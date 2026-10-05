# Provenance

Original Field Guide work is [MIT licensed](../LICENSE), with holder `Xget7` from git author history.
Inherited source and third-party resources keep the licenses below.

## Shipped code and resources

| Dependency | Origin and identity | License and retained notice |
| --- | --- | --- |
| SplatKit C++/Metal | [Xget7/splatkit](https://github.com/Xget7/splatkit), imported `62cee54d884bd20c7dd450e8e6525e3d4c0e1652`, synced through `a28c8cc4e89fb0b40d98691f40fc8472870dda4c` | MIT, [engine license](../packages/react-native-splat/engine/LICENSE) |
| SPZ reader | [nianticlabs/spz](https://github.com/nianticlabs/spz/tree/affd0ecea7fbb4c265ee119475af7ee5b2997482), pinned by CMake and merged into the engine archive | [MIT](https://github.com/nianticlabs/spz/blob/affd0ecea7fbb4c265ee119475af7ee5b2997482/LICENSE) |
| zstd | SPZ's [1.5.6 dependency](https://github.com/nianticlabs/spz/blob/affd0ecea7fbb4c265ee119475af7ee5b2997482/CMakeLists.txt), merged into the engine archive | [BSD-3-Clause](https://github.com/facebook/zstd/blob/v1.5.6/LICENSE), alternatively GPL-2.0; use BSD terms |
| zlib | System library linked as `z` by the iOS pod | [zlib license](https://zlib.net/zlib_license.html) |
| React, React Native and Hermes | JS app/runtime, versions in the [app lockfile](../apps/field-guide/package-lock.json) and [pod lockfile](../apps/field-guide/ios/Podfile.lock) | MIT, [React](https://github.com/facebook/react/blob/main/LICENSE), [RN](https://github.com/facebook/react-native/blob/main/LICENSE), [Hermes](https://github.com/facebook/hermes/blob/main/LICENSE) |
| Navigation and storage | React Navigation native/native-stack and React Native AsyncStorage | MIT, [navigation](https://github.com/react-navigation/react-navigation/blob/main/LICENSE), [storage](https://github.com/react-native-async-storage/async-storage/blob/main/LICENSE) |
| UI/native bridge dependencies | Gesture Handler, Nitro Modules, Reanimated, Worklets, Safe Area Context, Screens and SVG, resolved in the app lockfile | MIT, notices in the installed packages and pod distributions |
| ONNX Runtime | Microsoft `onnxruntime-c` 1.30.0, CPU inference | MIT, [license and third-party notices](../packages/react-native-on-device/LICENSES/) bundled with speech resources |
| Kokoro model and voice | [ONNX conversion](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231), quantized v1.0 and `af_heart` | Apache-2.0, [model/voice notice](../packages/react-native-on-device/LICENSES/Kokoro-Notice.txt) |
| Kokoro phoneme configuration | [Original hexgrad model](https://huggingface.co/hexgrad/Kokoro-82M/tree/04393022a04dcb701fd2061b8d5dbe23ac7be751), `config.json` | Apache-2.0, same model notice |
| FluidAudio Swift frontend | Five adapted files from [revision 2a2e382](https://github.com/FluidInference/FluidAudio/tree/2a2e382f80e07720fb511183de1731813a90a39a/Sources/FluidAudio/TTS) | Apache-2.0, [license](../packages/react-native-on-device/LICENSES/FluidAudio.txt) and [local adaptations](../packages/react-native-on-device/ios/KokoroFrontend/README.md) |
| Misaki pronunciation data | [hexgrad/Misaki](https://github.com/hexgrad/misaki), English lexicon converted by FluidInference | [Apache-2.0](https://github.com/hexgrad/misaki/blob/main/LICENSE), model/voice notice |
| English BART G2P resources | [PeterReid weights](https://huggingface.co/PeterReid/graphemes_to_phonemes_en_us/tree/a5631b285d18d59483c32c0c3379cb9fac924f4b), lexicon/vocabulary and compiled encoder/decoder from [FluidInference revision 006395f](https://huggingface.co/FluidInference/kokoro-82m-coreml/tree/006395f65025af251858b1ab0a7178a6a1e73f9f) | Apache-2.0, model/voice notice and bundled Apache text |
| Geist fonts | [vercel/geist-font](https://github.com/vercel/geist-font), bundled font binaries | SIL OFL-1.1, [retained font notice](../apps/field-guide/assets/fonts/Geist-OFL.txt) |
| Apple frameworks | Metal, ARKit, RealityKit, Speech, Foundation Models, AVFoundation, Core ML and platform frameworks | Apple SDK/platform terms; system implementations, not vendored source |

Speech files and hashes are enumerated in [kokoro-models.json](../apps/field-guide/scripts/kokoro-models.json); preparation copies their notices into the resource bundle.
ONNX Runtime's own third-party notices remain distinct from its top-level MIT license.
Release packaging must also retain the engine dependency and font notices; source presence alone does not verify their inclusion in a distributed app.

## Preparation and test tools, not shipped in the app

| Tool | Use | License or terms |
| --- | --- | --- |
| Polycam | Capture/export of photos and LiDAR depth | Proprietary service/application terms |
| COLMAP 4.2 | Camera poses from photos | [BSD-3-Clause](https://github.com/colmap/colmap/blob/4.2.0/COPYING.txt), with its own dependency notices |
| Brush 0.3.0 | Local Gaussian-splat training | [Apache-2.0](https://github.com/ArthurBrussee/brush/blob/main/LICENSE) |
| SAM 3.1 | Mask marking/propagation on Modal; pipeline code pins SAM repository revision `2345a4a` | Meta [SAM License](https://huggingface.co/facebook/sam3.1/blob/main/LICENSE), covering code and weights |
| PyTorch / torchvision | SAM execution | BSD-3-Clause, [Torch](https://github.com/pytorch/pytorch/blob/main/LICENSE), [vision](https://github.com/pytorch/vision/blob/main/LICENSE) |
| NumPy / SciPy | Lifting and geometry | BSD-3-Clause |
| OpenCV / Pillow / PyYAML | Images, projection and content parsing | Apache-2.0 / HPND / MIT |
| FastAPI / httpx2 / uvicorn | Marking interface and local preflight | MIT / BSD-3-Clause / BSD-3-Clause |
| OpenUSD `usd-core` | AR reference preparation/cleanup | Apache-2.0, [OpenUSD license](https://github.com/PixarAnimationStudios/OpenUSD/blob/release/LICENSE.txt) |
| Modal / Hugging Face | GPU execution and model acquisition | Hosted service terms; Modal client Apache-2.0, model licenses separate |
| Object Capture / Create ML / Xcode | AR reconstruction/training and native builds | Apple SDK/tool terms |
| CMake / GoogleTest | Native builds and interface tests | BSD-3-Clause, with GoogleTest pinned to 1.15.2 |
| Node/npm, TypeScript, Babel, ESLint, Jest, Nitrogen | JS build, checks and generated Nitro glue | Tool-specific permissive licenses; versions/notices in package lockfiles and distributions |
| Ruby/Bundler / CocoaPods | Pod resolution and installation | Ruby/BSD terms or MIT, according to the tool |
| Wrangler / Workers / Claude | Proxy build, hosting and online model | Wrangler Apache-2.0/MIT; hosted services under provider terms |

SAM is used only during preparation; no SAM code or weights are bundled in Field Guide.
Its license includes end-use restrictions, including military/warfare uses, so it must be reviewed before reusing this pipeline for defence training.

## Inherited modifications

SplatKit was copied into `engine/splat-core`, `engine/splatkit-engine` and `engine/splatkit-ios`, then pruned of LOD, tiles/streaming, walking/colliders, CPU-sort fallback, GLB tools, benchmark policy and its old Swift/Objective-C hosts.
The guide adds label-aware filtering/reordering, picking, highlight, orbit/framing and the Nitro host; the Vulkan backend, upstream release tooling and example apps were not imported.
FluidAudio adaptations remove network/cache and optional NeMo paths, confine work to the speech worker, load bundled G2P, use local logging and reject unsupported pronunciations/lengths.
No eSpeak code or data is linked by the chosen speech path.
