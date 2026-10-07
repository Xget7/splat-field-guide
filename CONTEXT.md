# Splat Field Guide

A maintenance guide for real equipment, with a captured picture, named parts, procedures and an instructor.
This glossary gives the code, documentation and conversation one vocabulary.

## Language

### Equipment and discovery

**Equipment**:
The physical machine a guide is about, such as one car's engine bay.
_Avoid_: asset, model, object, vehicle

**Part**:
A named physical piece of equipment with an identity that persists across pack versions.
A part can belong to a parent part, such as the valve cover within the engine.
_Avoid_: component, piece, segment, object

**Guide**:
A discoverable entry for an area of equipment, with its identity, category and readiness to open a pack.
_Avoid_: procedure, pack, tutorial

**Library**:
The collection of guides a person can browse, including guides ready to open and those still to be captured.
_Avoid_: catalog screen, gallery, home

**Category**:
An equipment grouping within the library, such as vehicles or aviation.
_Avoid_: type, industry, section

### The picture

**Splat**:
One Gaussian, described by a position, covariance, colour and opacity.
_Avoid_: point, gaussian, particle

**Cloud**:
The collection of splats representing one capture of equipment.
_Avoid_: point cloud, scene, world, remote instructor

**Part label**:
The small integer identifying the part a splat belongs to, with zero meaning no part.
_Avoid_: class, segment id, mask id

**Highlight**:
The emphasis on the parts relevant to the current session, with the rest dimmed, or no emphasis.
_Avoid_: selection (what the person chose), glow, outline

**Pick**:
The identification of the part under a position on the picture.
_Avoid_: hit test, raycast, tap

**Framing**:
The camera position that brings the relevant parts fully into view.
_Avoid_: focus, zoom to, fly to

### Guidance

**Procedure**:
An ordered set of steps for one maintenance task, such as checking the coolant level.
_Avoid_: guide, tutorial, workflow, lesson

**Step**:
One instruction within a procedure, together with the parts and caution it concerns.
_Avoid_: task, stage (a pipeline stage)

**Parts tour**:
A procedure introducing every part in the order it appears across the equipment's picture.
_Avoid_: maintenance procedure, walkthrough, overview

**Session**:
One person's current exploration or procedure position, including the selected part.
_Avoid_: progress (the saved continuation position), attempt, run, state

**Progress**:
The saved guide, procedure and step position from which a person can continue.
_Avoid_: session, completion, history

**Learning mode**:
The choice of instructor guidance or a self-guided presentation of the procedure.
_Avoid_: voice mode, difficulty, lesson type

**Instructor**:
The guide that answers equipment questions and responds to requests to move the session forward.
_Avoid_: assistant, chatbot, agent, copilot

**Command**:
A recognised request such as "next" or "show me the battery", with a defined session action.
_Avoid_: intent, hotword, shortcut

**Turn**:
The handling of one instructor request, from its arrival through an accepted answer or cancellation.
An unfinished turn can show provisional words and a part before its answer is accepted.
_Avoid_: exchange, session, message

**Authored evidence**:
The guide's written knowledge, procedure steps and cautions relevant to an instructor question.
_Avoid_: model knowledge, generated facts, retrieval result

**Spoken turn**:
One stretch of speech ending with an acoustic pause and settlement of its recognised words.
_Avoid_: utterance (spoken output), instructor turn, session

**Native conversation**:
Continuous microphone listening that can contain several spoken turns.
_Avoid_: procedure session, thread, instructor turn

**Exchange**:
One question and the instructor's reply, including any accompanying caution.
_Avoid_: message, turn, conversation

**Thread**:
The ordered history of steps presented and question-and-answer exchanges within a session.
_Avoid_: progress, transcript, chat log

### Content

**Pack**:
The versioned content for one piece of equipment, including its cloud, part labels, parts, procedures and knowledge.
_Avoid_: bundle, asset, download, guide

**Tier**:
A representation of a pack sized for a class of device.
_Avoid_: version, quality, LOD, variant

**Part note**:
An authored unit of knowledge about one part and one note topic.
_Avoid_: fact, paragraph, document

**Note topic**:
The subject of a part note, such as purpose, checks, specifications or safety.
_Avoid_: category (a library grouping), tag, heading

### Making a pack

**Capture**:
The photographs, and optionally depth, taken of the equipment.
_Avoid_: scan, recording, dataset

**Capture identity**:
The identity of a capture's ordered photographs, including their names and exact bytes.
_Avoid_: capture name, folder, photo count

**Source identity**:
The identity of the exact inputs used to produce an artifact, so a changed input can be distinguished from its predecessor.
_Avoid_: filename, version, timestamp

**Saved-mask revision**:
One complete accepted set of a part's prompts and masks, retained when a replacement is accepted.
_Avoid_: browser draft, individual click, tracking result

**Pipeline**:
The preparation stages that turn a capture and authored content into a pack.
_Avoid_: workflow, job

**Mask**:
The pixels of one photograph that show one part.
_Avoid_: segmentation, matte

**Lifting**:
The assignment of part labels to splats from the masks of the capture's photographs.
_Avoid_: projection, voting, 3D segmentation

### Spatial assembly

**Assembly tour**:
A visual sequence that brings separate parts back into their assembled positions.
_Avoid_: maintenance procedure, mechanical assembly instructions

**Assembly batch**:
A group of parts brought together in one assembly tour step.
_Avoid_: individual part step, mechanical subassembly

**Exploded view**:
A view that separates the equipment's parts while retaining their relationship to the assembled equipment.
_Avoid_: disassembly procedure, cutaway

**Placement**:
The position on a real surface where virtual equipment stays while a person moves around it.
_Avoid_: registration, recognition

### Provisional AR alignment

**Reference**:
The prepared representation of a particular rigid equipment assembly used to recognise it in the camera view.
_Avoid_: pack, mesh, generic detector

**Registration**:
The calibrated relationship between the reference's coordinates and the pack's coordinates.
_Avoid_: tracking, recognition, alignment gesture

**Landmark**:
An identifiable location on the equipment shared by its reference and pack for checking registration.
_Avoid_: part anchor, marker, pin (the displayed annotation)
