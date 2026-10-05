# react-native-on-device

Three lazy Nitro modules for local language generation, continuous speech recognition and speech playback.
Only iOS implementations exist today, and the app requires iOS 26.
Importing the package does not instantiate the native modules.
`speechInput()`, `speechOutput()` and `languageModel()` create their native objects on first use.

## Preparation

From the repository root, run `scripts/prepare.sh` before building the app.
The existing speech-resource mechanism is also callable from the app directory:

```sh
python3 scripts/fetch-kokoro-models.py
python3 scripts/fetch-kokoro-models.py --verify-only
```

The fetch command verifies pinned SHA-256 values and installs the bundled Kokoro model, English voice, pronunciation data and compiled Core ML grapheme-to-phoneme models.
CocoaPods invokes the same verification/fetch mechanism before it enumerates resources.
The first resource fetch needs a network, macOS and the Xcode tools used to compile Core ML resources.
`--verify-only` checks existing files without fetching them.
The pod also links CPU ONNX Runtime.
Generated resources live in `ios/KokoroResources` and are excluded from git.
The adapted English frontend and its licensing are described in [KokoroFrontend/README.md](ios/KokoroFrontend/README.md).

## Speech input

Call `requestPermission`, then await `prepare(locale)` before calling `listen`.
`prepare` may download Apple's recognition assets on first use; first-launch airplane-mode recognition is not guaranteed on a device missing those assets.
Later listening uses the on-device SpeechAnalyzer model, choosing SpeechTranscriber where available and DictationTranscriber otherwise.
Unsupported locales report unavailability.

`listen` opens one microphone and continuously reports partial transcripts, completed turns, bounded level updates, voice transitions and spontaneous stops.
Contextual hints favour words such as part names.
The conversation module owns turn completion and rejects callbacks from cancelled or replaced listening.
It keeps the background estimate stable during speech, so a sustained question cannot raise its own silence threshold.
A quiet interval of at least 0.7 seconds ends an acoustic turn, with smoothing and recognition settlement adding delay.
Settlement allows 0.15 seconds for queued results and is bounded by 1.5 seconds.
A continuous voice is bounded to 20 seconds per turn.
`onLevel` reports smoothed values from zero to one, at most 30 times a second.
`onVoice` reports the acoustic transitions; `onTurn` follows recognition settlement and omits empty turns.

`listen` rejects concurrent listening or missing permission and resolves once the microphone starts.
Audio interruption, engine configuration loss or recognition ending stops listening and reports `onStopped` once.
`cancel` discards the current turn without a spontaneous-stop callback and is safe when idle.
Listening can be restarted after either path.

## Speech output and audio ownership

`speak` stops the previous utterance, speaks the supplied text and resolves when it completes or is stopped.
English uses the bundled Kokoro model on a serial worker, retaining at most the playing sentence and one following sentence.
Other locales, model failure and synthesis/playback failure use an installed Apple voice.
If no suitable fallback voice exists, speaking rejects.
`stop` cancels synthesis, playback and queued word callbacks immediately and is safe when silent.

`onWord` reports ranges in the original text using UTF-16 offsets.
Kokoro estimates each start from word length and the sentence's audio duration, following the player's sample timeline.
Those timings are approximate; Apple fallback supplies its own callbacks.

The shared audio graph owns the engine and system interruption/configuration observers.
It tells listening and playback when audio is lost, including pending synthesis and Apple fallback.
Kokoro playback shares the voice-processed microphone graph so echo cancellation has a playback reference.
Apple fallback runs outside that graph and still requires caller-side echo filtering.
Starting or closing a microphone replaces the graph as needed and interrupts ongoing shared-engine playback.
Conversation lifecycle, playback and callbacks run on main; only microphone level processing and buffer conversion run on the audio tap.

## Language model

`availability` reports whether Apple Foundation Models can run on this device, including eligibility and readiness limits.
`respond` streams partial text and resolves the final answer; `cancel` rejects an active generation.
`prewarm` prepares a session for the same grounding instructions.
The package provides execution, not equipment grounding or session policy; those remain in the app's instructor module.
Foundation Models require supported hardware and prepared Apple Intelligence resources.
No language model runs on Android through this package.

## Checks and regeneration

From this package, run:

```sh
npm test -- --runInBand
npm run lint
npm run typecheck
npm run codegen
```

On macOS 26 or later, the existing Jest suite compiles the real `SpeechTextPlan.swift`, `OnDeviceAudioLevel.swift` and `OnDeviceConversation.swift`, `OnDeviceAudioGraph.swift` and `HybridSpeechOutput.swift` into small harnesses.
Controlled audio and recognition adapters exercise sustained speech, turn completion, cancellation, audio loss, stale-result rejection and restart without a microphone, model download or paid call.
These harnesses run through `npm test`; the macOS-only checks skip on other hosts.
They do not establish acoustic echo cancellation, model quality or physical-device interruption handling.
After a spec change, regenerate and commit `nitrogen/generated`, then run `pod install` in `apps/field-guide/ios`.

## Android port

The existing Android app is a scaffold, and these native modules register iOS implementations only.

| Android area | Required work and reusable contract |
| --- | --- |
| Local instructor | Supply an Android local-model adapter or report unavailability; Apple Foundation Models is not portable; app grounding and session policy can remain. |
| Recognition | Add microphone permission, offline locale preparation, contextual hints, continuous input, partial transcripts, complete turns, voice transitions, bounded levels, cancellation and spontaneous-stop reporting behind `SpeechInput`. |
| Playback | Add speech playback, original UTF-16 word ranges, immediate cancellation and fallback behind `SpeechOutput`; Kokoro's ONNX model and voice are portable, but the Swift English frontend and compiled Core ML pronunciation models need replacement or an Android implementation. |
| Resources | Deliver speech resources on Android and resolve their native paths instead of using the Apple bundle. |

An Android port is deferred.
