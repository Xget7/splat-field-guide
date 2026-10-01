# Field guide app

Bare React Native 0.87 ([ADR 0011](../../docs/adr/0011-bare-react-native-with-expo-modules.md)).

```sh
npm install && (cd ios && bundle install && bundle exec pod install)
npm test && npm run lint && npm run typecheck
npm run ios
```

## Source structure

`App.tsx` preserves the React Native entry point and forwards to `src/app/App.tsx`.
Source files are grouped by responsibility and by the functionality they belong to:

```text
src/
  app/                 App composition, root navigation and startup errors
  domain/              Pack parsing, session rules, tours, highlight and framing
  features/
    library/           Guide discovery and continuing a session
    guide-detail/      Equipment details and learning-mode selection
    viewer/            Splat interaction and guided sessions
    ar/                Camera alignment checks
  modules/
    catalog/           Guide metadata and its React context
    packs/             Bundled manifest and native resource paths
    procedures/        Procedure rows shared by detail and viewer
    progress/          Validated progress records and storage
    instructor/        Scripted guidance, model orchestration, adapters and voice
  shared/
    hooks/             General UI hooks
    navigation/        Serializable route contracts
    ui/                Theme, readouts and UI primitives
```

Features keep their screens, components, hooks and presentation models together.
Create those subfolders when they contain code; a new feature does not need every layer.
Reusable equipment behavior belongs in `modules`, while UI primitives without equipment
knowledge belong in `shared`. Features use modules rather than importing another feature.

Dependencies flow from `app` to features and modules; features use modules, domain and
shared code. Modules can use domain and shared code, but cannot import feature screens
or app composition. The domain has no React or native dependencies, and shared code
has no business dependencies. ESLint enforces these layer restrictions for production code.

Within the instructor, `domain` holds commands, grounding and the `InstructorModel`
interface. `application/modelInstructor` exports `createModelInstructor`, which receives
an ordered list of models, owns request cancellation, and falls back to scripted guidance. Native and network
implementations live in `data`; `data/defaultInstructor` composes the app's defaults.
Another implementation can satisfy `InstructorModel` without changing the orchestrator.
Voice presentation and recognition vocabulary remain separate from the native voice hook.

The viewer's `useViewerSession` owns session transitions, questions, speech and saved
progress. Its screen composes the layout and handles the native viewport. This follows
React's guidance to use [focused custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks).
Progress parsing is pure; only `modules/progress/data/progressStorage` uses AsyncStorage,
with the existing storage key and record format.

Import implementations directly rather than through barrel files. App tests live outside
`apps/`, in [`tests/field-guide`](../../tests/field-guide), grouped by domain, feature and
module. That directory also contains the app smoke test, fixtures and native mocks.
Jest discovers `*.test.ts` and `*.test.tsx` there through the app's `jest.config.js`.
The external tests reuse the app's dependencies and Babel configuration.

From this app directory, run `npm test -- --runInBand`, `npm run lint` and
`npm run typecheck`. These commands validate the app and its external test suite.
Tests run in an iPhone-sized window; a test that needs the iPad layout sets a wider one.

## iPad

The iPad is the main demo device, in either orientation; the iPhone stays portrait only.
Any window at least 700 points wide (`useWideLayout`) lays content out side by side.
The viewer keeps the splat on the left and a sidebar on the right: every step of the procedure, then the instructor or step panel docked under it.
Any step in the list opens directly; steps before the current one are marked as earlier, not done, since a step jumped over was never carried out.
The library shows the ready guide as a wide card and four guides to a row.
The guide detail puts the photo beside its choices in landscape and keeps the phone's stacked layout, with a taller photo, upright.

## Instructor voice

The instructor has two modes and nothing in between.
Reading is the default, because reading is faster than listening: answers and steps appear as text, questions are typed, and nothing is said aloud or heard.
The waves button next to the text field turns on voice, which reads every step and answer aloud and listens all the time, so the user can ask, say "next", "repeat" or "back", and talk over an answer to cut it short.
In voice the text field becomes a voice bar with the live status and level, a close button that returns to reading, and a mute button.

English speech uses Kokoro-82M v1.0 with the `af_heart` voice through ONNX Runtime 1.30.0 on CPU.
Apple speech remains the automatic fallback for other locales and for model or playback failures.
The [research comparison](../../docs/research/09-kokoro-tts.md) covers the engine, voice and license choices.

`pod install` runs `scripts/fetch-kokoro-models.py` before evaluating the native podspec.
It fetches pinned Hugging Face revisions, verifies each file against `scripts/kokoro-models.json`, and prepares `packages/react-native-on-device/ios/KokoroResources/`.
CocoaPods bundles the model, one voice, the English lexicon, the small G2P models and the license notices into the app, so the installed app never downloads a model.
The verified binaries are gitignored, so a clean checkout needs network access once.

The output warms on its own queue when voice turns on, plays each sentence while it synthesizes the next, and aborts inference when speech stops.
Word ranges stay UTF-16 indices in the original reply; their timing is estimated from word length and the audio sample clock, because this export has no word timestamps.
Debug builds log `model_warm_ms`, `synth_ms`, `rtf` and `first_audio_ms` under the `dev.splatfieldguide.ondevice` subsystem, and `scripts/kokoro-smoke-test.js` exercises the native interface from the Metro debugger.

### Speech recognition

Questions are transcribed on the device with `SpeechAnalyzer` and `SpeechTranscriber` (iOS 26), the model behind Notes and Voice Memos, which handles accented English far better than `SFSpeechRecognizer`.
Devices without `SpeechTranscriber` fall back to `DictationTranscriber`, and part names and aliases are passed as contextual strings.
The model is not bundled: `prepare` installs it through `AssetInventory` the first time voice turns on, so that needs network once and every later use works offline.

### Listening

In voice the microphone stays open and each spoken turn is asked after a one-second pause, and a line under the answer says which commands can be spoken.
One transcription runs for the whole conversation; a turn ends after the pause and results for audio before it are dropped.
Kokoro plays through the same `AVAudioEngine` that listens, with voice processing on, so echo cancellation removes the instructor's own voice and the user can talk over an answer to cut it short.
Words that are all ones the instructor is saying are treated as leaked echo and never interrupt it; Apple speech, the fallback, plays outside that engine and relies on this check alone.

## TestFlight

The app record is `dev.splatfieldguide.app` on team `R2NGS9RVQ9`; Xcode must be signed in to an account on that team.

```sh
scripts/testflight.sh
```

It archives a Release build numbered by the UTC date and time and uploads it to App Store Connect.
`--no-upload` stops at an exported `.ipa` in `ios/build/testflight/`.

The icon is drawn by `swift scripts/app_icon.swift ios/FieldGuide/Images.xcassets/AppIcon.appiconset/AppIcon.png`.
