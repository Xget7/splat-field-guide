# One repository for the engine, the app and the pipeline

Status: accepted

The pipeline and the app meet at one contract, the pack.
Keeping the renderer, the React Native library, the app and the pipeline in one repository lets that contract change in one commit and gives a reviewer one link.

**Pros**
- A pack format change and both of its readers land together.
- One place to read, clone and build.

**Cons**
- Python, C++, Swift, Kotlin and TypeScript share one tree.
  Each top-level folder keeps its own toolchain so none leaks into the others.
- If the pipeline grows into its own product it will need to move out.
