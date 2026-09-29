# Expose the view to React Native with Nitro Views

Status: proposed, gated by a half-day spike

The guide needs typed structs across the boundary, synchronous calls from the UI thread for gestures, and a per-frame channel to pin part labels over the 3D view.
Fabric codegen cannot pass structs or buffers to commands, and per-frame events would flood the JS thread.
Nitro Views give one typed object per mounted view with synchronous methods callable from Reanimated worklets.

**Pros**
- Gestures and label overlays run on the UI thread with no JS work per frame.
- Typed arguments instead of JSON strings or flattened scalars.

**Cons**
- Nitro is pre-1.0 and no public example runs it on React Native 0.87 yet.
- The iOS view class must be Swift.

The spike mounts and unmounts the view 100 times, calls a method from a worklet and fires a callback from the render thread on both platforms.
If it fails, we fall back to Fabric codegen, as SplatKit does today.
