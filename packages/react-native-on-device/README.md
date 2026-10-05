# react-native-on-device

Lazy iOS Nitro modules for speech input, speech output and Apple Foundation Models.
Read [app setup](../../apps/field-guide/README.md) for device preparation and [AGENTS.md](../../AGENTS.md#prepare-and-verify) for dependency installation, tests, lint, types and codegen.

## Interfaces

Importing the package creates no native object; `speechInput()`, `speechOutput()` and `languageModel()` instantiate on first use.

| Interface | Contract |
| --- | --- |
| [SpeechInput](src/SpeechInput.nitro.ts) | Request permission, await `prepare(locale)`, then `listen`; on-device SpeechTranscriber or DictationTranscriber, contextual hints and continuous turns |
| Input callbacks | Partial text, settled nonempty `onTurn`, acoustic `onVoice`, smoothed 0-1 `onLevel` capped at 30 Hz, and one `onStopped` on spontaneous loss |
| Turn boundary | At least 0.7 seconds of acoustic quiet, then recognition settlement: 0.15 seconds for queued results, bounded by 1.5 seconds; continuous speech bounded to 20 seconds |
| Input cancellation | `cancel` discards the current turn, rejects stale callbacks and permits restart; concurrent listening or missing permission rejects |
| [SpeechOutput](src/SpeechOutput.nitro.ts) | `speak` replaces previous output and resolves on completion/stop; `stop` cancels synthesis, playback and queued callbacks |
| Output callbacks | Original UTF-16 word ranges; Kokoro starts estimated from word length and sentence duration, Apple supplies its own timing |
| [LanguageModel](src/LanguageModel.nitro.ts) | `availability`, `prewarm`, streaming `respond` with final answer, and `cancel`; equipment evidence/policy owned by the app instructor |

First-use recognition preparation may download system assets; Apple generation needs eligible hardware and ready Apple Intelligence resources.
See [ADR 0015](../../docs/adr/0015-kokoro-with-vendored-english-frontend.md) for Kokoro and the [frontend README](ios/KokoroFrontend/README.md) for adaptations/licenses.

## Resources and audio

From `apps/field-guide`, the pinned fetch used by preparation/CocoaPods is:

```sh
python3 scripts/fetch-kokoro-models.py
python3 scripts/fetch-kokoro-models.py --verify-only
```

Generated `ios/KokoroResources` holds verified model, voice, pronunciation/G2P resources and notices; installed English output uses those bundled files with CPU ONNX Runtime.

| Area | Behaviour |
| --- | --- |
| Kokoro | Serial sentence synthesis, retaining the playing sentence and one following sentence |
| Apple fallback | Other locales or Kokoro synthesis/playback failure; rejects when no suitable installed voice exists |
| Shared audio graph | Owns engine and interruption/configuration-loss observers; cancels pending synthesis/playback on loss |
| Echo | Kokoro playback shares the voice-processed microphone graph; Apple playback requires caller-side echo filtering |
| Scheduling | Conversation, playback and callbacks on main; level processing and buffer conversion on the audio tap |
| Android | Native input/output/model adapters, frontend and resource packaging required |

On macOS 26+, Jest compiles Swift harnesses with controlled recognition/audio adapters to check sustained speech, cancellation, settlement, audio loss and restart.
These checks skip on other hosts and leave acoustic echo, model quality and hardware interruption handling to [device acceptance](../../TASKS.md).
