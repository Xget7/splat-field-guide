# The shared C++ core owns viewer behaviour

Status: accepted.

Picking, highlight and camera geometry need one implementation that can be tested independently of GPU work.
Keep cloud ownership, load reservation, picking, highlight, orbit and framing behind the [C interface](../../packages/react-native-splat/engine/splatkit-engine/include/splatkit/sfg.h), with Swift/Metal and Kotlin/Vulkan adapters scheduling and drawing it.

- C-interface tests exercise the same behaviour as native callers.
- Load ownership rejects stale decoding, uploads and completion callbacks.
- Platform adapters implement rendering and scheduling rather than session geometry.
- Speech uses platform adapters, and AR recognition is iOS-only.
