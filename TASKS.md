# Tasks

Checked items record implementation or the stated experiment, not physical acceptance of every [requirement](REQUIREMENTS.md).

## Implemented

- [x] Capture 124 photos, recover COLMAP poses and train locally with Brush.
- [x] Mark eight parts across 43 keyframes, propagate masks on Modal and lift part labels.
- [x] Bind capture/training/annotation identities, retain saved-mask revisions and verify publication with the app parser.
- [x] Export about 2.5M splats, cropping cloud/labels together, levelling with photo gravity and estimating scale from the battery.
- [x] Import/prune SplatKit, retain its license, and build C++/Metal for iOS.
- [x] Run the Nitro mount/worklet/callback spike on the simulator; implement picking, highlight, orbit/pinch and framing.
- [x] Implement session rules, command routing and interface tests, plus cards, tour and 15 maintenance steps.
- [x] Prepare pinned pack/speech resources and a reusable source-fingerprinted engine; install CocoaPods through Bundler.
- [x] Bundle the pack with native digest/count validation; implement ordered progress with Stop/Finish clearing and Explore preservation.
- [x] Isolate viewer readiness, gestures, framing and projected markers in the viewport module; implement iPad/iPhone layouts.
- [x] Implement complete instructor turns, shared authored evidence/cautions and Claude/Apple/scripted fallback; keep streaming provisional.
- [x] Implement reading mode and continuous native conversations with Kokoro/Apple output.
- [x] Integrate the provisional AR reference, four landmarks, tracking HUD and typed actual torch/telemetry events.
- [x] Record initial Standard/Upright training and the replacement Standard/Front reference's integrity checks.
- [x] Write the human entry points, operational agent guide, glossary, current ADRs, research index and provenance.

## Acceptance and publication

- [ ] Owner corrects or verifies fuse-box/battery masks: the recorded fuse-box held-out IoU is 0.53 and battery picks can select it (R6).
- [ ] Review every highlighted part against the physical engine and confirm metric dimensions (R7).
- [ ] Review content against the correct manual and confirm reservoir markings (R11, R12, R16).
- [ ] Repeat Nitro stress, pinch, all part picks and every procedure on physical hardware (R5, R6, R12-R14).
- [ ] Measure iPhone frame rate, idle drawing, load time, memory and thermal behaviour; shrink the tier if needed (R10).
- [ ] Check voice commands, interruption/echo, pronunciation, latency, model fallback, cautions and Stop/Finish/Explore continuation behaviour on device (R14-R17).
- [ ] Run the prepared-device airplane-mode checklist and separately check fresh-device missing-assets behaviour (R18).
- [ ] Validate latest-reference recognition on the real engine, then measure landmark alignment, drift, recovery and torch behaviour.
- [ ] Decide the semantic camera-overlay renderer after AR alignment passes.
- [ ] Fill the release repository constant, upload the archive/checksum and verify the published clean-clone quickstart (R21).
- [ ] Copy only published runtime pack files into the app, excluding `.sources` and release archives.
- [ ] Bundle engine/SPZ/zstd and Geist license notices in the distributed app.
- [ ] Record the video and deliver TestFlight (R19, R20).

First-launch pack installation and downloaded updates are deferred; model tools and push-to-talk were replaced by text replies and continuous voice.
[Research](docs/research/README.md) distinguishes historical tests from current proposals.
