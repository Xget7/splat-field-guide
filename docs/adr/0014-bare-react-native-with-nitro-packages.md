# Bare React Native with local Nitro packages

Status: accepted.

Native speech/audio coordination requires control beyond the proposed Expo wrappers in [ADR 0011](0011-bare-react-native-with-expo-modules.md).

Use bare React Native 0.87 and local Nitro packages for the viewer, speech and Apple generation.

- Preparation builds a source-fingerprinted engine before CocoaPods vendors it.
- Matching frameworks are reused; stale sources or --force rebuild, and the podspec directs mismatches to scripts/prepare.sh.
- Track generated Nitro outputs; only iOS adapters are implemented.
