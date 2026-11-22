# Voice feasibility: implementation evidence and open gates

Observed on November 15, 2026 (America/Los_Angeles). This is M0 engineering evidence, not a successful live-provider evaluation.

Update November 20: a credential is now configured, both exact 3.8 model IDs/methods are account-verified, and reviewed cost controls are installed. After a reproducible SDK endpoint repair, the latest real Live provider probe passed: first audio packet 1,198 ms, 11 packets / 117,600 bytes, one trusted tool call, 4,792 ms total. Latest Flash text probe passed in 1,463 ms (6 input / 1 output token). These are synthetic provider probes without microphone/browser playback/human participation. See [voice readiness](voice-readiness.md) for failures, bounded cost estimates and the separate paid browser suite. The original no-credential observation below is historical. Real device, useful-audio and twenty-minute lesson gates remain open.

## Observed result

The initial project/environment inspection found no configured Gemini or Google API credential names and no project `.env` file. Secret values were never printed. `node evals/live/preflight.mjs` reported `credentialPresent: false` and exited with code 2, keeping all live gates open.

| Measurement | Observed | Required / next evidence |
|---|---:|---|
| Completed real-provider lessons | 0 | At least 1 production-like lesson lasting 1,200 seconds |
| Real-provider active seconds | 0 | 1,200-second lesson with short corrections |
| First useful audio | Unmeasured | Speech end to reviewer-marked substantive answer |
| First correct visible chart | Unmeasured | Speech end to observed correct chart revision |
| Interruption latency | 0 trials | At least 20 real trials; 19 within 300 ms |
| Screen-frame questions | 0 | Real selected capture frame, then stop/revocation |
| Provider chart calls | 0 | Real typed tool call and render receipt |
| Forced reconnects | 0 | Resume confirmed lesson without duplicate effects |
| Provider usage / invoice cost | Unmeasured | Per-turn usage and versioned rate table; invoice reconciliation |
| Actual browser/device/network | Not exercised by this subtask | Record browser version, OS, mic/output device, network and cold/warm status |

The handoff candidates remain `gemini-3.8-live` and `gemini-3.8-flash`. The required Google skill was read from `.agents/skills/gemini-live-api-dev/SKILL.md`, pinned to revision `87fb0173d36fea4f87de4c3fbd0678cf929c0588`, including its migration reference. Google's current AI Studio documentation index and Live tools/session pages also describe 3.8, while older indexed `ai.google.dev` examples describe prior models. These documents do not establish availability for this account. The model-list preflight checks the configured IDs once a credential is present. No model is silently substituted. Listed access alone cannot prove audio, tools, teaching or price. Deployment/account terms and billing remain owner-reviewed gates.

## Implemented integration

`apps/api/src/voice.ts` exports `registerVoice(app, deps)` for the Fastify service. It registers the WebSocket plugin and these routes:

- `POST /api/lessons/:id/live-ticket`: authenticated lesson scope, exact Origin, provider kill switch; 30-second HMAC-signed, single-use opaque ticket.
- `WS /live?ticket=...`: consumes the ticket, checks Origin, prevents concurrent live sessions for a learner in one replica, reserves usage before connecting, and starts the server-only Google SDK connection.

The adapter requires app-owned authorization, snapshot, epoch, trusted-tool, reservation, interruption and exactly-once settlement callbacks. Those callbacks are the shared authorization/persistence boundary, rather than a second store hidden in the voice service. The pilot is intentionally one regional replica; multi-replica admission/tickets need a shared atomic store before scaling.

Only app-owned function declarations are exposed. The gateway still checks actor, source/course, target, revision, epoch and idempotency. No model-facing notebook Apply tool exists. Frame submission fails closed without an app callback approving the active capture/frame. The relay never accepts a client-provided grade, trusted receipt or authorization decision.

Epoch invalidation drops canceled/late tool responses. Local explicit interruption closes the old provider generation and seeds a fresh one from confirmed state. Provider barge-in clears output and invalidates actions while preserving ordered provider input. Reconnect revokes grants, tries the provider resumption handle, then makes one fallback connection from confirmed state. Audio and pending actions are never replayed. These are implementation behaviors awaiting real-device measurement; provider behavior cannot be established by reading the code.

The relay has bounded payloads/output backpressure, at most one image per second, compression, input/output captions, 5-second reservation heartbeat, 20-second abandoned-client cutoff, two-minute/30-second warnings, a 20-minute maximum and a kill-switch callback. Pause/end closes paid work and settlement is by reservation ID. Settlement failures emit a redacted pending-meter error for reconciliation. Shutdown/abandonment and restart reconciliation also require the persistent reservation implementation.

`apps/web/public/audio/capture-worklet.js` supplies trusted PCM16 mono capture with persistent resampling to 16 kHz and 20 ms chunks. `apps/web/components/live.ts` requests a ticket before prompting for mic access, so an unavailable provider cannot open the microphone. It stops late-arriving tracks after canceled permission prompts, refreshes expired tickets, sends bounded binary PCM, decodes the provider-advertised sample rate, bounds queued playback, clears playback locally on interruption, and rejects earlier epochs. One bounded transport reconnect reloads confirmed state without replaying media. Stop/end/pagehide tears down worklet, mic, socket, playback and AudioContext. These lifecycle branches are tested synthetically; real microphone/playback and browser chooser evidence remain open.

## Reproduce and close the gates

1. Configure the paid API key, explicit model IDs, long random ticket signing key, authorized origin, database-backed usage and kill switch. Start the app with provider mode; fixture voice is unavailable rather than fabricated.
2. Run `node evals/live/preflight.mjs`. Use `node evals/live/preflight.mjs --smoke` for an explicitly paid short audio/tool smoke after the model is listed. It stores no audio. Both exit 2 while the full live gates remain open; neither listing nor a provider-only smoke counts as a browser lesson.
3. Follow `evals/live/README.md` in a real browser with a reviewer, actual mic/output, selected screen and forced reconnect. Preserve redacted operational events locally, not source/media payloads.
4. Run `node evals/live/summarize.mjs <events.jsonl>`. It refuses explicitly marked fixture events, counts missing/failed observations in denominators, distinguishes actual observed marks from scheduling proxies and deduplicates usage IDs.
5. Attach the observed result and unresolved failures to the release report. Repeat the specified interruption/device/teaching samples and reconcile usage against the provider invoice before enabling paid tutoring.

Official references consulted: [AI Studio documentation index](https://aistudio.google.com/llms.txt), [current session management](https://aistudio.google.com/docs/live-api/session-management.md), [current Live tools](https://aistudio.google.com/docs/live-api/tools.md), [Google SDK Live session interface](https://googleapis.github.io/js-genai/release_docs/classes/live.Session.html), [WebSocket contract](https://ai.google.dev/api/live), [SDK source types](https://github.com/googleapis/js-genai/blob/main/src/types.ts). Implementation references are not measured account capabilities.

## Independent checks completed

With `@google/genai 3.3.0`, `@fastify/websocket 11.3.7`, and Fastify `5.12.8`, the relay and integrated client passed strict TypeScript checking. Six relay tests passed, covering unavailable provider, Origin denial, ticket replay, delayed versus current actions, dynamic tool discovery, revoked frame, forged paint assertion, usage-triggered budget stop, exactly-once settlement, and transcript retention both off and explicitly opted in. The injected connector is rejected outside `NODE_ENV=test` and labels every resulting WS/metric event `fixture: true`.

Four client lifecycle tests passed: no mic request on provider outage, cancellation while permission is pending, immediate local silence with stale-audio rejection, and one bounded transport retry followed by track/output cleanup. Three collector tests passed: failed/missing-response denominators, usage deduplication without invented cost, and fixture rejection. These 13 tests are engineering tests, not live measurements. The in-process WebSocket test harness leaves close timers for approximately 30 seconds; the test process exits successfully after those timers, without a paid connection.

Commands: `pnpm exec tsx --test evals/live/relay.test.ts evals/live/client.test.ts`, `node --test evals/live/summarize.test.mjs`, and `pnpm typecheck`. Default `pnpm eval:live` makes no paid generation request. The optional `--smoke` probe requires a configured key and model access and remains explicitly separate from a 20-minute browser lesson.

## Metering and telemetry integration

`apps/api/src/meter.ts` contains pure reservation/usage helpers; callers execute them inside the owner's locked Store transaction. There is no network or provider I/O inside these helpers. `MODEL_UNIT_PRICES_JSON` must contain a version, `currency: "USD"`, and model-specific `input`, `output`, and optional `cachedInput` prices for TEXT/AUDIO/IMAGE in USD per million tokens. No vendor prices are embedded. `MODEL_UNIT_LIMITS_JSON` contains explicit `text` and/or `live` unit ceilings, each with input/output/cachedInput counts for all three modalities. Missing prices or ceilings block paid admission. Prices are pinned into each reservation so changing the rate table cannot reprice work in progress.

The operation sequence is `reconcileStale` → `reserveLive` or `reserveTextTurn` → `addUsage` as usage arrives → `settleLive` or `settleTextTurn`. `usageAllowed` on the relay lets the server persist each provider event and stop paid work before forwarding further outputs when the budget is denied. Usage IDs and settlement IDs deduplicate. A different payload under the same ID blocks work rather than losing the conflicting billing evidence. The text allowance counts unique turns in explicit UTC days and survives retries. `beginMeterPass` supports a new unique payment fulfillment without erasing the previous pass ledger.

Unknown mixed-modality cached attribution, missing provider usage, or an abandoned lease keeps cost unknown and blocks further paid work pending reconciliation. A stale reservation conservatively consumes its held time and preserves its remaining cost provision; that provision is not an observed provider invoice or fabricated usage. Known settlement returns unused seconds once. Pure helpers cannot make a provider's delayed usage reporting instantaneous: configure compatible output/context/media bounds, project budget controls and a kill switch, verify them in the paid session, and include in-flight overruns and invoice reconciliation in the remaining live gate. Provider token estimates alone do not include processing fees, ingestion or hosting and cannot establish the complete $7.60 variable-cost gate.

`apps/api/src/metrics.ts` writes only allowlisted primitive operational fields. IDs are hashed, unknown codes become `other`, unknown keys and nested media/text are dropped, and a missing fixture label defaults to fixture. Concurrent writes serialize into intact JSONL records. The server passes this writer into the relay and flushes it on shutdown; it must never pass a provider's raw error/prompt/content payload to a different logger.

Fourteen synthetic meter tests and three metrics tests passed. They cover unknown pricing/usage, cached attribution, duplicate/altered requests, shared pass holds, seconds/usage settlement, stale reservation recovery, daily text quotas, rate pinning, unit ceilings, prior-pass preservation, 28-day expiry and refund/renewal boundaries, and redaction/concurrent writes. Fulfillment creates its budget once inside the same transaction, and the typed entitlement projection records its actual dates. Run `pnpm exec tsx --test apps/api/test/meter.test.ts apps/api/test/metrics.test.ts`. Their prices are arbitrary unit-test arithmetic, not current vendor prices or live cost evidence.

The server supplies a `recordTurn` callback and the settings view offers an explicit opt-in to save completed live captions. Persistence checks `profile.retention.liveTranscript`, which defaults to false, and rechecks the current turn epoch. The relay bounds fragments, clears canceled/reconnected turns, supplies a stable turn ID, and marks playback `unknown`. Generated text is never proof the learner heard it, a confirmed learner answer, or an independent practice attempt. Confirmed board, goal, source and practice state supply durable continuity even when caption retention is off. Raw audio and screen frames are never persisted by this app.
