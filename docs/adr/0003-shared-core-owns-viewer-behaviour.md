# The shared C++ core owns viewer behaviour

Status: accepted.

Picking, highlight and camera geometry need one implementation that can be tested independently of GPU work.
Keep cloud ownership, load reservation, picking, highlight, orbit and framing behind the [C interface](../../packages/react-native-splat/engine/splatkit-engine/include/splatkit/sfg.h), with Swift scheduling work and Metal drawing it.

- C-interface tests exercise the same behaviour as native callers.
- Load ownership rejects stale decoding, uploads and completion callbacks.
- Platform adapters implement rendering and scheduling rather than session geometry.
- Apple audio and AR recognition remain separate native implementations.
