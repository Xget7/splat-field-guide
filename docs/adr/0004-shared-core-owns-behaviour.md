# Put viewer behaviour in the shared C++ core

Status: accepted.

Picking, highlight and camera rules must stay consistent and testable without GPU work.

Keep cloud/labels, highlight, picking, orbit and framing behind one C interface.
The core reserves cloud replacements and rejects superseded decoding, uploads and completion callbacks; Swift schedules work and Metal draws.

- Kotlin/JNI and Vulkan remain future adapters.
- The C interface is the behaviour-test surface, with structs and error codes.
- Apple audio and AR recognition are separate platform implementations.
