# CPU ONNX Kokoro with a vendored English frontend

Status: accepted.

Speech needs offline English output, simulator execution and controllable failures.

Use quantized Kokoro-82M v1.0/af_heart on CPU ONNX Runtime, with adapted FluidAudio and bundled Misaki/BART G2P resources.
Keep Apple speech as fallback.

- Preparation pins and verifies resource hashes, bundling model and notices.
- Word timing is estimated; real-device latency/quality remain measurements.
- The [comparison](../research/09-kokoro-tts.md) rejected full Core ML Kokoro, MLX simulator restrictions and standard sherpa Kokoro with eSpeak.
