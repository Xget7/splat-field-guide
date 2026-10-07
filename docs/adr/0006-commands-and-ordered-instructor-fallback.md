# Commands first with ordered instructor fallback

Status: accepted; amended by [0009](0009-elevenlabs-agent-online-pipeline-offline.md) for spoken turns online.

Commands need deterministic session actions, while free questions need grounded answers with offline continuity.
Route commands locally, then try Claude through the Worker, Apple Foundation Models and scripted pack guidance through one text-reply interface.
Resolve authored evidence once per turn and commit session actions only after a complete validated reply.

- The instructor owns fallback and cancellation.
- Android reports Apple generation unavailable and falls through to scripted guidance after Claude fails.
- Streamed words and part emphasis are provisional and clear on failure or cancellation.
- Incomplete, empty or failed cloud answers trigger fallback.
- Numerical grounding is heuristic and eligible Apple hardware needs a prepared model.
