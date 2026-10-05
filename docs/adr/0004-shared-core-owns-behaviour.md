# Put viewer behaviour in the shared C++ core

Status: accepted.

Picking, highlight and camera rules must stay consistent and testable without GPU work.

Keep cloud/labels, highlight, picking, orbit and framing behind one C interface.
Swift owns iOS scheduling and the view; Metal owns drawing.

- Kotlin/JNI and Vulkan remain future adapters.
- The C interface spells out structs and error codes.
- Apple audio and AR recognition are separate platform implementations.
