# Splat Field Guide

A field maintenance guide on a phone: a photoreal Gaussian-splat capture of real equipment where every part can be found, highlighted and explained, step by step, by an AI instructor that works offline.
This glossary is the vocabulary of the code, the docs and the conversation; it names concepts, not implementations.

## Language

### The equipment

**Equipment**:
The physical machine a guide is about, such as one car's engine bay.
_Avoid_: asset, model, object, vehicle

**Part**:
A named physical component of the equipment that a person can point at, such as the coolant reservoir.
A part has a stable id that never changes between pack versions.
_Avoid_: component, piece, segment, object

**Part label**:
The small integer on each splat that says which part it belongs to; zero means the splat belongs to no part.
_Avoid_: class, segment id, mask id

### The picture

**Splat**:
One Gaussian: a position, a covariance, a colour and an opacity.
_Avoid_: point, gaussian, particle

**Cloud**:
The splats of one capture decoded into memory, each with its part label.
_Avoid_: point cloud, scene, world

**Highlight**:
How parts are drawn right now: some parts emphasised, the rest dimmed, or none.
A highlight is derived from what the person is doing, never set by hand.
_Avoid_: selection (that is what the person chose), glow, outline

**Pick**:
Finding the part under a point on the screen.
_Avoid_: hit test, raycast, tap

**Framing**:
A camera move that brings one or more parts fully into view.
_Avoid_: focus, zoom to, fly to

### The guidance

**Procedure**:
An ordered set of steps that accomplishes one maintenance task, such as checking the engine oil.
_Avoid_: guide, tutorial, workflow, lesson

**Step**:
One instruction inside a procedure, with the parts it is about.
_Avoid_: task, stage (that is the pipeline)

**Session**:
One person's run through a procedure: which step they are on and which part they chose.
_Avoid_: attempt, run, state

**Instructor**:
The AI guide that answers questions about the equipment and moves the session forward when asked.
_Avoid_: assistant, chatbot, agent, copilot

**Command**:
A fixed spoken phrase, such as "next" or "show me the battery", handled without the instructor.
_Avoid_: intent, hotword, shortcut

### Content

**Pack**:
Everything the app needs to guide one piece of equipment offline: the cloud, the part labels, the parts and the procedures.
A pack is installed whole or not at all.
_Avoid_: bundle, asset, download, content

**Tier**:
A version of a pack sized for a class of device, such as fewer splats for older phones.
_Avoid_: quality, LOD, variant

### Making a pack

**Capture**:
The photos, and optionally depth, taken of the equipment.
_Avoid_: scan, recording, dataset

**Pipeline**:
The offline steps that turn a capture into a pack.
Its steps are called stages.
_Avoid_: workflow, job

**Mask**:
The pixels of one photo that show one part.
_Avoid_: segmentation, matte

**Lifting**:
Giving every splat a part label by combining the masks of all photos.
_Avoid_: projection, voting, 3D segmentation
