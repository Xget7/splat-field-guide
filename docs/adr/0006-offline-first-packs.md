# Offline-first packs, with one pack bundled in the app

Status: accepted

Field sites often have no network, so the app reads everything from installed packs and never needs a server to work.
One pack ships inside the app and is installed on first launch; newer packs download from the pack server when online, are verified by SHA-256 and installed atomically.

**Pros**
- Works in airplane mode from the first launch.
- A half-downloaded or corrupted pack can never be opened.

**Cons**
- The bundled pack makes the app larger by its size (tens of MB).
- No signatures yet; integrity only, not authenticity.
  Syncing progress back to a server is a later step.
