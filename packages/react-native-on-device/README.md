# react-native-on-device

Lazy iOS Nitro modules provide speech input/output and Apple Foundation Models.
[App setup](../../apps/field-guide/README.md#device-preparation) covers system assets; [AGENTS.md](../../AGENTS.md#prepare-and-verify) has installation, checks and codegen commands.

## Interfaces

Importing the package creates no native object; `speechInput()`, `speechOutput()` and `languageModel()` instantiate on first use.

| Interface | Contract |
| --- | --- |
| [SpeechInput](src/SpeechInput.nitro.ts) | Permission, awaited `prepare(locale)` and continuous `listen`; SpeechTranscriber/DictationTranscriber with contextual hints |
| Input callbacks | Partial text, settled nonempty `onTurn`, acoustic `onVoice`, smoothed 0-1 `onLevel` capped at 30 Hz, and one `onStopped` on spontaneous loss |
| Turn boundary | 0.7 seconds of acoustic quiet, then 0.15 seconds of settlement bounded by 1.5 seconds; continuous speech bounded to 20 seconds |
| Input cancellation | Discard the current turn, reject stale callbacks and allow restart; concurrent listening/missing permission rejects |
| [SpeechOutput](src/SpeechOutput.nitro.ts) | `speak` replaces output and resolves on completion/stop; `stop` cancels synthesis, playback and callbacks |
| Output callbacks | Original UTF-16 ranges; estimated Kokoro word timing and Apple-provided timing |
| [LanguageModel](src/LanguageModel.nitro.ts) | Availability, prewarm, streaming/final respond and cancel; equipment evidence/policy belongs to the app instructor |

## Resources and audio

[ADR 0008](../../docs/adr/0008-cpu-kokoro-with-vendored-english-frontend.md) records the output choice; the [frontend README](ios/KokoroFrontend/README.md) records source adaptations.
Preparation/CocoaPods verify [pinned resources](../../apps/field-guide/scripts/kokoro-models.json) into `ios/KokoroResources`, including model, voice, pronunciation/G2P resources and notices.
Installed English output reads those bundled files.

| Area | Behaviour |
| --- | --- |
| Kokoro | Serial sentence synthesis, retaining the playing sentence and one following sentence |
| Apple fallback | Other locales or Kokoro synthesis/playback failure; rejects without a suitable installed voice |
| Shared audio graph | Engine and interruption/configuration-loss observers; pending synthesis/playback cancels on loss |
| Echo | Kokoro shares the voice-processed microphone graph; Apple playback requires caller-side filtering |
| Scheduling | Conversation/playback/callbacks on main; level processing and conversion on the audio tap |
| Android | Native input/output/model adapters, frontend and resource packaging required |

Swift harnesses use controlled recognition/audio adapters for cancellation, settlement, loss and restart.
Acoustic echo, model quality and hardware interruptions remain [device acceptance](../../TASKS.md).
