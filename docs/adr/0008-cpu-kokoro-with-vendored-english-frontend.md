# CPU Kokoro with a vendored English frontend

Status: accepted.

Offline English output needs simulator execution, cancellable audio and catchable inference failures.
Use quantized Kokoro on CPU ONNX Runtime with a vendored FluidAudio English frontend and bundled Misaki/BART resources, keeping Apple speech as fallback.

- CPU inference trades Neural Engine acceleration for simulator coverage and controlled errors.
- Preparation verifies every speech resource and bundles its notices.
- Word timing is estimated from the original text and generated audio.
- Device latency, pronunciation and listening quality require physical acceptance.
