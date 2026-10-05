# English frontend

These five files are adapted from [FluidAudio](https://github.com/FluidInference/FluidAudio/tree/2a2e382f80e07720fb511183de1731813a90a39a/Sources/FluidAudio/TTS), under Apache-2.0.
The license is retained in [LICENSES/FluidAudio.txt](../../LICENSES/FluidAudio.txt).
The English phonemizer keeps Misaki dictionary pronunciations, initialisms, contractions and possessives, with the small English BART model for unknown words.
The normalizer uses the upstream conservative numeric rules and `SayAsInterpreter`.

Local adaptations make calls synchronous on the speech worker, load G2P only from the app resource bundle, route logging through `OnDeviceLog`, reject unknown pronunciations rather than omit words, check G2P input lengths, and remove the optional NeMo normalizer and network/cache dependencies.
No eSpeak code or data is linked.
When updating these files, compare the pinned originals and review those adaptations.
