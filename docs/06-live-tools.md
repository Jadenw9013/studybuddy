# Live session, whiteboard and control contracts

## Realtime behavior

Start live from an explicit user action. Check audio output, request mic permission, and show when the mic is live. Stream mono PCM chunks (start with 20–40 ms, 16 kHz input; adapt to actual provider contract). Decode output at the sample rate advertised by the provider. Use echo cancellation where supported. Maintain a bounded playback buffer and a separate control channel/logical stream. Microphone frames may be binary on the same WS. Screen frames must never starve audio or action messages. A typed message can interrupt a spoken turn.

States: connecting → listening → speaking or waiting for evidence → listening. Paused releases mic/stream, stops paid work and clears playback. Reconnecting retains durable state, revokes grants and offers text. End revokes all current media and actions and returns to recap. Keep the first audible greeting short and meaningful. Use audio end-of-speech detection and user interruption events; tune on recordings of slow speakers and mid-thought pauses with consent. If someone needs longer pauses, expose push-to-talk/finish-turn. Audio echo from the tutor must not be interpreted as the student.

Every turn has a monotonic epoch. On local interruption or provider interruption, stop buffered playback immediately, invalidate pending model actions for that turn and ignore late frames/results. A per-turn guard applies before commit; an already committed edit remains in the audit history and can be undone. Mark played versus unplayed speech when possible. If alignment is unavailable, describe the last displayed step and ask where to resume. Never assume the student heard an entire generated paragraph.

Send the model a compact active state. Use context compression and session resumption where available. If provider resumption fails, open a new session seeded from the confirmed board, lesson goal and recent work, with visible reconnect status. Do not replay stale audio, duplicate tool actions or silently renew capture access. [Provider docs](11-evidence.md) specify model-dependent capabilities.

## Client and service interface

| Interface | Purpose |
|---|---|
| POST /api/courses, POST /api/courses/:id/uploads | Create the owned course and issue a short-lived private upload target. Finalization checks the object and enqueues ingestion exactly once. |
| GET /api/sources/:id/versions/:versionId/content | Authenticated source read with current course/owner and deletion checks. Support PDF byte ranges and return private, no-store responses. |
| POST /api/lessons, GET /api/lessons/:id | Start or resume a lesson. The snapshot returns confirmed board revision, active source, practice state and current entitlements. |
| POST /api/lessons/:id/messages | Same lesson for typed and spoken questions. Stream text, validated citation references, tool progress and completion. Require a stable client message ID on retry. |
| POST /api/lessons/:id/live-ticket, WS /live | Mint and consume a single-use lesson ticket. Distinguish audio buffers, transcripts, tutor-turn events, board revisions, student interrupts and error messages. Rejoin from last acknowledged revision. |
| POST /api/lessons/:id/actions, GET /api/lessons/:id/actions/:actionId | Submit an allowed student action or query its receipt, including after an ambiguous timeout. Validate auth, scope, target and revision before executing. |
| DELETE /api/sources/:id, DELETE /api/lessons/:id, DELETE /api/courses/:id, DELETE /api/account | Revoke access on acceptance and report purge progress. Return the same logical result for a retried deletion by the authorized actor. |

Use the student's authenticated session for HTTP. Validate origin and account scope on all mutation and stream handshakes. Expose a short, versioned error code and a student-readable message. Keep the model's tool interface internal. A browser client cannot manufacture a notebook approval or a provider-generated tool receipt.

## Action envelope

One shared discriminated union in packages/contracts drives JSON schemas, handlers, UI receipts and tests. Refuse unknown action names or extra operation types. Return reason codes usable by the UI. Model text cannot directly call DOM methods or construct a generic browser command.

~~~json
{
  "actionId": "a17",
  "sessionId": "lesson-1",
  "turnEpoch": 8,
  "type": "board.patch",
  "targetId": "hist-1",
  "expectedRevision": 4,
  "args": {"binCount": 2}
}
~~~

IDs above are readable fixture aliases. Receipt example: action a17, status rendered, object hist-1, revision 5, dataset scores-v1, edges [0,20,40], counts [5,5], observation count 10. Persist a commit before broadcasting. The client acknowledges paint separately; if it never renders, distinguish “saved” from “shown.” Send the model a small verified receipt. Treat client-provided facts as session input, never authorization.

| Operation | Preconditions | Result / failure |
|---|---|---|
| course.search / source.open | Owned linked course, permitted source/version; source-specific claim needs evidence | Ranked locators, excerpt and visible source. Missing/ambiguous is an explicit result. |
| board.create / patch / undo | Allowed typed primitive, known dataset/units, finite numeric values, matching turn and revision | Computed board spec and revision; client receipt. Undo uses inverse of a known revision and checks subsequent edits. |
| screen.point | Active capture ID and latest frame revision or explicit student region | Pointer inside the shared preview. A stale frame requires a new selection. |
| practice.present / practice.record | Model may request a variant. Only authenticated student input or an attributed, confirmed spoken answer can be recorded. Rubric and grading remain server-owned. | Record the first attempt idempotently with hint history. The model cannot write its own grade or fabricate an answer. |
| notebook.focus / highlight | Fresh pair + watch/point grant; notebook and cell still match | Move to a cell in the paired notebook or highlight text; local completion or target_changed. |
| notebook.propose / apply | Paired instance; correct cell ID and base source hash; limited text diff. Apply is initiated by the student's local approval, never by a model tool alone. | Preview first. Single-use timed token authorizes exactly the displayed patch. Return new revision/hash or conflict, revoked or expired. |
| illustration.generate | Optional flag, budget and explicit pedagogical use | Asynchronous result tied to turn; failure leaves the board intact. Explicitly label generated imagery. |

**No-commit outcomes:** unauthorized, target_changed, stale_turn, stale_revision, invalid_params, insufficient_evidence, unsupported, quota_exhausted. Distinguish provider timeout/unavailable from bad user input. Do not retry writes by inventing new action IDs. For the same actor, authorized lesson, action ID and canonical payload, return the original receipt without another mutation. A different payload under that ID is a conflict. Recheck authorization before revealing any prior receipt.

## Screen sharing and optional external control

Offer window/tab selection via getDisplayMedia on a user gesture, default to no system audio. Provide click-to-select region, keyboard alternative and paste-image fallback. Sample a crop when asked or on meaningful change; start with at most one downscaled frame/second, configured by actual provider support. Show the exact visible capture surface. Clear pending frames and release tracks on stop, browser-level capture ended, pause, logout or session end. Call cleanup explicitly when the app stops tracks. If content changes, request a fresh frame rather than guessing coordinates.

JupyterLab companion: a student opens the extension panel, pairs with a short-lived single-use code supplied by the signed-in web lesson and sees the course name and approved scope. Use a random high-entropy pairing secret or rate-limited code exchange; store only a digest. The companion initiates outbound TLS to the service, shows a local Stop button and exposes only the active paired notebook. No remote debugging port. Use the active cell/document model, selection and collaborative source revision; update through the host editor transaction so native undo works. Explicitly validate JupyterLab version in an integration fixture. If institution policy blocks install, stay in shared-preview mode.

The tutor may request “Show one edit?”; the student can instead ask for a hint. Dismissing or doing nothing makes no change. Scope grants to a lesson, notebook, time and action type; expire on stop, reconnect or document switch. Support pointing, navigating among notebook cells and proposing text only. Run cell, shell, drive keyboard, arbitrary clicks, open URL, submit and filesystem access are outside this adapter. Student can run their notebook normally. Never promise undo of independently executed code.

## Numerical rendering contract

For a histogram with explicit edges, bins are left-closed and right-open, except the rightmost bin includes the final edge. Validate increasing edges. Count finite eligible observations, report missing/excluded/out-of-range totals. For the pilot use the in-range sample count as denominator and disclose any range filter. Density in bin i = count_i / (included_n × bin_width_i). Area sum is 1 within tolerance when included_n > 0. Do not use a KDE as a histogram. For an exact binCount of k, generate k intervals using k + 1 explicit edges; “max bins” is not exact. Define empty, constant and zero-variance cases; ask or show a clear special state instead of dividing by zero.

Regression uses paired finite x/y observations with documented exclusion count; display slope/intercept, units and domain. Report undefined fit for zero x variance. Conditional probability uses a labeled 2×2 table or tree with a clear conditioning group and a zero-denominator handling path. Use small deterministic chart, equation and diagram objects, not LLM-generated pixel graphs. On edits preserve axes, selection and source provenance where still valid.

## Rules for reliable calculations and edits

- Compute linear regression from centered sums or a tested stable online equivalent. Predict near the mean as meanY + slope × (x − meanX). Distinguish truly constant x from cancellation. A large-offset fixture and histogram endpoints are in [evaluation](09-evaluation.md).
- Start with direct bin counting on the current dataset version. Retain a disposable sorted index for repeated bin changes only if actual device traces justify it. Preserve explicit edges and final-edge inclusion, including for unequal widths. Always handle nonfinite values and out-of-range rows explicitly.
- Map screen pointers through the actual content rectangle, crop and frame revision. Ignore clicks in letterboxing. Drop the previous marker when capture or geometry changes so a slow response cannot point at newly scrolled content.
- Apply an approved Jupyter text patch as one local editor transaction with a scope, document identity, cell ID, base hash/revision and expected result hash. If acknowledgement is lost, query the local action receipt and document state. With insufficient evidence, show “Check your cell”; never replay automatically. Undo uses the recorded inverse only when its preconditions still match. Keep student changes intact after a conflict.
- The model sees only operations available to this state. Exclude notebook.apply and practice.record from model-callable tools. Exclude illustration.generate entirely while its option is off. A browser paint receipt identifies the session, board revision and renderer. A saved or mounted object alone is insufficient evidence that the learner saw it.
