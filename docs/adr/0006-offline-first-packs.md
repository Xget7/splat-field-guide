# Bundle one offline pack

Status: accepted.

The guide must open without a server at a field site.

Read the prepared pack directly from iOS bundle resources.
Verify schema and file identities during scripts/prepare.sh, then pass manifest digests and splat count to the native loader.

- Preparation accepts the pinned archive or matching cache; no in-app installer exists.
- Atomic downloaded updates and authenticity are future work.
- Offline voice requires prepared system transcription/model assets, separately from bundled output.
