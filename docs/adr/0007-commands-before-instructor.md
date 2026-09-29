# Commands before the instructor; the instructor runs on device where it can

Status: accepted

People with dirty hands need "next" to work instantly and every time.
A command router matches fixed phrases (next, back, repeat, show a part) before anything reaches the instructor.
Free questions go to the instructor: Apple Foundation Models on the iPhone, on device; on Android, which has no on-device model on our test phone, a self-hosted model on the pack server when online, and scripted answers from the pack when not.
The instructor moves the session only through tools, the same actions the UI dispatches.

**Pros**
- Navigation never waits for a model and never misunderstands "next".
- The iPhone answers questions with no network and no data leaving the device.

**Cons**
- Android answers free questions only when online.
- The on-device model has a 4,096-token context, so part knowledge is fetched through tools instead of pasted into the prompt.
