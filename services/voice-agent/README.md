# Voice agent

This service builds an authenticated ElevenLabs instructor from the guide's own pack parser, grounding rules, knowledge, recognition hints, session defaults and seven client tools.
All authored evidence goes into the prompt; there is no retrieval or model training.
Claude answers through the [instructor proxy](../instructor-proxy/README.md).

| Setting | Value |
| --- | --- |
| Name and prompt | `Field Guide: <pack title>`, shared rules, spoken style, part/check ids and complete pack knowledge |
| Opening and context | `{{opening}}`; `procedure`, `step`, `selected_part`, `opening` default to exploration; later screen changes arrive as context |
| LLM | `custom-llm`, model `field-guide`, `chat_completions`, `<WORKER_URL>/v1`, workspace secret reference |
| Recognition | High quality, pack recognition hints, `pcm_16000` |
| Voice | English Flash v2 (`eleven_flash_v2`), owner-provided `VOICE_ID`, `pcm_24000` |
| Pronunciation | Authored alias dictionary pinned to its synced version |
| Tools | Client tools with pack part/check enums, responses required, five-second timeout |
| Turn | Normal eagerness, end after twenty seconds of silence |
| Conversation | Five-minute maximum; audio, interruption, transcript, response/correction/parts/completion, tool, ping, VAD, initiation metadata and client-error events |
| Authentication | Enabled; the app connects with signed URLs from the Worker |

Use Node 26 or newer.
This package installs its own development dependencies, including Node types.

In ElevenLabs, open Developers, API Keys, create a named key and keep key restrictions enabled.
Enable ElevenAgents write (`convai_write`), Workspace write (`workspace_write`), Pronunciation Dictionaries read and write (`pronunciation_dictionaries_read`, `pronunciation_dictionaries_write`), and Voices read (`voices_read`).
The sync creates and updates agents, client tools and workspace secrets, and reads and writes dictionary rules.
See [API authentication](https://elevenlabs.io/docs/api-reference/authentication) and the permission names in the [API schema](https://api.elevenlabs.io/openapi.json).

In Voice Library, choose a calm, clear English voice that works with ElevenAgents, add it to My Voices, then use its menu to copy the voice ID.
Set that ID as `VOICE_ID`; this repository does not hardcode an account's voice.
Default voices are account-dependent, so choose an available voice from your own library.

From this directory:

```sh
npm install
cp .env.example .env
```

Fill `.env` with `ELEVENLABS_API_KEY`, `VOICE_ID`, your deployed Worker's origin as `WORKER_URL`, and the same `AGENT_LLM_SECRET` that the Worker uses.
The shared secret is stored in ElevenLabs as `field-guide-agent-llm`; the agent references its secret ID.
Then review and sync:

```sh
npm run plan
npm run sync
```

`plan` makes no requests or state changes and prints complete agent, tool and dictionary bodies with a redacted secret.
It loads `.env` when present, keeps exported environment values as overrides, and uses saved IDs, with `<voice id>` and `<worker url>` placeholders for missing values.
`sync` loads `.env`, creates or updates the secret, tools, dictionary and agent in that order, then prints the agent ID and `npx wrangler secret put AGENT_ID` for the Worker.
It saves IDs after each successful stage in ignored `agent.json`, so rerunning after an API failure reuses completed resources.
Keep that file to update existing resources; [agent.example.json](agent.example.json) illustrates its optional fields, with placeholder IDs only.
Changed pronunciation rules replace the full rule set in a new dictionary version; unchanged rules reuse the latest version.

The Worker needs its own ElevenLabs key restricted to reading agents (`convai_read`), plus the same shared LLM secret and the printed agent ID.
See its README for the secret commands.
Tests use a fake API; live sync and conversations require the owner's configuration and explicit authorization.
