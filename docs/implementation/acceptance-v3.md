# November 20, 2026 workflow acceptance

The conversation-first tutor is implemented. This report separates checked local behavior, real provider evidence, and release gates requiring people or devices. [Run commands and shortest demo](workflow.md); [research and design plan](experience-v3.md).

**Subsequent voice correction:** the learner's six-file session exposed a five-second playback-buffer interruption loop missed by the short voice probe. The [continuity correction and longer real-provider regression](voice-continuity.md) passed: 13.77 seconds of audio completed with a 12.041-second queue and zero automatic restarts. The full deterministic suite now passes **181/181**. Original measurements below remain historical observations.

## What changed

- Graphite/blue interface, central conversation and reachable composer, responsive course/history navigation, and an adjacent Materials/Visuals/Practice workspace. Advanced screen sharing, pairing and illustration settings are secondary tools.
- Direct attachments create a private course/lesson. Ready files remain usable while other attachments process. Upload buffers survive input resets, and asynchronous requests cannot redirect or overwrite a newer conversation.
- Notebook notes render safely as Markdown and LaTeX/MathML, one source cell at a time. Code stays read-only; selecting a cell adds explicit question context. Source citations open the authenticated exact page/cell excerpt.
- Broad course-aware Gemini tutoring with bounded history and source context. A model proposes a typed visual action; trusted code validates actual operands and calculates the result; a separately metered second call explains confirmed facts. Partial/invalid/truncated responses cannot become published explanations.
- Checked vector dot product, norms, angle, orthogonal projection/residual, SVG geometry and numeric/keyboard controls join the existing histogram, regression and probability tools. Revisions, undo, immutable attempt evidence and reload persist. Unsupported or missing data produces a clear state.
- Real voice shares lesson/board state with text, streams audio/captions, stops local playback on interruption and recovers from reconnect. Bounded usage and pricing remain enforced. A reproducible SDK URL patch and actual SDK serialization regressions fix the integration errors found in real testing.
- Optional hosted FLUX.2 klein 9B illustrations remain explicitly generated and labeled separately from numerical plots. Google sign-in remains deferred at the user's request; local testing skips authentication.

## Verified results

| Check | Observed result | Limits |
|---|---|---|
| Revision integrity | 15/15 manifest files exact; ZIP SHA-256 `3079fa9efdc074aef62673a5d8bf8a5a56ab7abb3c1957328d8bc6877746b646` | Design change documented separately; canonical files preserved |
| Unit/contract/parser checks | 167/167 passed: 141 TypeScript/component checks, 3 collector, 11 companion authority, 9 Python parser, 3 embedding contracts | Deterministic and injected-provider tests are fixtures |
| Local Postgres | Four SQL suites passed, migration 005 applied | Actual local RLS, scope, immutable receipts, purge and vector-kind constraints; not deployed staging |
| Browser regression | 14/14 passed in 50.6 seconds; `.data/redesign-browser-verified.log` | Fixture provider mode; includes delayed creation and cross-conversation success/error races |
| Real Gemini text browser | 3/3 final cases passed: original, unseen and uploaded vector notebook | Original synthetic course data, no human participants; 10 actual metered calls across final runs |
| Real Gemini voice browser | 1/1 final probe passed | Actual relay, provider, Chrome AudioWorklet/AudioContext and typed tools; synthetic silent microphone |
| Mobile/accessibility | 360px reflow, keyboard operations, source focus return, 44px tested primary controls, no axe violations in tested views | Real assistive technology, zoom and human usability remain open |
| Production web build/types | Build and type checks passed | Local bundle, not deployment acceptance |

The real text cases uploaded ordinary files, obtained a real Gemini answer, opened PDF physical page 2, retained chart identity when switching to five bins, recorded independent numeric/reasoning attempts and resumed after reload. This passed on both the original and renamed unseen dataset. The vector case used an uploaded notebook, computed `[2,2] · [-1,3] = 4` and projection `[-0.4,1.2]`, edited coordinates, undid and resumed the same board. Its explanation rendered math, and its inputs matched the uploaded notebook values. Synthetic courses were removed after all final runs.

The real voice case produced requested vectors `[3,1]` and `[1,2]`, dot product 5 and projection `[1,2]`, authenticated the render receipt, scheduled real provider audio, interrupted, forwarded an explicitly authorized synthetic PNG, forced a separate reconnect and preserved board identity/revision while revoking capture.

## Measurements and failed attempts

These are individual proxies, not latency percentiles or useful-answer judgments:

- Provider-only voice smoke: first audio packet 1,198 ms, 11 packets / 117,600 bytes, one trusted tool call, 4,792 ms total.
- Final browser voice: click-to-checked-chart/paint proxy 1,438 ms; first audio packet 2,083 ms; first audio scheduling 2,084 ms; 6 packets scheduled. No reviewer-marked first useful audio or human interruption latency.
- Final text browser first checked visual proxies: original 12,304 ms; unseen 16,859 ms; vectors 13,765 ms. These include the verified response cycle. No sub-two-second text claim.

All earlier failed paid-probe attempts remain retained. Text first failed before generation on an unsupported SDK token-count configuration, then failed on incomplete structured output or overly broad visual schemas; concrete fixes preceded the final three passing runs. Voice first failed because local development minutes were zero, then reached chart/audio/interruption but failed an incorrect telemetry lookup; the corrected third run passed. Attempts were bounded and the final extra attempt explicitly reviewed, rather than silently retried. Historical fixture-harness failures (selector, omitted Origin and framework route-announcer assertions) are distinct from product/provider failures. The direct attachment FileList race was a real product issue and is fixed.

A one-time 30-minute development allowance was added to the configured loopback profile with `scripts/dev-allowance.mjs`. It preserves usage, holds and all provider spend ceilings, does not create a purchase, and cannot run in production/public mode. Provider modality omissions are retained and conservatively provisioned at reviewed upper-bound rates when bounded; unknown/unbounded usage still blocks. Costs remain estimates pending invoice reconciliation.

## Milestone status and open gates

M0–M6 implementation and independent local checks are present. Their full release exits are **not all closed**:

- **M0 / M3:** short real provider/browser voice feasibility passes. A real 20-minute lesson, participant-marked useful audio, 20 interruption trials, two-device/OS evidence and latency distributions remain open.
- **M1:** original and unseen ordinary uploads, real text tutoring, exact citations, computed chart edits and persistence pass locally.
- **M2:** state, direct explanations, reviewed practice/hints/attempt/recap and quiet mode work. Instructor-reviewed teaching quality, held-out support accuracy and pilot learning evidence remain open. Reviewed automated practice currently covers the original three statistics topics, not arbitrary uploaded assignments.
- **M4:** responsive/keyboard/axe checks and synthetic authorized frame forwarding pass. Real browser chooser/Stop, screen-question accuracy, screen-reader and deployment checks remain open.
- **M5:** previously recorded actual JupyterLab host automation passes 18/18, including local Apply/reject and lost acknowledgement. A human local-approval trial remains open. Uploaded snapshots do not permit execution or edits.
- **M6:** contracts, controls, deletion, usage and local reports are implemented. External auth/Google sign-in, staging/backup/restore, payment/refund checks, invoice reconciliation, instructor review and the pilot cohort remain open. Local sign-in bypass is a testing convenience, not authenticated pilot acceptance.

This is a working local product handoff with real text/voice integration evidence, not a claim of pilot readiness or full accessibility certification.
