# Commands first, then ordered text-model fallback

Status: accepted.

Online answer quality and one common reply interface supersede the on-device-first tool policy in [ADR 0007](0007-commands-before-instructor.md).

Route commands locally, then try Claude through the Worker, Apple Foundation Models and scripted pack guidance.
Models receive authored evidence and return text; the app validates replies and derives session events.

- The instructor interface owns routing, fallback and cancellation.
- Errors, exhausted generations and streams without successful completion fail the remote adapter.
- Grounding is heuristic; offline generation needs an eligible, prepared Apple device.
