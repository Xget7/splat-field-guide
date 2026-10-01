# Kokoro-82M speech on iOS

Research date: 2026-10-01.
The app needs a natural English instructor voice that works offline from its first launch, preserves UTF-16 word highlighting, shares the microphone audio session, and automatically falls back to Apple speech.
The integration must support this repository's CocoaPods, React Native 0.87, iOS 26, and Xcode 27 setup without linking GPL or LGPL components.

## Decision

Use Microsoft's maintained `onnxruntime-c` 1.30.0 CocoaPod with a small Objective-C++ adapter with the CPU execution provider, the 8-bit Kokoro-82M v1.0 ONNX model, and the `af_heart` voice.
Vendor the small Apache-2.0 English frontend from FluidAudio, backed by its bundled Misaki pronunciation lexicon and small CPU-only Core ML BART grapheme-to-phoneme models.
This combination keeps Kokoro inference away from the documented Core ML Kokoro crashes, supports simulator measurement, avoids the MLX simulator restriction, and links no eSpeak component.
Microsoft documents the iOS native package and Objective-C or Swift integration, including its CocoaPods installation route; no additional React Native speech interface is required. [ONNX Runtime Objective-C API](https://onnxruntime.ai/docs/get-started/with-obj-c.html), [mobile deployment](https://onnxruntime.ai/docs/tutorials/mobile/).

The decision trades the Neural Engine's potential speed advantage for a smaller quantized model, catchable runtime errors, straightforward CocoaPods packaging, and a simulator path that can actually run Kokoro.
Real iPhone time to first audio and real-time factor remain device measurements, because neither this custom composition nor the candidate libraries publish a directly comparable 15-word iPhone benchmark.

## Candidate comparison

Real-time factor, abbreviated RTF, means synthesis seconds divided by generated audio seconds, so values below 1 mean faster than playback.
Some upstream projects instead report RTFx, which is the reciprocal and means how many times faster than playback the engine runs.
Time to first audio includes frontend conversion, model loading when cold, synthesis of the first sentence, and playback scheduling.
Kokoro generates complete chunks rather than yielding audio sample by sample, so shorter sentence chunks and early warming are necessary for fast first playback.

| Candidate | Quality and frontend | Published performance | Model footprint | Offline and platform fit | Decision |
| --- | --- | --- | --- | --- | --- |
| FluidAudio Kokoro ANE | Kokoro v1.0, lexicon-first English frontend with neural BART fallback | Warm English p50 241 ms and aggregate 31x RTFx on M5 Pro, not an iPhone result | About 0.33 GB before all frontend resources | Swift 6, iOS 17+, but default initialization fetches missing assets and upstream retains iOS crash advisories | Reject the full synthesis pipeline for this release; reuse its permissive English frontend |
| mlalma/kokoro-ios | Kokoro v1.0, MisakiSwift dictionary and neural fallback, predicted token timestamps | About 3.3x realtime after warmup on iPhone 13 Pro Release, equivalent to RTF about 0.30 | 327.1 MB model, 0.52 MB chosen voice, and 18.65 MB bundled Misaki resources before runtime code | Swift 6.2, iOS 18+, but MLX cannot evaluate arrays in iOS Simulator | Reject because simulator neural verification is required and initialization contains forced failures |
| sherpa-onnx | Kokoro ONNX, lexicon and eSpeak phonemization | No directly comparable first-audio benchmark found in the inspected primary sources | Full multilingual example has a 310 MiB model and 26 MiB voice pack, with lexicons and eSpeak data in addition | Mature native iOS binaries and Swift wrapper, but the standard Kokoro path compiles and calls GPL eSpeak | Reject the standard linked Kokoro distribution |
| Official ONNX Runtime plus vendored English frontend | Kokoro v1.0 quantized, permissive lexicon and BART fallback | Must measure the exact app composition in the simulator and on an iPhone | 92.36 MB model plus about 12.54 MB selected frontend and voice resources before runtime code | Official iOS CocoaPod, CPU inference, bundled resources, and no eSpeak dependency | Select |

FluidAudio's performance table reports M5 Pro warm synthesis and states that the non-streaming Kokoro TTFT metric equals the time to complete the waveform, so those values cannot be presented as measured iPhone playback latency. [FluidAudio TTS benchmarks](https://github.com/FluidInference/FluidAudio/blob/2a2e382f80e07720fb511183de1731813a90a39a/Documentation/TTS/Benchmarks.md).
Its actor facade exposes raw samples and predicted acoustic-frame durations, but its English frontend initialization uses a shared cache and fetches missing resources even when the caller supplies a custom model directory. [KokoroAneManager source](https://github.com/FluidInference/FluidAudio/blob/2a2e382f80e07720fb511183de1731813a90a39a/Sources/FluidAudio/TTS/KokoroAne/KokoroAneManager.swift).
The same facade retains advisories for iOS 26.4 and later and iOS 27, documenting process-ending BNNS or MPSGraph failures that a Swift fallback cannot catch. [KokoroAneManager OS advisory](https://github.com/FluidInference/FluidAudio/blob/2a2e382f80e07720fb511183de1731813a90a39a/Sources/FluidAudio/TTS/KokoroAne/KokoroAneManager.swift), [iOS 26.6 report](https://github.com/FluidInference/FluidAudio/issues/844), [iOS 27 report](https://github.com/FluidInference/FluidAudio/issues/889).
Some upstream documentation describes fixes on macOS 26.6 and proposed fixes for particular graph shapes, but it does not establish that the corresponding iPhone pipeline is safe for this app's target OS.

KokoroSwift 1.0.11 pins MLX Swift 0.30.2, MisakiSwift 1.0.6, and MLXUtilsLibrary 0.0.6, while its eSpeak dependency and target product remain commented out. [KokoroSwift package manifest](https://github.com/mlalma/kokoro-ios/blob/4d6d1d8ff8cd012014180c9cd4cf0151e7682354/Package.swift).
Its release benchmark claims about 3.3x realtime on iPhone 13 Pro after warmup but supplies no cold-start or 15-word first-audio measurement. [KokoroSwift README](https://github.com/mlalma/kokoro-ios/blob/4d6d1d8ff8cd012014180c9cd4cf0151e7682354/README.md).
Its model loader uses `try!`, and the main initializer force-unwraps expected model tensors, making malformed-resource errors difficult to recover from without a fork or comprehensive prevalidation. [WeightLoader source](https://github.com/mlalma/kokoro-ios/blob/4d6d1d8ff8cd012014180c9cd4cf0151e7682354/Sources/KokoroSwift/TTSEngine/WeightLoader.swift), [KokoroTTS source](https://github.com/mlalma/kokoro-ios/blob/4d6d1d8ff8cd012014180c9cd4cf0151e7682354/Sources/KokoroSwift/TTSEngine/KokoroTTS.swift).
MLX's own iOS documentation says simulator GPUs lack the Metal features required for array evaluation, which rules out genuine simulator Kokoro timing with this backend. [MLX iOS documentation](https://github.com/ml-explore/mlx-swift/blob/0.30.2/Source/MLX/Documentation.docc/Articles/running-on-ios.md).
MLX's scoped `withError` can translate C++ runtime errors into Swift errors, but it cannot catch Swift forced unwraps or replace unsupported simulator hardware. [MLX ErrorHandler source](https://github.com/ml-explore/mlx-swift/blob/0.30.2/Source/MLX/ErrorHandler.swift).

Sherpa's standard Kokoro lexicon directly initializes eSpeak and calls its phonemizer for unknown words, including when a pronunciation lexicon is provided. [Kokoro lexicon source](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/kokoro-multi-lang-lexicon.cc).
Its CMake dependency fetches and builds the eSpeak source, so checking only sherpa's Apache-2.0 top-level license would miss the linked GPL component. [eSpeak CMake dependency](https://github.com/k2-fsa/sherpa-onnx/blob/master/cmake/espeak-ng-for-piper.cmake), [eSpeak GPL license](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING).
Sherpa publishes static and dynamic iOS xcframeworks and a Swift package, which demonstrates a workable native distribution but does not remove that Kokoro frontend constraint. [Sherpa package manifest](https://github.com/k2-fsa/sherpa-onnx/blob/master/Package.swift), [Kokoro model documentation](https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/tts/pretrained_models/kokoro.rst).

The inspected `herrkaefer/SwiftKokoroONNX` alternative warns that its tokenizer has limited accuracy for complex words and long sentences, has no releases, and is therefore a weaker frontend foundation than FluidAudio's tested English implementation. [SwiftKokoroONNX README](https://github.com/herrkaefer/SwiftKokoroONNX), [package manifest](https://github.com/herrkaefer/SwiftKokoroONNX/blob/master/Package.swift).
The inspected `mweinbach/kokoro-swift` alternative includes MLX and segmented Core ML engines with a bundled Misaki frontend, but its actual package manifest declares only macOS support despite its README's broader platform claim. [kokoro-swift manifest](https://github.com/mweinbach/kokoro-swift/blob/main/Package.swift), [kokoro-swift README](https://github.com/mweinbach/kokoro-swift/blob/main/README.md).
Using the official ONNX runtime with a narrowly vendored frontend avoids adding an unverified third-party iOS wrapper.

## Voice and quality

Choose `af_heart`, an American English female voice that the original model author grades A, the highest listed overall grade among the American English voices. [Original Kokoro voice catalog](https://huggingface.co/hexgrad/Kokoro-82M/blob/04393022a04dcb701fd2061b8d5dbe23ac7be751/VOICES.md).
This gives the instructor one consistent pronunciation dialect and a strong default, while the owner's listening preference still needs an iPhone listening test.
The original catalog notes weaker output for very short utterances and rushing above roughly 400 phoneme tokens, supporting sentence segmentation and a bounded maximum chunk length. [Original Kokoro voice catalog](https://huggingface.co/hexgrad/Kokoro-82M/blob/04393022a04dcb701fd2061b8d5dbe23ac7be751/VOICES.md).
The ONNX conversion publishes audio samples for the different precision variants and identifies `model_quantized.onnx` as an 8-bit, approximately 92.4 MB option. [ONNX model card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/1939ad2a8e416c0acfeecc08a694d14ef25f2231/README.md).
Quantization quality and unusual equipment names need listening checks, because a sample and a model author's general quality claim do not replace evaluation of the app's own instructor answers.

## Frontend and licenses

The vendored English phonemizer uses Misaki lexicon entries, punctuation, initialism and possessive rules, and an injected neural fallback for unknown words rather than eSpeak. [English phonemizer source](https://github.com/FluidInference/FluidAudio/blob/2a2e382f80e07720fb511183de1731813a90a39a/Sources/FluidAudio/TTS/KokoroAne/G2P/English/KokoroAneEnglishPhonemizer.swift).
FluidAudio's small English `G2PModel` uses CPU-only Core ML encoder and decoder predictions and has a bounded greedy decoding loop. [G2PModel source](https://github.com/FluidInference/FluidAudio/blob/2a2e382f80e07720fb511183de1731813a90a39a/Sources/FluidAudio/TTS/G2P/G2PModel.swift).
This is a separate small BART graph and does not include the seven-stage Kokoro vocoder, prosody, or iSTFT graphs implicated in the upstream Kokoro crash reports.
The converter traces the English G2P model from `PeterReid/graphemes_to_phonemes_en_us` and bounds encoder and decoder lengths to 64 tokens, so an unknown word must fit within that limit after BOS and EOS tokens are added. [Conversion source](https://github.com/FluidInference/mobius/blob/864ef8050f2f281d0761de26e3a03108f9f1ce73/models/tts/kokoro/coreml/g2p/convert-to-coreml.py).

| Shipped component | License | Primary source |
| --- | --- | --- |
| Microsoft ONNX Runtime | MIT | [Runtime license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| Kokoro-82M v1.0 model and selected voice conversion | Apache-2.0 | [Original model card](https://huggingface.co/hexgrad/Kokoro-82M), [ONNX conversion card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/1939ad2a8e416c0acfeecc08a694d14ef25f2231/README.md) |
| Vendored FluidAudio Swift frontend | Apache-2.0 | [FluidAudio license](https://github.com/FluidInference/FluidAudio/blob/2a2e382f80e07720fb511183de1731813a90a39a/LICENSE) |
| Misaki English pronunciation data | Apache-2.0 | [Misaki license](https://github.com/hexgrad/misaki/blob/main/LICENSE) |
| FluidInference compiled G2P resources and lexicon cache | Apache-2.0 | [Converted resource model card](https://huggingface.co/FluidInference/kokoro-82m-coreml/blob/006395f65025af251858b1ab0a7178a6a1e73f9f/README.md) |
| Original PeterReid English BART G2P weights | Apache-2.0 | [Original G2P model card](https://huggingface.co/PeterReid/graphemes_to_phonemes_en_us/blob/a5631b285d18d59483c32c0c3379cb9fac924f4b/README.md) |

The selected path includes neither an eSpeak binary nor its GPL data directory.
Bundled notices must retain the upstream license texts, model attribution, and the exact source revision of the adapted frontend.
Adapting FluidAudio also requires documenting the local changes, especially removal of downloader and global-cache dependencies and routing logs through `OnDeviceLog`.
The rejected MLX route would have used MIT KokoroSwift and MLX, Apache-2.0 MisakiSwift and MLXUtilsLibrary, and MIT ZIPFoundation, with no eSpeak product in the pinned manifest. [KokoroSwift license](https://github.com/mlalma/kokoro-ios/blob/4d6d1d8ff8cd012014180c9cd4cf0151e7682354/LICENSE), [MLX license](https://github.com/ml-explore/mlx-swift/blob/0.30.2/LICENSE), [MisakiSwift license](https://github.com/mlalma/MisakiSwift/blob/1.0.6/LICENSE), [MLXUtilsLibrary license](https://github.com/mlalma/MLXUtilsLibrary/blob/0.0.6/LICENSE), [ZIPFoundation license](https://github.com/weichsel/ZIPFoundation/blob/development/LICENSE).

## Bundled model provenance

Fetch resources during development or build preparation into a gitignored app-local model directory, verify every file against a committed SHA-256 manifest, and copy the resulting complete directory into the app bundle.
The installed app must read only bundled paths, with no network request, first-run fetch, or dependency on an existing machine cache.
This avoids storing huge binaries in git, at the cost of requiring network access when a clean build first prepares its models.
Cache the verified model directory in CI if build speed matters, but never accept an unverified file merely because it exists.

| Resource repository | Immutable revision | Selected files |
| --- | --- | --- |
| `onnx-community/Kokoro-82M-v1.0-ONNX` | `1939ad2a8e416c0acfeecc08a694d14ef25f2231` | `onnx/model_quantized.onnx`, `voices/af_heart.bin` |
| `hexgrad/Kokoro-82M` | `04393022a04dcb701fd2061b8d5dbe23ac7be751` | `config.json`, containing the phoneme vocabulary |
| `FluidInference/kokoro-82m-coreml` | `006395f65025af251858b1ab0a7178a6a1e73f9f` | `us_lexicon_cache.json`, `g2p_vocab.json`, complete `G2PEncoder.mlmodelc` and `G2PDecoder.mlmodelc` directories |

Use the `resolve/<immutable revision>/<file path>` Hugging Face URL pattern rather than `resolve/main`.
The ONNX repository's own `config.json` is only 44 bytes and does not contain Kokoro's phoneme vocabulary, which is why the original model configuration is fetched separately.
The compiled G2P bundles contain five files each, including nested `analytics` and `weights` directories, and there is no matching prebuilt zip in the selected repository revision.
The file sizes and large-file digests below come from the repositories' primary file metadata, and small-file digests were verified directly against the pinned downloaded contents. [ONNX files](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231), [G2P files](https://huggingface.co/FluidInference/kokoro-82m-coreml/tree/006395f65025af251858b1ab0a7178a6a1e73f9f), [original config](https://huggingface.co/hexgrad/Kokoro-82M/blob/04393022a04dcb701fd2061b8d5dbe23ac7be751/config.json).

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `onnx/model_quantized.onnx` | 92361116 | `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478` |
| `voices/af_heart.bin` | 522240 | `d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b` |
| `config.json` from hexgrad | 2351 | `5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f` |
| `us_lexicon_cache.json` | 10444631 | `6b36ba313202227d6914ad32cd684a0304bd2757e9ec4158ea7bc36ec40e224e` |
| `g2p_vocab.json` | 1665 | `295ed64b86c2820cd665b0602ae50c6947c0e82ac643082873e0be87dca282ce` |
| `G2PEncoder.mlmodelc/analytics/coremldata.bin` | 243 | `cf7fbd7e7a65529b2d2bf3941e458a0ab6dff7a298bf48e205a1727c81c26a99` |
| `G2PEncoder.mlmodelc/coremldata.bin` | 398 | `0f14d46ca9fd06c68b4717294575b2b99449e67d40b7a2c56f926bf05cd90b11` |
| `G2PEncoder.mlmodelc/metadata.json` | 2034 | `c8e0cfd7f494ac1b3662ff8f1914b2b45f79ffb2791724cdc0576981996732e1` |
| `G2PEncoder.mlmodelc/model.mil` | 20392 | `8c617e569f37286b056dad800d862dc145be9a95fa9ed43857bb646ba199d7da` |
| `G2PEncoder.mlmodelc/weights/weight.bin` | 694592 | `6926bcd2827d21fec82839487b987e06f85fd8a6a5bb896bc4f6062461d014ec` |
| `G2PDecoder.mlmodelc/analytics/coremldata.bin` | 243 | `dbf1767747fdc188222d467a45b04608b396c76c71db3abb18a5fb3680ef9827` |
| `G2PDecoder.mlmodelc/coremldata.bin` | 545 | `607e960f19b4d9a30317a5a11869fcce84b300a909fcab2cc756c0d98e2dacd9` |
| `G2PDecoder.mlmodelc/metadata.json` | 3064 | `e54e98484fd60d26f22fd3c4e7fe87b0d92a5d2de1f958cc3c4bb36d4ae06a44` |
| `G2PDecoder.mlmodelc/model.mil` | 19737 | `fe647c598e0d9454d360b8ee49a59ae57ca147fc5330863ba84ccb90dce482ad` |
| `G2PDecoder.mlmodelc/weights/weight.bin` | 828030 | `cbaeb4e743359f607ab161af0c6d8a817462fdaec622ee788ef8ef952c5f8214` |

The selected resource files total 104,901,281 bytes, approximately 100.04 MiB, before native runtime code, license files, filesystem allocation, and signing metadata.
This is a resource budget rather than the measured Release `.app` increase, which must be compared against a same-configuration baseline build.

## Implementation constraints

The ONNX model takes `input_ids` as int64 `[1, tokenCount + 2]`, `style` as float32 `[1, 256]`, and `speed` as float32 `[1]`, and produces mono float32 audio at 24,000 Hz. [ONNX model inference example](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/1939ad2a8e416c0acfeecc08a694d14ef25f2231/README.md).
Reserve zero-valued BOS and EOS tokens and keep each phoneme sequence within the 510-token limit.
The voice file is little-endian float32 with 510 length-dependent 256-value style rows, so choose the row for the unpadded phoneme count and safely clamp the final supported index.
The original ONNX export returns waveform audio without original-text word timestamps, so report each sentence's original UTF-16 word ranges using audio-duration weighting when no alignment is available.
Keep original sentence text and ranges separate from normalized spoken text, because numbers, initialisms, and possessives can change phoneme grouping.
Synthesize one sentence ahead while the current sentence plays, keep inference and file work off the main thread, and warm the lazy engine when the instructor becomes available.
Stop audio immediately, invalidate callbacks for the old utterance, request runtime cancellation, and discard any result produced after cancellation.
An interrupted or failed later sentence must fall back from the remaining text, avoiding replay of sentences already heard.
The existing shared `playAndRecord` session should remain active and configured for input so the microphone can resume immediately after playback.

## Verification and owner measurements

Pin the native runtime dependency in the podspec and lockfile, then install and build from the worktree with a freshly prepared model directory.
Run the module and app typecheck, lint, and Jest checks, a Debug Simulator build, and an unsigned Release generic-device build.
Use three approximately 15-word instructor sentences and record cold load, warm synthesis, time to first playback, generated duration, and RTF separately.
Simulator results validate this implementation and expose regressions, but cannot establish an iPhone's latency, thermal behavior, power consumption, or memory limit.
On the iPhone, repeat the three samples after warming, listen for names and numbers, interrupt speech during synthesis and playback, and verify that speech input works immediately afterward.
The simulator and Release size measurements belong in the task's verification report once the final integration is built, rather than being inferred from the candidate libraries' unrelated benchmarks.
