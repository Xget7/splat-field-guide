# Open work

These items require the inputs or hardware listed below; source and simulator checks do not establish physical acceptance.
Requirement IDs refer to [REQUIREMENTS.md](REQUIREMENTS.md).

- [ ] Verify Android gestures, all picks/procedures, idle drawing, frame/load time, memory and thermal behaviour on physical Vulkan hardware (R4-R10, R12-R14).
- [ ] Verify Android recognition readiness, installed offline TTS, commands, interruption/echo, cancellation and airplane-mode fallback on physical hardware (R14-R18).
- [ ] Verify or correct fuse-box/battery masks using the capture, accepted annotations and the real engine (R6).
- [ ] Review every highlight and verify metric dimensions against the physical engine (R7).
- [ ] Review [authored content qualifications](content/gol-trend-engine-bay/SOURCES.md) against the correct manual and actual reservoir markings (R11, R12, R16).
- [ ] Repeat Nitro mount stress, pinch, all part picks and every procedure on physical hardware (R5, R6, R12-R14).
- [ ] Measure iPhone frame rate, idle drawing, load time, memory and thermal behaviour; reduce the tier if required (R10).
- [ ] Check voice commands, interruption/echo, pronunciation, latency, model fallback, cautions and continuation behaviour on an eligible device (R14-R17).
- [ ] Run prepared-device airplane-mode checks and fresh-device missing-assets checks separately, with system asset readiness recorded (R18).
- [ ] Verify the current AR reference on the real engine, then measure landmark alignment, drift, recovery, negative scenes and actual torch behaviour on an iOS 27 iPhone.
- [ ] Choose the semantic camera-overlay renderer after reference-frame and physical alignment acceptance.
- [ ] Supply `publication.json` and manifest source artifacts to complete capture-backed export verification.
- [ ] Run the full quickstart from a clean clone of the private repository (R21).
- [ ] Record the airplane-mode video and deliver TestFlight with author signing credentials (R19, R20).
