# Requirements

iOS is the implemented target, with an iPad-first layout and physical acceptance on iPhone 17 Pro.
These requirements are targets; [TASKS.md](TASKS.md) records evidence and remaining checks.

## Equipment and viewer

- R1. One ready pack: the 2010 VW Gol Trend 1.6 engine bay.
- R2. Six top-level parts: coolant, power steering and brake fluid reservoirs, battery, fuse box and engine.
- R3. Valve cover and intake manifold are children of the engine.
- R4. Metal renders inside React Native on iOS/iPadOS 26+.
- R5. One finger orbits and pinch zooms.
- R6. Picking selects a part; empty space clears selection.
- R7. Selected parts use marine blue (#0A6CFF), with the rest slightly dimmed.
- R8. A parent's highlight includes its children.
- R9. Animated framing fits the highlighted parts.
- R10. The acceptance iPhone sustains 60 fps while orbiting and draws no unchanged idle frames.

The original budget was 1.5M splats; the current high tier has about 2.5M before filtering and needs device measurement or a smaller export.

## Guidance and instructor

- R11. The part card gives its name and explanation.
- R12. Three procedures check coolant, brake fluid and power steering fluid, alongside the parts tour.
- R13. Steps highlight and frame their parts.
- R14. Next/back/repeat work by voice and button; stop/finish clear continuation, while exploration preserves it.
- R15. Questions prefer Claude online, then Apple Foundation Models on a prepared eligible device, then scripted guidance.
- R16. Answers use pack evidence and relevant cautions, declining unsupported specifications.
- R17. Commands and validated text replies use the session actions to show parts or advance guidance.

Grounding guards are heuristics; physical acceptance includes checking answers against their evidence.
Reading accepts typed questions; voice listens continuously and permits interruption.

## Offline and delivery

- R18. Bundled viewer, procedures and English output work offline; offline voice and Apple answers pass after system assets are prepared.
- R19. A 60 to 90 second iPhone video demonstrates airplane-mode use after preparation.
- R20. A TestFlight build is delivered.
- R21. The public repository has reproducible preparation, current docs, decisions and provenance.

Fresh-device offline transcription remains unmet when system assets require downloading.
AR is a provisional iPhone iOS 27 four-landmark check; physical recognition and full camera masks are not accepted completed features.
Android, downloaded pack updates and progress sync remain future work.
