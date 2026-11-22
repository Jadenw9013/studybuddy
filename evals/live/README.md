# Live-provider evaluation

This suite never substitutes fixture responses for Google account access. Run `pnpm eval:live` for a credential-presence and model-capability probe. `node evals/live/preflight.mjs --smoke` explicitly starts a short paid synthetic audio/tool probe when a key and listed model are available. It stores no audio and logs no content. A listing or provider-only smoke cannot establish a browser lesson; the full gates remain open and the command exits 2.

For the full evaluation, configure the paid project, a verified available `GEMINI_LIVE_MODEL`, an explicit current unit-price table, invite/SMTP, and durable quota storage. Start the web/API/worker, sign in, and open the lesson's live controls on the supported device. Use the same course/board in voice and text.

1. Start a 20-minute lesson. Mark microphone end-of-speech and have a reviewer mark the first meaningful audio. An audio packet alone does not establish a useful answer.
2. Ask why count and density differ. Request a chart, then mark the first correct visible revision. Keep both incorrect and missing chart outcomes in the denominator.
3. Interrupt a spoken answer, rapidly change ten bins to five, and confirm playback stops and late actions cannot overwrite the current board. Repeat the interruption suite 20 times across the specified slow-speaker and rapid-correction cases.
4. Select a window with the real browser chooser; ask about the selected frame; stop sharing and verify a delayed pointer cannot appear. Repeat on a second pilot OS. Synthetic CI media does not satisfy this step.
5. Force a reconnect after confirmed work. Check the goal, selected source, board and practice attempt. Verify no replayed tool or duplicate settlement, and that capture/edit grants require a new user action.
6. Pause and end. Check mic tracks, socket and paid work stop; inspect active seconds separately from provider usage during reconnect.

Collect the redacted operational JSONL events only: pseudonymous lesson/run/meter IDs, timestamps, turn epoch, provider/model/SDK revision, modality token totals, active seconds, frame count, and result codes. No source text, names, filenames, audio, screenshots or transcripts in telemetry. Provider usage records describe reported units and are not invoice totals. Price estimates need a versioned rate table and invoice reconciliation.

Write observed samples into `evals/live/results/` (ignored from source control), then run `node evals/live/summarize.mjs <events.jsonl>`. Reviewer marks `useful_audio`, `correct_visible_chart` and `playback_silence` are essential. Browser scheduling proxies are reported separately and never count as observed paint.

The full gate requires a real 20-minute provider session with interruption, frame question, tool execution and forced reconnect; 20 interruption trials; paired device/OS testing; and explicit unresolved-failure counts. Keep absent credentials, missing reviewers, missing hardware and billing reconciliation open.
