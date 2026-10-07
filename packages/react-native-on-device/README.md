# react-native-on-device

Lazy Nitro modules provide speech input/output, raw conversation audio and network path monitoring on iOS and Android, with Apple Foundation Models on iOS.
[App setup](../../apps/field-guide/README.md#device-preparation) covers system assets; [AGENTS.md](../../AGENTS.md#prepare-and-verify) has installation, checks and codegen commands.

## Interfaces

Importing the package creates no native object; `speechInput()`, `speechOutput()`, `languageModel()`, `audioLink()` and `networkMonitor()` instantiate on first use.

| Interface | Contract |
| --- | --- |
| [SpeechInput](src/SpeechInput.nitro.ts) | Permission, awaited `prepare(locale)` and continuous `listen`; platform recognition with contextual hints |
| Input callbacks | Partial text, settled nonempty `onTurn`, acoustic `onVoice`, smoothed 0-1 `onLevel` capped at 30 Hz, and one `onStopped` on spontaneous loss |
| iOS turn boundary | 0.7 seconds of acoustic quiet, then 0.15 seconds of settlement bounded by 1.5 seconds; continuous speech bounded to 20 seconds |
| Input cancellation | Discard the current turn, reject stale callbacks and allow restart; concurrent listening/missing permission rejects |
| [SpeechOutput](src/SpeechOutput.nitro.ts) | `speak` replaces output and resolves on completion/stop; `stop` cancels synthesis, playback and callbacks |
| Output voice | `speak` takes `kokoro` or `system` after `onWord`; awaited `prepare(voice)` returns the voice actually ready, with system fallback when Kokoro cannot run |
| [AudioLink](src/AudioLink.nitro.ts) | Microphone and queued playback with echo cancellation; base64 little-endian PCM16 mono, 100 ms input chunks, levels and one stop callback on audio loss |
| Link playback | `clear` discards queued/playing audio and resets `playedMs`; `stop` releases the microphone for speech input |
| [NetworkMonitor](src/NetworkMonitor.nitro.ts) | One replaceable listener, current route then changes; satisfaction, transport, cost, constraint, bandwidth and signal where known |
| Output callbacks | Original UTF-16 ranges from Kokoro estimates or platform speech timing |
| [LanguageModel](src/LanguageModel.nitro.ts) | Availability, prewarm, streaming/final respond and cancel; equipment evidence/policy belongs to the app instructor |

## Android

[Speech input](android/src/main/java/com/margelo/nitro/ondevice/HybridSpeechInput.kt) uses `android.speech.SpeechRecognizer`, preferring on-device recognition when available and requesting offline recognition from the system service otherwise.
`prepare(locale)` checks installed language support where the API permits and requests model preparation; unavailable assets remain unavailable until ready.
Recognition-service results settle turns, and listening restarts after each completed turn while preserving the shared callback and cancellation contract.
Microphone permission is required, and a service's offline request does not guarantee offline availability.
[Speech output](android/src/main/java/com/margelo/nitro/ondevice/HybridSpeechOutput.kt) uses `android.speech.tts.TextToSpeech` with an installed voice that requires no network, bounded text chunks and UTF-16 range callbacks.
`prepare` waits for the TTS engine and returns `system` for either requested voice.
[Raw audio](android/src/main/java/com/margelo/nitro/ondevice/HybridAudioLink.kt) uses voice-communication AudioRecord/AudioTrack with available echo/noise effects and ends on audio focus loss.
[Network paths](android/src/main/java/com/margelo/nitro/ondevice/HybridNetworkMonitor.kt) require a validated internet route and report bandwidth and signal when available.
System TTS timing and echo depend on the installed engine and require physical acceptance.
Android generation reports unavailable, so the instructor follows the [ordered fallback](../../docs/adr/0006-commands-and-ordered-instructor-fallback.md) through Claude and scripted guidance.

## iOS resources and audio

SpeechTranscriber/DictationTranscriber provide input with contextual hints.
[Raw audio](ios/HybridAudioLink.swift) shares the voice-processed graph and converts between negotiated PCM rates and the 24 kHz playback format.
[Network paths](ios/HybridNetworkMonitor.swift) use NWPathMonitor; bandwidth and signal are always unknown (-1).
Kokoro, its resource/frontend bundle and Apple generation are iOS-only.

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

Swift harnesses use controlled recognition/audio adapters for cancellation, settlement, loss and restart.
Acoustic echo, model quality and hardware interruptions remain [device acceptance](../../TASKS.md).
