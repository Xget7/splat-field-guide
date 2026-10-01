# Field guide app

Bare React Native 0.87 ([ADR 0011](../../docs/adr/0011-bare-react-native-with-expo-modules.md)).

```sh
npm install && (cd ios && bundle install && bundle exec pod install)
npm test && npm run lint && npm run typecheck
npm run ios
```

## TestFlight

The app record is `dev.splatfieldguide.app` on team `R2NGS9RVQ9`; Xcode must be signed in to an account on that team.

```sh
scripts/testflight.sh
```

It archives a Release build numbered by the UTC date and time and uploads it to App Store Connect.
`--no-upload` stops at an exported `.ipa` in `ios/build/testflight/`.

The icon is drawn by `swift scripts/app_icon.swift ios/FieldGuide/Images.xcassets/AppIcon.appiconset/AppIcon.png`.
