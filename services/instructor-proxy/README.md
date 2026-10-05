# Instructor proxy

Cloudflare Worker holding the Claude API key and translating Messages API streams for the app's remote adapter.
Read [ADR 0012](../../docs/adr/0012-text-instructor-with-ordered-fallback.md) for instructor policy and [AGENTS.md](../../AGENTS.md#prepare-and-verify) for installation and fake-backed checks.

| Contract | Behaviour |
| --- | --- |
| Request | `POST /v1/answer`, JSON with nonempty `system` and `prompt`, maximum 60000 / 6000 characters |
| Policy | `MODEL`, adaptive thinking with `EFFORT` (default `low`), 1500 shared thinking/answer tokens, ephemeral system cache hint |
| Rate | `LIMITER`: 30 requests per 60 seconds by `CF-Connecting-IP`; missing IP shares `unknown`, unavailable limiter returns 503 |
| HTTP errors | JSON `{"error":"<reason>"}`; 400 invalid input, 413 oversize, 404 path, 405 method, 429 rate, 500 missing key, 502 upstream failure |
| Stream | NDJSON text deltas, then one terminal done/error; no-store, no thinking/signature output |
| Completion | Only `end_turn` / `stop_sequence` produce `{"done":true}`; exhausted, refused, paused, unknown or absent stop reason produces `{"error":"upstream answer incomplete"}` |
| Empty completion | Done includes stop/block diagnostics and event names when no nonempty text was emitted; app rejects an empty answer |
| App fallback | Any error event, malformed stream, missing successful done or timeout fails the adapter |

For local development, put `ANTHROPIC_API_KEY` in an ignored `.dev.vars` and run `npm run dev` here; live questions spend API credit.
When publication is authorised, run `npx wrangler login`, `npx wrangler secret put ANTHROPIC_API_KEY`, then `npm run deploy` here.
Set [INSTRUCTOR_PROXY_URL](../../apps/field-guide/src/modules/instructor/data/cloudModel.ts) to your Worker base URL, without `/v1/answer`, or `null` to disable remote generation.
The checked-in URL is the author's demo Worker; it has no caller authentication and accepts caller-supplied instructions.
Set the key's monthly spend limit in the Anthropic console separately from the per-IP rate limit.
