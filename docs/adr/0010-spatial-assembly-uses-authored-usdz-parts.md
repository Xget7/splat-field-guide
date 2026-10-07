# Spatial assembly uses authored USDZ parts

Status: accepted.

The V8 assembly tour needs individually movable parts with exact assembled transforms; the Gol cloud and its labels represent a different capture.
Use the supplied USDZ's named hierarchy and bake its animation's final assembled pose, retaining geometry and materials.
The preparation receipt retains the source animation order; the tour receipt groups the same parts into 12 steps that include each assembly's fasteners.
RealityKit owns the assembly state machine and ARKit owns horizontal-surface placement behind the iOS Nitro `ARPlacementView`; screens request a target prefix and preview mode with a command identity.
Native snapshots report the completed prefix and phase; large parts move one at a time and contiguous authored fastener or valve-spring families move together.
Matching playback completion from every controller advances the completed prefix and reveals the next part or group.
An explicit Next request during forward assembly completes the current target immediately and begins animating the following target.
Keep later parts hidden until their movement is next.
Start and restart the tour with the crankshaft installed as its retained base component.
Apply elevation to the equipment root in world metres above the surface anchor, independently of uniform model scale.
Keep this assembly tour independent of the Gol pack, maintenance procedures and reference-recognition check.
Its authored order supports visual explanation, with mechanical correctness and physical anchoring still requiring review.
