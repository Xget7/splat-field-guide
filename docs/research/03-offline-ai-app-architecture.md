# Offline AI training app architecture (research, 2026-09-29)

Status: historical recommendations, 2026-09-29; wrapper/tool, Modal-model and half-duplex proposals are superseded by [ADR 0012](../adr/0012-text-instructor-with-ordered-fallback.md), [0013](../adr/0013-local-pipeline-with-modal-sam.md), [0014](../adr/0014-bare-react-native-with-nitro-packages.md) and [0015](../adr/0015-kokoro-with-vendored-english-frontend.md).

Legend: every claim has a URL.
"(unverified)" means no primary source confirmed it, or it comes from my prior knowledge or a secondary source.
Apple developer pages are JS-rendered and several fetches returned only titles, so some Apple claims lean on library docs that restate them.

## Key findings up front

- Apple on-device model context is a fixed 4096 tokens covering instructions, messages, tool definitions and schemas: https://www.react-native-ai.dev/docs/apple/generating
- `@react-native-ai/apple` supports tools and `generateObject`, but tools run inside Apple's runtime, not the AI SDK loop: https://www.react-native-ai.dev/docs/apple/generating
- `@react-native-ai/apple` transcription is file/buffer based and "does not support streaming or live transcription": https://www.react-native-ai.dev/docs/apple/transcription
- So for hands-free streaming STT on iOS you need a native module or `expo-speech-recognition`, not `@react-native-ai/apple` transcription.
- Android 11 (Mi 9) cannot use `createOnDeviceSpeechRecognizer` (API 31) and `expo-speech-recognition` on-device mode needs Android 13+: https://developer.android.com/reference/android/speech/SpeechRecognizer , https://raw.githubusercontent.com/jamsch/expo-speech-recognition/main/README.md
- `react-native-executorch` needs Android 13+, so it is out for the Mi 9: https://github.com/software-mansion/react-native-executorch
- `@react-native-voice/voice` is archived (2026-01-31), recommended replacement is `expo-speech-recognition`: https://github.com/react-native-voice/voice
- MediaPipe LLM Inference is in maintenance-only mode, migrate to LiteRT-LM: https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android
- For the Mi 9, the deterministic command layer must carry the hands-free UX; the LLM is an add-on with an online fallback.

## 1. Content pack design

### 1.1 Manifest schema
- Keep one small `manifest.json` per pack version plus immutable content-addressed blobs.
- Separate `schemaVersion` (manifest format, app checks compatibility) from `packVersion` (content revision, monotonically increasing) and `packId` (stable identity).
- Add `minAppSchema` so an old app refuses a pack it cannot parse instead of half-installing it.
- Per-file entries: `path`, `bytes`, `sha256`; the pack-level `contentHash` is the SHA-256 of the sorted `path:sha256` list, so the pack identity is reproducible.
- Tiers: a `splatVariants` array (`tier`, `splatCount`, `file`, `sha256`, `bytes`, `minRamMb`); the client picks a tier by device class and can download a second tier later.
- Parts, descriptions and procedures live in the manifest JSON (small, diffable); `labels.bin` must be tied to a specific splat file by hash, because per-splat labels are invalid if the splat is re-trained or decimated.
  Each variant therefore carries its own `labels` entry.
- Sign the manifest server side (Ed25519 detached signature) so a compromised CDN path cannot swap content (unverified as a requirement; design choice).
- HTTP `ETag` / `If-None-Match` on the manifest URL gives cheap update checks.

### 1.2 Integrity and atomic install
- Verify SHA-256 on the client after download and before rename.
- Expo File System new API exposes file metadata including an MD5 hash, not SHA-256, so use a native SHA-256 (e.g. `expo-crypto` digest over a stream, or your own native module) for the check: https://docs.expo.dev/versions/latest/sdk/filesystem/ (MD5 claim), SHA-256 helper choice (unverified).
- Atomic install recipe: download into `packs/.staging/<packId>-<ver>-<nonce>/`, verify every file hash, write a `.complete` marker last, then `rename` the directory to `packs/<packId>/<ver>/` (rename within one volume is atomic on POSIX; unverified for Expo's `move` wrapper, prefer verifying with a native test).
- Then atomically flip a tiny `active.json` pointer (write temp + rename) and only afterwards garbage-collect the previous version.
- On launch: delete any `.staging` leftovers, and never read a pack directory without `.complete`.
- Keep the previous version until the new one has been opened successfully once (rollback).

### 1.3 Resumable downloads
- `expo-file-system` new API has pauseable download tasks with `idle -> active -> paused/completed/error` states: https://docs.expo.dev/versions/latest/sdk/filesystem/
- Its docs summary does not say downloads survive app termination; treat it as foreground-only (unverified).
- `react-native-background-downloader` uses `NSURLSession` background sessions on iOS and `DownloadManager` plus a foreground service on Android, supports pause/resume, TurboModules (New Arch) and re-attaching after app restart via `getExistingDownloadTasks()`: https://github.com/kesha-antonov/react-native-background-downloader
- Caveat from the same README: force-quitting on iOS cancels background tasks.
- Per-file download (not one giant zip) gives natural resumability: each blob is verified independently and only failed blobs are retried.
- Server must support HTTP `Range` and stable `ETag`; Modal web endpoints allow unlimited response sizes but a CDN/object store in front is the safer path for multi-hundred-MB blobs: https://modal.com/docs/guide/webhooks

### 1.4 Library choice (2026)
- Foreground path and file ops: `expo-file-system` new object API (`File`, `Directory`, `Paths`) works in bare RN via Expo modules: https://docs.expo.dev/versions/latest/sdk/filesystem/
- Large background downloads: `react-native-background-downloader` (above).
- `react-native-blob-util` is still a dependency of `react-native-executorch`, so it is alive: https://github.com/software-mansion/react-native-executorch .
  I did not fetch its own README (unverified for New Arch details).
- Recommendation: `expo-file-system` for IO and hashing glue, `react-native-background-downloader` for the big blobs, one `PackStore` module hiding both.

### 1.5 Storage locations
- iOS: Documents and Application Support are included in backups; Caches and tmp are not, and Caches can be purged: https://developer.apple.com/library/archive/qa/qa1719/_index.html
- Put packs in Application Support (not user-visible, not purgeable) and set `isExcludedFromBackup = true` on the `packs/` directory, because packs are re-downloadable: https://developer.apple.com/library/archive/qa/qa1719/_index.html
- Do not put packs in Caches: the OS may delete them and the app would lose offline training content.
- Android: `getCacheDir()`, `getCodeCacheDir()` and `getNoBackupFilesDir()` are excluded from Auto Backup by default; other `filesDir` content is backed up unless excluded: https://developer.android.com/identity/data/autobackup
- Use `noBackupFilesDir` for packs (persistent, not backed up, not evicted like cache), or `filesDir` plus `<exclude>` rules in both `fullBackupContent` (Android 11 and lower) and `dataExtractionRules` (Android 12+): https://developer.android.com/identity/data/autobackup
- Mi 9 runs Android 11, so `android:fullBackupContent` is the attribute that matters on the demo device: https://developer.android.com/identity/data/autobackup

### 1.6 Bundled seed pack, offline from first launch
- Ship the seed pack as app assets in the binary (iOS bundle resource, Android `assets/`), with its manifest.
- On first launch, copy (or hard-verify) into the packs directory through the same install path as a download, so there is one code path.
- Android assets are compressed inside the APK; large `.spz` files should be excluded from compression (`aaptOptions.noCompress`) so they can be streamed or copied cheaply (unverified for AGP version specifics).
- Alternative for Android: Play Asset Delivery install-time asset pack (unverified, not fetched).
- Resolution rule: `active.json` present and valid -> use it; else use the bundled seed directly read-only; download only replaces the active pointer.
- App updates that ship a newer seed: compare `packVersion`, install seed only if newer than active.

### 1.7 Progress sync (later, outbox)
- Local SQLite table `outbox(id ULID, type, payload, createdAt, attempts)`; writes to domain state and outbox happen in one transaction.
- Events are idempotent by `id`; server endpoint dedupes on `id` and returns the highest acked id.
- Flush on connectivity change and app foreground, exponential backoff, batch of N events per request.
- Never block the training flow on network.
  This is the standard transactional outbox pattern (general pattern, no library-specific source).

## 2. Domain model and state

### 2.1 Entities
- Pack: immutable content bundle (id, version, tier, parts, procedures).
  Loaded once into memory as read-only indexes.
- Part: `id`, `name`, `aliases[]` (for voice matching), `description`, `splatLabelId`.
- Procedure: `id`, `title`, ordered `steps[]`.
- Step: `id`, `instruction`, `partIds[]` to highlight, `camera` hint, optional `spokenText`, optional `caution`.
- Session: mutable runtime record (which pack, procedure, current step, selected part, history of events).
  It is what gets persisted and later synced.
- Pack content never changes at runtime; only Session changes.
  That split keeps the interface small.

### 2.2 State machine choice
- XState v5 is actor-based, TypeScript-first, has React bindings (`@xstate/react`) and a separate lightweight `@xstate/store`: https://stately.ai/docs/xstate
- The Stately docs note the VS Code extension does not fully support v5 yet (at fetch time): https://stately.ai/docs/xstate
- The procedure here is small: idle -> running(step i) -> done, plus events NEXT, BACK, REPEAT, GOTO, SELECT_PART, PAUSE.
  A pure reducer `(state, event) -> state` plus derived effects is enough and is trivially unit-testable.
- Recommendation: start with a typed reducer; adopt XState v5 only if you add async concerns (timers, confirmations, multi-actor voice turns) inside the machine.
  This is a judgment call, not a sourced fact.
- Either way expose one interface: `dispatch(event)` and `subscribe(selector)`.

### 2.3 One dispatch path for UI and voice
- Every input source (tap, button, deterministic voice command, LLM tool call) produces the same `SessionEvent` and calls `session.dispatch`.
- LLM tools are thin adapters: `nextStep()` -> `dispatch({type:'NEXT'})`; they return the new `currentStep` snapshot as the tool result so the model can speak about it.
- Rendering effects (highlight parts, frame camera) are derived from state, never triggered by the caller directly; this keeps UI, voice and LLM consistent.
- Guard invariants in the reducer (cannot go past last step, unknown partId ignored with a typed error result).
- Apple's tools run in Apple's runtime and the AI SDK loop callbacks do not fire: https://www.react-native-ai.dev/docs/apple/generating. Do not rely on `maxSteps`; make each tool return complete, self-contained results.

## 3. AI instructor architecture

### 3a. iOS Apple Foundation Models
- Framework gives direct access to the on-device model behind Apple Intelligence; iOS 27 adds any-provider `LanguageModel` protocol (Apple, Claude, Gemini, others), multimodal prompts, Vision tools, "Dynamic Profiles" (swap models/tools/instructions in a session), and an Evaluations framework: https://developer.apple.com/wwdc26/guides/ios/
- iOS 27 also offers next-gen Apple Foundation Models on Private Cloud Compute at no API cost for App Store Small Business Program apps under 2M first-time downloads: https://developer.apple.com/wwdc26/guides/ios/ .
  Not offline, so only a fallback.
- I found no primary source stating the iOS 27 on-device context size changed; assume 4096 tokens until measured (unverified for iOS 27): https://www.react-native-ai.dev/docs/apple/generating
- Apple publishes TN3193 for managing the context window and exceeded-context handling: https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window (body not retrievable in my fetch, so details unverified).
- Availability enum reasons: `deviceNotEligible`, `appleIntelligenceNotEnabled`, `modelNotReady`: https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.property
- Latency (2025 model, tech report): about 0.6 ms per prompt token time-to-first-token and 30 tokens/s generation on iPhone 15 Pro, ~3B params, 2-bit QAT: https://arxiv.org/abs/2507.13575 (via search summary; iPhone 17 Pro should be faster, unmeasured).
- With a 1k-token prompt that is roughly 0.6 s to first token by that rate (arithmetic on the sourced figure).
- Tool protocol and guided generation (`@Generable`) exist in the framework: https://developer.apple.com/documentation/foundationmodels (page body was not retrievable; the RN wrapper confirms tools plus structured output).
- RN access, Callstack `@react-native-ai/apple`: text generation, embeddings, transcription, speech synthesis; iOS 26+ and Apple Intelligence device for text; requires RN 0.80+ with New Architecture; AI SDK v6 from 0.12+: https://github.com/callstackincubator/ai , https://www.react-native-ai.dev/docs/apple/generating
- Tool calling caveats: tools pre-registered in `createAppleProvider`, empty tool call IDs, no `maxSteps`/step callbacks: https://www.react-native-ai.dev/docs/apple/generating
- Structured output supports objects, arrays, enums, min/max constraints; not regex, string formats or unions: https://www.react-native-ai.dev/docs/apple/generating
- Alternative `react-native-apple-llm` (deveix): availability check, sessions, structured JSON, tools; iOS 26 and Xcode 26: https://github.com/deveix/react-native-apple-llm .
  I did not verify New Arch support or release cadence (unverified).
- Maturity call: Callstack's package is the better-documented, New Arch, AI-SDK-native choice; the Apple runtime tool semantics are the main sharp edge.
  A small custom Swift TurboModule over `LanguageModelSession` is a viable fallback if the wrapper blocks streaming tool results (judgment).

### 3b. Android on Snapdragon 855 (Mi 9, Android 11, no Gemini Nano)
- Constraint summary: Adreno 640 GPU, Android 11, likely 6 or 8 GB RAM (unverified for the specific unit).
- MediaPipe LLM Inference: "maintenance-only", migrate to LiteRT-LM; targets "Pixel 8 and Samsung S23 or later"; Gemma-3 1B 4-bit listed; no tok/s published: https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android
- LiteRT-LM: Kotlin API stable, GPU/NPU acceleration, tool use, models Gemma/Llama/Phi-4/Qwen: https://github.com/google-ai-edge/LiteRT-LM .
  No RN wrapper found (unverified) and no 855 numbers.
- `react-native-executorch`: needs RN 0.83+, iOS 17+, Android 13+, so not usable on the Mi 9: https://github.com/software-mansion/react-native-executorch
- `llama.rn` (llama.cpp binding): New Arch required since v0.10, tool calling via Jinja templates, GBNF/JSON-schema grammar, OpenCL for Adreno 700+ only, Hexagon NPU experimental: https://github.com/mybigday/llama.rn
- Mi 9 (Adreno 640) is below the OpenCL 700+ line, so expect CPU-only inference (inference from the stated requirement).
- Callstack also ships `llama` and `mlc` providers for the AI SDK v6 (GGUF via llama.rn; MLC needs download and memory-limit capability): https://github.com/callstackincubator/ai
- Published tok/s: no primary source for 855.
  A secondary dataset reports Qwen2.5-1.5B int4 at 16.8 tok/s with llama.cpp, 4 threads, on a Snapdragon 865 (S20 FE): https://huggingface.co/datasets/dispatchAI/on-device-latency (secondary, via search summary).
- Working estimate for 855: roughly 8 to 12 tok/s for a 1B to 1.5B Q4 model, prefill several times slower than Apple's; this is my extrapolation (unverified).
  Benchmark on the device before committing.
- Tool-calling reliability of small models: FunctionGemma 270M reports 58% base and 85% fine-tuned accuracy on Mobile Actions: https://blog.google/technology/developers/functiongemma/ (via search summary).
  A general 1B model without fine-tuning will be worse than that on multi-arg calls (judgment).
- Mitigation: constrain output with a GBNF grammar (llama.rn) to a closed set of intents and part ids, so failures become "unknown" instead of malformed calls: https://github.com/mybigday/llama.rn
- Online fallback: a Modal-hosted endpoint serving a larger model; needs network so it is not offline-first, but suits a demo with connectivity.
  Modal endpoints and cold starts: https://modal.com/docs/guide/webhooks , https://modal.com/docs/guide/cold-start
- Recommendation for the Mi 9: deterministic commands + scripted answers from pack descriptions offline; optional llama.rn 1B for free-form Q&A behind a feature flag; remote Modal model when online.

### 3c. Provider seam
- One `Instructor` interface, adapters behind it: `AppleFoundationInstructor`, `LlamaInstructor` (Android local), `RemoteInstructor` (Modal), `ScriptedInstructor` (always available).
- A `CommandRouter` runs first: normalized transcript -> regex/grammar -> `SessionEvent`; only unmatched utterances reach the Instructor.
- Router benefits: sub-10 ms latency, 100% reliability for the top commands, works with no model at all (design rationale).
- Selection at startup by capability probe with a ranked list; downgrade at runtime on error or thermal pressure.
- Part references resolve through `aliases[]` with fuzzy match (edit distance / phonetic) against the current pack.

### 3d. Grounding in a 4k context
- Apple's window covers instructions, messages, tool definitions and schemas together: https://www.react-native-ai.dev/docs/apple/generating
- Budget sketch: system prompt under 300 tokens, tool schemas under 500, rolling history 1k, tool results 1k, answer 500 (my allocation; measure per TN3193).
- Tools instead of stuffing: `getPartInfo(partId|name)`, `currentStep()`, `listParts(procedureId)`, `navigate(action)`, `highlight(partIds)`.
- Keep tool results short (a 40 to 80 word description per part; the manifest should store a `short` and a `long` description).
- Keep only the last few turns; summarize or drop older ones, since exceeded-context is an error case: https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window
- Tool definitions cost tokens on every call, so keep the tool count under about 6 (design guidance).
- Small Android models get the same tools but through a grammar, and with 2k context.

## 4. Voice

### 4.1 iOS
- `SpeechAnalyzer` / `SpeechTranscriber` are the iOS 26 on-device speech APIs (WWDC25 session 277): https://developer.apple.com/videos/play/wwdc2025/277/
- The RN wrapper's transcription runs fully on-device but takes an ArrayBuffer or base64 and states no streaming or live transcription: https://www.react-native-ai.dev/docs/apple/transcription
- Language assets download on demand and live in a system catalog, not in your bundle; call `prepare()` early: https://www.react-native-ai.dev/docs/apple/transcription
- Streaming path options: `expo-speech-recognition` (iOS 17+, continuous mode, `requiresOnDeviceRecognition`, `contextualStrings`, `iosVoiceProcessingEnabled` for echo): https://raw.githubusercontent.com/jamsch/expo-speech-recognition/main/README.md
- Whether `expo-speech-recognition` uses `SpeechAnalyzer` on iOS 26 is not stated in what I retrieved; it advertises `SFSpeechRecognizer` (unverified): https://github.com/jamsch/expo-speech-recognition
- Otherwise write a small Swift module that feeds an `AVAudioEngine` tap into `SpeechAnalyzer` and emits volatile and final results (unverified effort estimate).
- TTS: `AVSpeechSynthesizer` (also exposed by `@react-native-ai/apple` speech synthesis, iOS 13+): https://github.com/callstackincubator/ai

### 4.2 Android
- `EXTRA_PREFER_OFFLINE` since API 29 (a hint, engine may ignore it); `createOnDeviceSpeechRecognizer`, `isOnDeviceRecognitionAvailable`, `checkRecognitionSupport`, `triggerModelDownload` since API 31: https://developer.android.com/reference/android/speech/SpeechRecognizer
- Mi 9 is Android 11 (API 30): only `EXTRA_PREFER_OFFLINE` applies, and it depends on the Google speech engine having an offline pack (unverified on Mi 9).
- `expo-speech-recognition`: on-device and continuous mode require Android 13+; Android 12 and below use `googlequicksearchbox`: https://raw.githubusercontent.com/jamsch/expo-speech-recognition/main/README.md
- Consequence: on the Mi 9 expect online-only or unreliable-offline platform STT.
- Offline options for the Mi 9: a keyword/command spotter or small Whisper/Vosk/sherpa-onnx model (unverified, not researched in depth).
  `llama.rn` also lists speech features: https://github.com/callstackincubator/ai
- `@react-native-voice/voice` archived 2026-01-31: https://github.com/react-native-voice/voice
- TTS: Android `TextToSpeech` (platform, offline voices depend on installed engine; unverified for Mi 9).
  `expo-speech` wraps both platforms (unverified, not fetched).

### 4.3 Hands-free design
- Listen only while a procedure is active; a visible mic state and a manual push-to-talk fallback.
- Half-duplex by default: pause recognition while TTS speaks, resume on TTS end, which sidesteps echo without relying on AEC.
- Barge-in, if wanted: keep the mic open with echo cancellation.
  On iOS use voice processing (`iosVoiceProcessingEnabled`): https://raw.githubusercontent.com/jamsch/expo-speech-recognition/main/README.md
- On Android use `AcousticEchoCanceler` with a `VOICE_COMMUNICATION` source where `isAvailable()`: https://developer.android.com/reference/android/media/audiofx/AcousticEchoCanceler
- Barge-in trigger: only a short command vocabulary ("stop", "next", "back") accepted while TTS is speaking; everything else waits.
- Keep TTS utterances short (one step, under about 25 words) so half-duplex gaps stay small.
- Gate LLM calls on final results, but run the CommandRouter on volatile results for lower latency (design suggestion).

## 5. Performance constraints

- iOS thermal: `ProcessInfo.thermalState` (`nominal`, `fair`, `serious`, `critical`) and `thermalStateDidChangeNotification`: https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.property (the fetch summary garbled the case names, I use the standard four from prior knowledge, unverified).
- Android thermal: `PowerManager.getCurrentThermalStatus()`, `addThermalStatusListener`, `getThermalHeadroom`, constants NONE, LIGHT, MODERATE, SEVERE, CRITICAL, EMERGENCY, SHUTDOWN: https://developer.android.com/reference/android/os/PowerManager (added in API 29 and 30 respectively, from prior knowledge, unverified; Mi 9 on API 30 should have them, but vendor behavior varies).
- Adaptive policy sketch: nominal/NONE full quality; fair/LIGHT cap fps at 45 and drop render scale to 0.85; serious/MODERATE fps 30, scale 0.7, disable LLM local adapter (use scripted/remote); critical/SEVERE and above pause rendering except on interaction and stop STT.
- Idle: render on demand (no continuous loop) when the camera is still and no animation runs; resume on touch or step change.
- Memory: choose splat tier by RAM; free the LLM (`llama.rn` context) when app backgrounds or on memory warning; iOS `didReceiveMemoryWarning`, Android `onTrimMemory` (from prior knowledge, unverified).
- Concurrency: sequence heavy work; never run LLM decode while a splat sort or a GPU-heavy camera flight runs on the same device if thermal state is elevated (design guidance).
- Battery: stop the mic when the procedure is paused; prefer Apple's on-device model on iPhone since it is system-managed and shares the resident model with other apps (design reasoning, not sourced).
- Measure: log thermal status, frame time, and tok/s per session into the outbox for tuning.

## 6. Modal pipeline

- Volumes are write-once-read-many distributed storage, `.commit()` to persist and `.reload()` to see others' writes; v1 limited to about 500k inodes (recommended 50k files) and 5 concurrent writers; v2 is beta: https://modal.com/docs/guide/volumes
- Avoid concurrent writes to one file (last write wins): https://modal.com/docs/guide/volumes
- Web endpoints: `@modal.fastapi_endpoint`, `@modal.asgi_app`, `@modal.web_server`; 4 GiB request bodies, unlimited response; cold start when no containers are active: https://modal.com/docs/guide/webhooks
- Cold start mitigations: `min_containers`, `scaledown_window`, `buffer_containers`, memory snapshots, move model downloads to image build or Volumes: https://modal.com/docs/guide/cold-start
- Chaining deployed functions: `Function.from_name`, `.remote()`, `.spawn()`, `.map()`: https://modal.com/docs/guide/trigger-deployed-functions
- SAM 3: text and visual prompts, images and video, 848M params, CUDA 12.6+, Python 3.12+, PyTorch 2.7+, gated Hugging Face weights, SAM 3.1 released 2026-03-27 with faster joint multi-object tracking: https://github.com/facebookresearch/sam3
- Stage design: each stage is its own Function with its own image and GPU, reads inputs from a Volume path keyed by input hash, writes outputs to a new key, and skips if the output `DONE` marker exists (idempotent, resumable).
- Serve the finished packs from a Volume through an ASGI endpoint or, better, publish to object storage and let the endpoint return signed manifests.

## Recommendation

### R1. Pack manifest sketch
```json
{
  "schemaVersion": 1,
  "minAppSchema": 1,
  "packId": "car-engine-bay",
  "packVersion": 7,
  "contentHash": "sha256:...",
  "createdAt": "2026-09-29T00:00:00Z",
  "signature": "ed25519:...",
  "variants": [
    { "tier": "high", "splatCount": 1000000, "minRamMb": 6000,
      "splat":  { "path": "splat-1m.spz",  "bytes": 0, "sha256": "..." },
      "labels": { "path": "labels-1m.bin", "bytes": 0, "sha256": "..." } },
    { "tier": "low", "splatCount": 400000, "minRamMb": 3000,
      "splat":  { "path": "splat-400k.spz",  "bytes": 0, "sha256": "..." },
      "labels": { "path": "labels-400k.bin", "bytes": 0, "sha256": "..." } }
  ],
  "parts": [
    { "id": "battery", "labelId": 12, "name": "Battery", "aliases": ["accumulator"],
      "short": "12 V lead-acid battery.", "long": "..." }
  ],
  "procedures": [
    { "id": "check-oil", "title": "Check engine oil",
      "steps": [
        { "id": "s1", "text": "Locate the dipstick.", "partIds": ["dipstick"],
          "camera": { "target": "dipstick", "distance": 0.4 } }
      ] }
  ]
}
```

### R2. Domain types sketch
```ts
type PartId = string & { readonly __b: 'PartId' };
interface Part { id: PartId; labelId: number; name: string; aliases: string[]; short: string; long: string }
interface Step { id: string; text: string; partIds: PartId[]; camera?: { target: PartId; distance: number }; caution?: string }
interface Procedure { id: string; title: string; steps: Step[] }
interface Pack { id: string; version: number; tier: 'high' | 'low'; parts: Map<PartId, Part>; procedures: Map<string, Procedure> }

type SessionEvent =
  | { type: 'START'; procedureId: string }
  | { type: 'NEXT' } | { type: 'BACK' } | { type: 'REPEAT' }
  | { type: 'GOTO'; stepIndex: number }
  | { type: 'SELECT_PART'; partId: PartId | null }
  | { type: 'END' };

interface SessionState { procedureId: string | null; stepIndex: number; selectedPart: PartId | null; status: 'idle' | 'running' | 'done' }

interface Session {                       // small, deep interface
  getState(): SessionState;
  dispatch(e: SessionEvent): SessionState;
  subscribe(l: (s: SessionState) => void): () => void;
}
```
- Highlights and camera framing are derived from `SessionState` plus `Pack`, never set directly.

### R3. Instructor interface and adapters
```ts
interface Instructor {
  readonly id: 'apple' | 'llama' | 'remote' | 'scripted';
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  respond(utterance: string, ctx: InstructorContext): AsyncIterable<InstructorChunk>; // text deltas
}
interface InstructorContext { session: Session; pack: Pack; tools: InstructorTools } // getPartInfo, currentStep, navigate, highlight
```
- Order at runtime: `CommandRouter` -> chosen `Instructor` -> `ScriptedInstructor` on any error.
- Adapters: `apple` (`@react-native-ai/apple` + AI SDK, tools pre-registered), `llama` (llama.rn, grammar-constrained, Android only, flag-gated), `remote` (Modal endpoint, online only), `scripted` (answers from `short`/`long` fields by part match).
- Ranked selection: iOS: apple -> remote -> scripted.
  Android: llama (if benchmarked OK) -> remote -> scripted.

### R4. Voice pipeline
- iOS: `expo-speech-recognition` on-device, continuous, contextual strings from part aliases -> CommandRouter -> Instructor -> `AVSpeechSynthesizer`; evaluate a native `SpeechAnalyzer` module when streaming quality matters.
- Android (Mi 9, API 30): platform recognizer with `EXTRA_PREFER_OFFLINE` as best effort, push-to-talk button always visible, evaluate a small offline model spike; `TextToSpeech` for output.
- Half-duplex by default; barge-in only with short-command vocabulary and AEC.
- Active only inside a running procedure.

### R5. Perf policy
- Read thermal state on both platforms and map to four levels (full, reduced, minimal, paused) as in section 5.
- Drop the local LLM first, then render scale, then fps, then STT.
- On-demand rendering when idle; free LLM and downscale tier on memory warnings.
- Log thermal and latency telemetry through the outbox.

### R6. Modal stage list
1. `ingest_capture` (CPU): validate video/photos, extract frames, write to Volume `captures/<hash>`.
2. `sfm_poses` (GPU): camera poses and sparse points.
3. `train_splat` (GPU): train Gaussian splat, checkpoint to Volume every N steps (resumable).
4. `segment_masks` (GPU): SAM 3.1 masks per view from part text prompts.
5. `lift_labels` (GPU/CPU): lift 2D masks to per-splat part ids, output `labels.bin`.
6. `decimate_tiers` (CPU/GPU): produce 1M and 400k variants and re-map labels per variant.
7. `build_pack` (CPU): compress `.spz`, hash files, write and sign manifest.
8. `serve_packs` (web endpoint, `min_containers=0` acceptable): manifest and signed blob URLs; use a warm container only for demos.
- Chain with `spawn` from an orchestrator function; key every intermediate artifact by input hash so reruns skip finished stages.
