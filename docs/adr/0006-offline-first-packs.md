# Bundle one offline pack

Status: accepted.

The guide must open without a server at a field site.

Read the prepared pack directly from iOS bundle resources.
Verify its manifest hashes during scripts/prepare.sh, before bundling.

- No first-launch installation or in-app download manager exists.
- Atomic downloaded updates and authenticity are future work.
- Offline voice requires prepared system transcription/model assets, separately from bundled output.
