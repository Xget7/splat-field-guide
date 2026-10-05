This Cloudflare Worker keeps the Field Guide iOS app's Anthropic API key in the `ANTHROPIC_API_KEY` secret and streams instructor answers from the Anthropic Messages API.
`POST /v1/answer` accepts JSON with required non-empty `system` and `prompt` strings, limited to 60000 and 6000 characters respectively.
Invalid JSON or fields return 400, oversized strings return 413, other methods return 405, and other paths return 404, with JSON errors shaped as `{"error":"<short reason>"}`.
The `LIMITER` binding uses `CF-Connecting-IP` to allow 30 requests per 60 seconds and returns 429 when exceeded, following the [Cloudflare rate limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
Requests without the IP header share an `unknown` bucket for local development.
The upstream request fixes the model to `MODEL`, enables streaming, gives the system text ephemeral cache control, and allows 1500 output tokens.
The model uses adaptive thinking, with `EFFORT` (default `low`) setting how much it reasons, and thinking and answer text share `max_tokens`.
An upstream non-2xx response becomes 502 with `{"error":"upstream <status>"}` without exposing its body or the secret.
Success returns 200 with `application/x-ndjson; charset=utf-8` and `cache-control: no-store`, emitting a `{"text":"<delta>"}` line per text delta and exactly one final `{"done":true}` or `{"error":"<reason>"}` line.
Only `end_turn` and `stop_sequence` are successful stop reasons.
An exhausted, refused, paused, unknown or missing stop reason ends with `{"error":"upstream answer incomplete"}` so the app can fall back.
The final done line includes `stop`, the encountered content `blocks`, and `events` when no nonempty text was emitted, allowing empty replies to be diagnosed without exposing thinking.
The translator handles split chunks and multi-line data, reads completion and block events, ignores thinking and signature deltas, and reports interrupted, malformed or failed streams.
Use Node 26 or later, enter `services/instructor-proxy`, and run `npm install`, `npm test`, and `npx tsc --noEmit -p .`.
For deployment setup, run `npx wrangler login`, then `npx wrangler secret put ANTHROPIC_API_KEY`, then `npm run deploy` from this directory.
For local development, put `ANTHROPIC_API_KEY` in an ignored `.dev.vars` file and run `npm run dev`.
Set a monthly spend limit on the key in the Anthropic console.
This demo endpoint has no caller authentication and accepts caller-supplied instructions.
The per-IP limiter bounds request rate; the account spend limit is a separate manual setting.
