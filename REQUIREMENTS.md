# Requirements

Targets apply to iOS/iPadOS and Android with tablet layouts and physical iPhone acceptance on iPhone 17 Pro.
Android emulator checks establish functionality; physical Android performance and voice acceptance remain open.
[Design](docs/specs/field-guide-design.md) defines behaviour and ownership; [TASKS.md](TASKS.md) lists unmet acceptance and delivery work.

## Equipment and viewer

- R1. Open the bundled 2010 Volkswagen Gol Trend 1.6 engine-bay guide.
- R2. Identify six top-level parts: coolant, power steering and brake fluid reservoirs, battery, fuse box and engine.
- R3. Identify valve cover and intake manifold as children of the engine.
- R4. Render inside React Native with Metal on iOS/iPadOS 26+ and Vulkan on Android 10+.
- R5. Orbit with one finger and zoom with a pinch.
- R6. Pick a part and clear selection when picking empty space.
- R7. Highlight selected parts in marine blue (#0A6CFF), with the rest slightly dimmed.
- R8. Include children in a parent's highlight.
- R9. Animate framing to fit the highlighted parts.
- R10. Sustain 60 fps while orbiting on the acceptance iPhone and draw no unchanged idle frames.

The [tier metadata](content/gol-trend-engine-bay/manifest.json) records the source count; physical performance determines whether a smaller export is needed.

## Guidance and instructor

- R11. Show a selected part's name and explanation.
- R12. Provide coolant, brake fluid and power steering checks alongside the parts tour.
- R13. Highlight and frame the parts for each step.
- R14. Support next/back/repeat by voice and button, with the continuation rules in [design](docs/specs/field-guide-design.md#session-rules).
- R15. Answer free questions with the ordered policy in [ADR 0006](docs/adr/0006-commands-and-ordered-instructor-fallback.md).
- R16. Use authored evidence and cautions, and decline unsupported specifications.
- R17. Route commands and validated answers through session actions.

Grounding guards are heuristic; acceptance includes checking answers against their evidence.
Reading and voice must both support the guidance flow, with interruption in voice mode.

## Offline and delivery

- R18. Open the viewer and procedures and speak English offline; offline input requires prepared system assets, and Apple generation is available only on eligible iOS hardware.
- R19. Deliver a 60-90 second iPhone video demonstrating airplane-mode use after preparation.
- R20. Deliver a TestFlight build.
- R21. Provide reproducible repository preparation, current documentation, decisions and provenance.

## Spatial assembly

- R22. Place the supplied V8 capture on a detected horizontal surface on iOS, with scale and rotation.
- R23. Assemble all 128 parts in 12 steps, install large parts sequentially and repeated fasteners or valve springs together, and support reverse separation and a complete preview that preserves the current step.
- R24. Credit little.bucket and retain CC BY-NC 4.0 attribution in the screen and bundled notices.
- R25. Keep the next action near the bottom in compact native glass controls, hide future parts and reveal only the upcoming part or repeated group after the preceding movement completes or is explicitly skipped.
- R26. Drive automatic assembly with a native state machine and matching playback completion; allow Next during forward assembly to finish the current step immediately and start the following step.
- R27. Start and restart with the crankshaft installed, and allow viewing from below with an initial elevation of 50 centimetres above the detected surface and height controls from zero to two metres.

The V8 is separate from the Gol guide; its visual sequence does not establish mechanical assembly correctness.
Native source checks establish part ordering and transform restoration; physical placement, tracking recovery and visible animation remain unchecked.

Fresh-device offline transcription is unmet when system assets require downloading.
The AR landmark check remains provisional and hidden by default; physical recognition, alignment and full semantic camera masks are open.
The Android emulator verifies the full-tier viewer, picking/highlight, procedure framing and scripted instructor fallback.
AR is iOS-only; downloaded pack updates and progress sync require implementation.
