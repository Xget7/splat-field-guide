# Field Guide app

Bare React Native 0.87 with local Nitro packages, as recorded in [ADR 0014](../../docs/adr/0014-bare-react-native-with-nitro-packages.md).
The iPad is the main demo layout; the iPhone stays portrait.

## Setup

| Requirement | What to prepare |
| --- | --- |
| Build machine | Apple silicon Mac, Xcode 27 and selected command-line tools |
| Tools | Node.js 26+, npm, CMake, Python 3.12+, Ruby and Bundler; CocoaPods from the Gemfile |
| Viewer | iOS/iPadOS 26+, Metal on an A14-class GPU or later |
| Pack | Local demo archive or `FIELD_GUIDE_PACK_URL` until the public release exists |
| English speech output | About 100 MiB of pinned Kokoro, voice and frontend resources fetched during preparation |
| Transcription | System assets may need a first-use download when voice turns on |
| Offline free questions | Eligible Apple Intelligence hardware, enabled settings, supported language and a ready model |
| Provisional AR | Physical iPhone on iOS 27, separately trained `.referenceobject`; recognition remains unvalidated |

From the repository root, with network available for dependencies and speech resources:

```sh
nice -n 19 scripts/prepare.sh --pack /path/to/gol-trend-engine-bay-1.tar.gz
cd apps/field-guide
nice -n 19 npm run ios
# Select an installed simulator when needed:
nice -n 19 npm run ios -- --simulator "iPhone 17 Pro"
```

Preparation verifies the pack, builds or reuses the source-fingerprinted XCFramework, prepares Kokoro, installs JS dependencies and installs Ruby dependencies from the app Gemfile before running `bundle exec pod install`.
Rerun it after changing engine sources; the podspec rejects stale frameworks, and the [engine builder](../../packages/react-native-splat/README.md#engine-preparation) accepts `--force`.
The [root quickstart](../../README.md#quickstart) covers pack acquisition; the default release is `gol-trend-engine-bay-1.tar.gz` under `pack-gol-trend-engine-bay-1`, with repository owner/name filled in `scripts/prepare.sh` when publishing.
The CLI starts Metro; for Xcode, run `npm start` here and open `ios/FieldGuide.xcworkspace` with the FieldGuide scheme.

For your own device, choose a team and provisionable bundle identifier in Xcode's Signing & Capabilities.
For command-line signing, pass `DEVELOPMENT_TEAM="$FIELD_GUIDE_TEAM_ID"` to xcodebuild; the distribution helper requires `FIELD_GUIDE_TEAM_ID` as ten uppercase letters/digits and a signed-in Xcode account.
Debug needs reachable Metro; Release embeds JS.
`scripts/testflight.sh` is the author's distribution helper, and delivered TestFlight acceptance remains open in [TASKS.md](../../TASKS.md).

## Runtime facts

| Module | Behaviour |
| --- | --- |
| Packs | Build-time resources; app parses schema 1 and optional `sources`; native loader verifies digests/count before accepting cloud/labels |
| Instructor | Commands first, then Claude through the Worker, Apple on device and scripted fallback |
| Turns | Instructor owns `ask`/`cancel`/`prewarm`; streamed words and part emphasis provisional, accepted final answers commit session actions |
| Evidence | Shared resolved part/procedure evidence including cautions; heuristic numerical guards use relevant evidence only |
| Remote configuration | [cloudModel.ts](src/instructor/models/cloudModel.ts) exports `INSTRUCTOR_PROXY_URL`; set it to your Worker URL or `null` for offline-only guidance |
| Remote completion | Proxy errors, incomplete stop reasons, empty answers and missing successful done trigger fallback |
| Continuation | Procedure Stop/Finish clear saved progress; Explore preserves the guide position; ordered storage writes prevent an older save restoring cleared progress |
| Viewport | `modules/viewport` owns native readiness, picking, camera conversion, framing and projected markers; viewer session owns guidance |
| Reading | Text steps/answers and typed questions, without microphone or playback |
| Voice | Continuous listening, spoken steps/answers and interruption; a 0.7-second acoustic pause precedes transcription settlement |
| Speech output | Kokoro-82M v1.0, `af_heart`, ONNX Runtime 1.30.0 CPU; Apple speech fallback |
| Speech input | Apple SpeechAnalyzer/SpeechTranscriber, DictationTranscriber fallback and part-name hints |
| Playback echo | Voice-processing audio graph for Kokoro; Apple fallback relies on caller-side word filtering |
| Tablet | Side-by-side viewer at 700+ points; earlier steps mean earlier, not completed |
| AR | Separate four-landmark check; typed recognition/telemetry/actual torch events, pending physical alignment and semantic masks |

Before airplane-mode voice testing, turn voice on while connected, allow microphone/speech permissions and finish system asset preparation.
Enable Apple Intelligence on an [eligible device](https://support.apple.com/en-us/121115) and wait for model readiness.
Missing transcription assets prevent fresh-device offline voice; unavailable Apple generation falls back to scripted guidance.
Physical echo, interruption, latency, sustained frame rate and AR alignment remain device checks.

See the [speech package](../../packages/react-native-on-device/README.md) for resource verification, estimated word timing and audio ownership, the [proxy setup](../../services/instructor-proxy/README.md), and the [AR audit](../../docs/research/10-object-tracking-training-audit.md).
The AR copy phase includes `data/ar-reference/gol-trend-engine-bay/engine-bay.referenceobject` only when present; the viewer pack preparation does not supply it.

## Development

See [AGENTS.md](../../AGENTS.md) for the source map, dependency rules, exact checks and Nitro regeneration commands.
App tests live in [apps/field-guide/src](../../apps/field-guide/src/) and use native/model fakes; simulator results do not establish physical acceptance.
