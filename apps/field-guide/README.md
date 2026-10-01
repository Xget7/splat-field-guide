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

## TestFlight

The app record is `dev.splatfieldguide.app` on team `R2NGS9RVQ9`; Xcode must be signed in to an account on that team.

```sh
scripts/testflight.sh
```

It archives a Release build numbered by the UTC date and time and uploads it to App Store Connect.
`--no-upload` stops at an exported `.ipa` in `ios/build/testflight/`.

The icon is drawn by `swift scripts/app_icon.swift ios/FieldGuide/Images.xcassets/AppIcon.appiconset/AppIcon.png`.
