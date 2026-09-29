# The shared C++ core owns parts, picking and the camera; backends only draw

Status: accepted

SplatKit implements much of its behaviour twice, once per platform, behind about 1,400 lines of call-forwarding facades.
Here everything that is not GPU work (the cloud and its labels, highlight state, picking, the orbit camera and framing) lives once in C++, behind one C interface that Swift and Kotlin call.
The Metal and Vulkan backends only upload the cloud and draw a frame.

**Pros**
- Picking and framing behave the same on both platforms and are tested once, without a GPU.
- The renderer seam shrinks from 28 virtual methods to about ten.

**Cons**
- A C interface is less expressive than C++ or Objective-C; structs and error codes are spelled out by hand.
- Kotlin still needs a thin JNI layer.
