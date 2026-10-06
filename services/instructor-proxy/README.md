# Instructor proxy

The Cloudflare Worker holds the Claude API key and translates Messages API streams for the [cloud adapter](../../apps/field-guide/src/features/instructor/models/cloudModel.ts).
Instructor policy is in [ADR 0006](../../docs/adr/0006-commands-and-ordered-instructor-fallback.md); fake-backed checks are in [AGENTS.md](../../AGENTS.md#prepare-and-verify).

| Contract | Behaviour |
| --- | --- |
| Request | `POST /v1/answer`, JSON with nonempty `system` and `prompt`, maximum 60000 / 6000 characters |
| Generation | `MODEL`, adaptive thinking with `EFFORT` (default `low`), 1500 shared thinking/answer tokens and an ephemeral system cache hint |
| Rate | `LIMITER`: 30 requests per 60 seconds by `CF-Connecting-IP`; missing IP shares `unknown`; unavailable limiter returns 503 |
| Stream | NDJSON text deltas and one terminal done/error; no-store; thinking/signatures are excluded |
| Completion | Only `end_turn` / `stop_sequence` emit `{"done":true}`; empty successful completions include stop/block diagnostics |
| Failures | Sanitized HTTP/stream errors; incomplete stop reasons produce `upstream answer incomplete` |

Use an ignored `.dev.vars` for `ANTHROPIC_API_KEY` and run `npm run dev` for local development.
Live questions spend API credit; tests replace upstream requests with fakes.
The Worker accepts caller-supplied instructions without caller authentication, so configure the key's monthly spend limit separately from rate limiting.
Deployment requires Cloudflare credentials, the API secret and explicit authorization.
