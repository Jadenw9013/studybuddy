# Voice continuity correction

The learner reported repeated mid-sentence restarts after importing six files. The affected 61.953-second session recorded 23 provider connections, 22 client-originated interruptions and 22 reconnects. It had no provider interruption or transport error events. No document text, filenames or transcripts were logged during diagnosis.

## Cause and changes

The browser treated more than five seconds of queued speech as an interruption. Gemini can generate speech faster than the browser plays it, so a normal burst repeatedly cancelled playback and reconnected. Fresh reconnects also requested a spoken recap, which restarted the explanation.

- Normal audio bursts now stay queued in order. Limits of 60 seconds and 4,096 chunks still bound memory; overflow stops visibly instead of looping through interruptions. Genuine learner/provider interruption clears playback immediately.
- Reconnect restores valid lesson context with `turnComplete:false` and waits for the learner. Only the initial connection requests an opening reply. Stale async provider callbacks cannot emit audio under a newer turn epoch.
- Every audio event formerly opened a write transaction and loaded the entire saved account/course aggregate. A small owner-scoped, RLS-protected normalized epoch lookup now checks revocation without aggregate loading, row locking, writes or caching. Tool mutations retain their transactional authorization checks.
- Live snapshots omit board history and full uploads, cap excerpts and preserve valid JSON within 18,000 characters. Larger unexpected input fails before provider work rather than slicing JSON. Verified pre-provider failures release their hold without inventing unknown billed work.

Google documents that `sendClientContent` with [turnComplete false waits for further input](https://googleapis.github.io/js-genai/release_docs/classes/live.Session.html#sendclientcontent). This recovery change does not replace learner permission or authorize replaying tools.

## Observed verification

- **181/181** unit/contract/component/parser checks passed, including an eight-second burst regression, playback bounds, genuine interruption, late provider callbacks, 25 large notebooks and strict context encoding.
- **7/7 real local Postgres checks** passed: cross-owner/missing/deleted state denial, committed epoch refresh, nonblocking read during a writer and no aggregate creation. Twenty sequential local lookups had p50 2.923 ms / p95 3.074 ms; these are database timings, not voice latency.
- Production build and type checking passed. Canonical handoff hashes remain intact.
- **1/1 new real Gemini/Chromium continuity test passed on its first run.** Six ordinary private uploads (three text files, three notebooks) went through actual ingestion. All **41 audio packets / 13.77 seconds** naturally completed; the real playback queue reached **12.041 seconds**, reproducing the old five-second trigger condition. There were **zero automatic interruption messages, reconnects or playback stops** before completion. The exact vector chart and revision remained intact.
- Explicit interruption then reconnected without replaying speech: a three-second observation contained zero extra audio packets. A new learner question triggered subsequent provider audio. Test course cleanup passed. The learner's original six ready uploads remained present.

Numeric evidence: `evals/live/results/voice-continuity.json` and `evals/results/lesson-epoch.json`. This uses a synthetic silent microphone and actual provider PCM/Chrome AudioContext scheduling; it does not establish human audibility, a 20-minute lesson, interruption percentiles or invoice totals.

## Reproduce

With local services and `pnpm dev` running:

```powershell
$env:RUN_PAID_VOICE_CONTINUITY='true'
pnpm exec playwright test --config evals/live/voice-continuity.playwright.config.ts
```

This is an explicitly paid, 60-second-bounded regression, separate from offline CI. Its passing first run is retained and the script prevents automatic repetition. Deterministic checks are included in `pnpm test`; the local database probe is `node --import tsx evals/db/lesson-epoch.ts`.
