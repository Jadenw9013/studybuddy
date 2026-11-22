# Current workflow and verification

Voice continuity after multiple uploads is covered by the [long-response regression and correction](voice-continuity.md). Refresh the browser after updating the app to load the corrected audio player.

The November 20 redesign uses a conversation-first workspace and graphite/blue palette. [Research and design decisions](experience-v3.md) distinguish the user's requested art direction from measurable accessibility criteria. Original revision-2 handoff files remain byte-for-byte intact.

## Run locally

From `C:\Dev\StudyBuddy`:

```powershell
pnpm install --frozen-lockfile
pnpm run setup
pnpm db:start
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000. The existing private `.env` uses the user's requested local sign-in bypass. Google sign-in is deferred. The bypass requires development mode, loopback services and an existing local development profile; production and remote bypass settings are rejected.

There is a separate idempotent local development allowance:

```powershell
node --import tsx scripts/dev-allowance.mjs
```

It adds 30 minutes once to the explicitly configured local profile, preserves prior usage and every provider cost limit, and creates no purchase. Repeating it does not refill the allowance. It cannot run against a production/public configuration. It has already been applied to this local workspace.

## Shortest demo

1. Attach a PDF, notebook or CSV from the composer. A private course and lesson are created automatically; ready files remain usable while other files process.
2. In **Workspace → Materials**, choose a notebook and **Ask about this cell**. Notes render as Markdown and accessible math; code stays read-only. Ask for an explanation and a visual using the actual assignment values.
3. For a quick numerical example, ask: `Draw u = [2,2] and v = [-1,3], and explain the projection of u onto v.` The checked dot product is 4 and the projection is [-0.4,1.2]. Change coordinates, apply, undo and reload.
4. Use a citation to open its exact PDF page or notebook cell excerpt. For the supplied statistics course, ask why a histogram peaks at 3 versus 0.03, change the existing chart to five bins, then record an independent attempt in **Practice**.
5. Select **Voice** beside the composer. Interrupt or stop at any time. Voice and text share the saved lesson and visual revisions. **Screen & notebook tools** contains explicit window sharing, frame selection and JupyterLab pairing; notebook changes still require local Apply.
6. **Visuals → Optional illustrations** runs the configured FLUX.2 klein 9B image generator after an explicit Generate action. Illustrations are labeled AI generated. Numeric charts and vector geometry use trusted calculations and SVG/Vega rendering.

## Repeatable checks

```powershell
pnpm verify:handoff
pnpm typecheck
pnpm test
pnpm db:test
pnpm test:e2e
pnpm build
```

Stop the live app before `test:e2e`: that suite starts an isolated fixture app and rejects reuse of a paid/live server. Fixture tests never count as provider acceptance.

Explicit paid probes, against the already running live app:

```powershell
node evals/live/provider-readiness.mjs --smoke
$env:RUN_PAID_TUTOR_BROWSER='true'
pnpm eval:tutor:browser
$env:RUN_PAID_VOICE_BROWSER='true'
pnpm eval:voice:browser
```

Paid browser probes retain all runs, have bounded durations and reviewed attempt caps. An exhausted cap requires reviewing the existing evidence before changing it. They do not run in ordinary CI. The Gemini SDK URL correction is a reproducible pinned pnpm patch, covered by a no-network regression; a frozen install reapplies it.

## Evidence and remaining gates

- All 15 manifest files match revision 2; the supplied ZIP checksum matches exactly. The new palette and interaction decision is recorded separately.
- Fourteen fixture browser journeys pass, including original/unseen uploads, exact PDF page 2, five-bin chart identity, independent attempt/reload, source deletion, keyboard citation focus, image failure/cancel/unsafe-URL denial, rendered linear algebra notebooks, vector coordinate/keyboard edits, undo, mobile reflow and delayed cross-conversation requests. Tested mobile views have no axe violations and tested primary controls meet 44px targets. This is not full accessibility certification.
- Real voice provider smoke returned audio and a trusted tool call. The final real browser voice probe passed exact vector calculation/render receipt, AudioContext playback scheduling, interruption, authorized synthetic frame forwarding and forced reconnect with board preservation. The browser microphone was synthetic silence; no human conversation was claimed.
- The final voice browser run observed 1,438 ms to the checked visible chart proxy, 2,083 ms to the first audio packet and 2,084 ms to audio scheduling. These are one-run proxies, not first useful audio, a latency percentile or human interruption latency. Earlier failed runs remain in the evidence: no local minutes, then an incorrect telemetry lookup.
- Three real Gemini text browser journeys pass: ordinary original/unseen uploads, exact PDF citation, five-bin edits and independent attempts, plus uploaded notebook vectors with coordinate edit/undo/reload. All 167 unit/contract/parser checks pass. Earlier SDK counting and incomplete structured-output failures are retained in the live probe history. See [current acceptance](acceptance-v3.md).

Open release gates include a real 20-minute lesson, reviewer-marked useful audio/accuracy and interruption trials, real window chooser/device/screen-reader checks, instructor review, pilot learning evidence, external authentication/Google sign-in, deployment/backup/payment acceptance and invoice reconciliation. Completed local JupyterLab automation does not substitute for human approval testing.
