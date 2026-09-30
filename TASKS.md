# Tasks

Apple first; each task names the requirements it serves ([REQUIREMENTS.md](REQUIREMENTS.md)).

## Pipeline

- [x] Capture, COLMAP poses and a 2.7M-splat training run.
- [x] Marking page with SAM 3 on Modal.
- [x] Engine marked, tracked and lifted onto the splat.
- [x] Owner marks the other seven parts on the marking page (R2, R3): 43 keyframes in all.
- [ ] Owner re-marks the fuse box and the battery: the fuse box tracks worst (held-out IoU 0.53) and takes battery splats, so a tap on the battery can pick the fuse box (R3, R6).
- [x] Track each part from its own marked photos (R2, R3).
- [x] Lift every part at once, a child's splats counted for its parent (R3, R8).
- [ ] Retrain capped at 1.5M splats and lift again on that cloud (R10), if the iPhone misses 60 fps with the 2.5M-splat pack.
- [x] Export SPZ and `labels.bin` in SPZ order, levelled with the photos' gravity, orbit limits from the photos (R6).
- [x] Final export with every part, scaled from the battery (R6).
- [ ] Review render of each part highlighted (R7).

## Engine and library

- [x] Import SplatKit at a recorded commit, then prune it (R4).
- [x] Build the core and the Metal backend for iOS (R4); run in the simulator only.
- [x] Nitro spike on React Native 0.87: mount, worklet call, render-thread callback (R4, R5); iOS simulator only, the iPhone run is pending.
- [x] Labels carried through Morton order and checked against the cloud (R6).
- [x] Highlight table in the Metal shaders (R7, R8); checked on the real pack with `splat_snapshot` on a Mac.
- [x] Pick by ray against splat ellipsoids (R6); every tour part picked at its anchor in the simulator, except the battery (see the fuse box above).
- [x] Animated framing and orbit limits, azimuth included (R9).
- [ ] `<SplatView>` with orbit and pinch from gesture worklets (R5); a real one-finger swipe orbits in the simulator, pinch is not checked yet.
- [ ] 60 fps orbit and no idle frames on the iPhone (R10).

## App

- [x] Bare React Native 0.87 app with the iOS project building (R4).
- [x] Session reducer, highlight and framing derivation, with tests (R8, R13).
- [ ] Command router, with tests (R14).
- [ ] Bundled pack installed and verified on first launch (R18).
- [x] Part card (R11); a real tap on the coolant reservoir selects it and the card shows its name and explanation, simulator.
- [x] Parts tour: a stepper that frames each part whole and highlights it, left to right (R13); simulator.
- [x] Procedure player (R12, R13, R14): picked from a sheet, all 15 steps frame their parts whole and pick them at the anchor, next, back and repeat by button; simulator. Voice comes with the command router.
- [ ] Parts and procedures content, checked against the owner's manual (R11, R12).
- [ ] Apple Foundation Models instructor with tools (R15, R16, R17).
- [ ] On-device speech in and out, push-to-talk (R14, R15).

## Delivery

- [ ] On-device checklist on the iPhone in airplane mode (R18).
- [ ] Video (R19).
- [ ] TestFlight upload (R20).
- [ ] README, ARCHITECTURE and PROVENANCE (R21).
