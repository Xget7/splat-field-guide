# Tasks

Apple first; each task names the requirements it serves ([REQUIREMENTS.md](REQUIREMENTS.md)).

## Pipeline

- [x] Capture, COLMAP poses and a 2.7M-splat training run.
- [x] Marking page with SAM 3 on Modal.
- [x] Engine marked, tracked and lifted onto the splat.
- [ ] Owner marks the other seven parts on the marking page (R2, R3).
- [ ] Track each part from its own marked photos (R2, R3).
- [ ] Lift every part at once, a child's splats counted for its parent (R3, R8).
- [ ] Retrain capped at 1.5M splats and lift again on that cloud (R10).
- [ ] Export SPZ and `labels.bin` in SPZ order (R6).
- [ ] Review render of each part highlighted (R7).

## Engine and library

- [x] Import SplatKit at a recorded commit, then prune it (R4).
- [ ] Build the core and the Metal backend for iOS (R4).
- [x] Nitro spike on React Native 0.87: mount, worklet call, render-thread callback (R4, R5); iOS simulator only, the iPhone run is pending.
- [ ] Labels carried through Morton order and checked against the cloud (R6).
- [ ] Highlight table in the Metal shaders (R7, R8).
- [ ] Pick by ray against splat ellipsoids (R6).
- [ ] Animated framing (R9).
- [ ] `<SplatView>` with orbit and pinch from gesture worklets (R5).
- [ ] 60 fps orbit and no idle frames on the iPhone (R10).

## App

- [ ] Bare React Native 0.87 app with the iOS project building (R4).
- [ ] Session reducer, highlight and framing derivation, with tests (R8, R13).
- [ ] Command router, with tests (R14).
- [ ] Bundled pack installed and verified on first launch (R18).
- [ ] Part card (R11).
- [ ] Procedure player (R12, R13, R14).
- [ ] Parts and procedures content, checked against the owner's manual (R11, R12).
- [ ] Apple Foundation Models instructor with tools (R15, R16, R17).
- [ ] On-device speech in and out, push-to-talk (R14, R15).

## Delivery

- [ ] On-device checklist on the iPhone in airplane mode (R18).
- [ ] Video (R19).
- [ ] TestFlight upload (R20).
- [ ] README, ARCHITECTURE and PROVENANCE (R21).
