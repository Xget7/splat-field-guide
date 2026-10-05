# Commands first, then ordered text-model fallback

Status: accepted.

Online answer quality and one common reply interface supersede the on-device-first tool policy in [ADR 0007](0007-commands-before-instructor.md).

Route commands locally, then try Claude through the Worker, Apple Foundation Models and scripted pack guidance.
Resolve authored evidence, including procedure cautions, once per turn; accept session actions only from a completed, validated text reply.

- The instructor owns routing, fallback and cancellation; streamed words/part emphasis stay provisional and are cleared on failure or replacement.
- Proxy errors, incomplete stop reasons and streams without successful done trigger fallback.
- Numerical grounding checks only relevant authored evidence and remains heuristic; offline generation needs an eligible, prepared Apple device.
