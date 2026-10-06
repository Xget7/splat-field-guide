# Bare React Native with local Nitro packages

Status: accepted.

The viewer needs synchronous gesture calls and projection reads, while speech needs native audio coordination.
Use bare React Native with local Nitro packages for the viewer, speech and Apple generation, retaining direct control of the Xcode project.

- Commit generated Nitro interfaces with their specifications.
- Preparation builds a source-fingerprinted engine before CocoaPods vendors it.
- Matching frameworks are reused and stale frameworks are rejected.
- Simulator checks support the bridge choice; physical stress acceptance remains open.
