# ElevenLabs agent online, on-device pipeline offline

Status: accepted.

Spoken turns need natural turn-taking, barge-in and fast first audio, which our own endpointing and CPU Kokoro could not give online.
Online, talk to an ElevenLabs agent over a signed WebSocket, with Claude through the Worker as its custom LLM and client tools that drive the guide.
Offline, keep the on-device pipeline: platform speech recognition, the Apple model or scripted guidance, and Kokoro on iOS.
A mode controller picks the mode from network quality with hysteresis and suggests going offline on a weak signal.

- Every voice session sits behind one `VoiceSession` port; the runtime is the only place that knows which mode is running.
- The Worker signs session URLs and holds the ElevenLabs key, so no key ships in the app.
- Agent minutes are paid and limited; quota, auth or a lost connection during a turn continue on the device with the system voice and a notice.
- Offline answers are limited by the device, and the panel says so.
- Typed questions go to the agent while it is talking and follow [0006](0006-commands-and-ordered-instructor-fallback.md) otherwise.
- Android has the same modes, with system speech offline.
- Rejected: OpenAI Realtime, because answers must come from Claude; ElevenLabs speech-to-text with our own turn-taking, because it rebuilds what the agent already does; Kokoro online, because of its latency and a second voice.
