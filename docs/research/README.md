# Research index

| Note | Date | Status | Supersession or current follow-up | Resulting ADR |
| --- | --- | --- | --- | --- |
| [01 SplatKit audit](01-splatkit-audit.md) | 2026-09-29 | Historical upstream audit | Imported/pruned implementation in [provenance](../PROVENANCE.md) | [0002](../adr/0002-pruned-splatkit-copy.md), [0004](../adr/0004-shared-core-owns-behaviour.md) |
| [02 Native RN library](02-rn-native-3d-library.md) | 2026-09-29 | Historical alternatives | iOS Nitro adopted; old glue, LOD and workspace sketches historical | [0005](../adr/0005-nitro-views.md), [0014](../adr/0014-bare-react-native-with-nitro-packages.md) |
| [03 Offline AI architecture](03-offline-ai-app-architecture.md) | 2026-09-29 | Historical recommendations | Native text models, Claude-first fallback and continuous voice replace wrapper/tool proposals | [0012](../adr/0012-text-instructor-with-ordered-fallback.md), [0014](../adr/0014-bare-react-native-with-nitro-packages.md) |
| [04 Capture spike](04-first-capture-spike.md) | 2026-09-29 | Completed historical measurements | [Supported recipe](../../pipeline/README.md); historical tool settings not fully recoverable | [0009](../adr/0009-poses-from-colmap.md), [0010](../adr/0010-no-level-of-detail.md), [0013](../adr/0013-local-pipeline-with-modal-sam.md) |
| [05 Nitro spike](05-nitro-spike.md) | 2026-09-30 | Simulator passed; physical criteria pending | Removed spike screen replaced by the guide | [0005](../adr/0005-nitro-views.md) |
| [06 AR masks](06-ar-offline-segmentation.md) | 2026-10-01 | Historical semantic-overlay proposal | Marker path diagnostic; four-landmark integration in 08/10 | Pending physical alignment and renderer choice |
| [07 AR renderers](07-arview-registration.md) | 2026-10-01 | Comparison/proposal, no physical benchmark | ARView used for four points; semantic renderer undecided | Pending |
| [08 Object registration](08-engine-object-registration.md) | 2026-10-01 to 2026-10-03 | Implementation journal; physical acceptance pending | First Standard/Upright superseded by 10; recipe uses explicit Front and digest-bound landmarks | Pending physical acceptance |
| [09 Kokoro](09-kokoro-tts.md) | 2026-10-01 | Implemented choice; device measurements pending | Decision extracted; comparison retained | [0015](../adr/0015-kokoro-with-vendored-english-frontend.md) |
| [10 Tracking audit](10-object-tracking-training-audit.md) | 2026-10-02 to 2026-10-03 | Integrity checked; latest physical recognition unvalidated | Replaces the duplicate 09 number and updates 08 | Pending physical acceptance |
