# DSA voice dataset switching

This follow-up fixes connection identity, follow-up context and step-navigation failures found in real Gemini voice trials. The original DSA notebook and all five uploaded mock sources remain in place.

## Changes

- Provider call IDs are scoped to their connection. Gateway actions, pending work, cancellations and replayed receipts cannot collide with an earlier connection using the same raw ID. A repeated delivery on one connection returns its original receipt without another mutation.
- A typed follow-up and its bounded confirmed lesson snapshot travel in one realtime message after reconnect. The raw learner request remains separate for validation. Restoring a connection does not start a spoken recap.
- A connection whose confirmed snapshot already contains a board omits `board.create`; replacement, patch and undo remain available. Empty-board startup can still create. If an initially empty connection later attempts another create, it receives explicit replacement guidance without converting that request into an edit. This final correction has deterministic coverage but has not received another paid observation.
- Unambiguous next, previous and restart requests refer to the current DSA source, algorithm and search target. A shared intent helper computes only the requested step index; independent relay and gateway checks reject a source change, algorithm change or skipped step for that request. Explicit requests for a different dataset, algorithm or target retain the general tools.
- Model context includes the current computed step and the next step's index. It excludes future step details and the complete computed traversal path. Ready states explicitly identify that no node has been visited or compared. The renderer and manual controls retain the complete trusted computation.
- Successful visual mutations wait for the exact authenticated paint receipt before the model receives a `shown` result. Existing epoch, revision, cancellation and one-successful-mutation-per-learner-turn checks remain in force.
- Local diagnostic mode is opt-in through `VOICE_TOOL_DIAGNOSTICS=true`. It exposes typed failure categories and bounded field/type diagnostics, without raw tool arguments or source contents. Normal startup leaves it off.

## Test scope

`evals/live/dsa-switching.spec.ts` uses a new conversation inside the existing DSA notebook, with only the five byte-hash-verified mock sources selected. It exercises BFS ready, BFS next, DFS ready, spoken binary-tree inorder, spoken BST search for 7, and four requested search steps. It checks exact source versions, a stable board identity, current node/frontier, paint before tool completion, post-receipt real provider PCM, natural playback drain, absence of unsolicited advancement, and a reachable mobile Stop control.

The two source-switch questions use offline Windows speech injected through the real audio-input path. They are synthetic speech, not a human microphone measurement. The test retains failed observations, deletes only its failed new conversations and retains a passing conversation for inspection. Its history is separate from the four earlier failures in `evals/live/results/dsa-voice.json`.

Observed acceptance results are recorded in `evals/results/dsa-voice-switching.json`. The bounded raw switching history is `evals/live/results/dsa-switching.json`. Storage preservation evidence is `evals/results/dsa-switching-storage.json`.

## Current result: live journey still open

The user approved the exact allowance change and one additional bounded test. The allowance is now **160,000 live input text tokens**, with the **$7.60 application ceiling unchanged**. The maintenance verified that every other environment byte, all old reservations, spending, lesson time and normalized usage records were preserved; only the reviewed pass pause was cleared. No balance or minutes were refilled.

That approved test, history **run 6**, completed BFS ready, BFS step one and DFS ready with matching painted visuals, post-receipt PCM and naturally drained playback. It failed at the spoken binary-tree request: the provider selected the correct source and inorder algorithm but called `board.create` twice while a board existed. Both edits were denied, the saved DFS diagram was preserved and the session stopped at its two-failure limit. No tree/BST explanation was published, and BST/search/mobile Stop checks were not reached. This was not another allowance failure.

The final tool-registry correction described above removes the invalid creation option for connections that already have a board and supplies explicit operation guidance. Its deterministic regressions pass. **Live confirmation of that final correction and the full nine-turn journey remain open.** The one approved additional provider test has been used; there were no further paid retries. The original lesson board and all source versions remain intact.

## Earlier scoped observations

Before the approved extension, run 5 completed **five of nine planned turns**: BFS ready, requested BFS step one, DFS ready, spoken binary-tree inorder and spoken BST search ready. Both spoken dataset switches completed with the exact source/version, a painted visual, real provider PCM and naturally drained playback. A sixth turn correctly painted BST search step one, kept target 7 and narrated the comparison at 8 with 3 next; it was interrupted by the configured usage limit before natural completion. The final three search turns did not run. These scoped observations do not establish repeatable full-journey acceptance.

An independent implementation-agent review compared every tutor caption in those six turns to its actual paint revision, current node and frontier. All matched. The ready-state BST explanation explicitly said no node had been visited or compared and called 8 the next candidate. No conceptual explanation preceded its matching paint. Three recoverable typed tool rejections were corrected before the corresponding saved visuals; their records remain visible in the history. These observations use synthetic speech and do not establish human audibility or independent instructor approval.

The read-only budget audit identified the earlier **80,000 input-text-token limit per reservation**, spanning reconnects. The last event provisioned 6,928 text tokens, taking the accumulated total from 76,122 to 83,050. Settlement occurred once, all 15 unique observations matched, and the $7.60 application financial ceiling was not exceeded. The stopped session's conservative application estimate is $0.1558275. See [the approved allowance review](dsa-voice-budget-review.md). Raw numeric audits and maintenance evidence remain local under `evals/live/results/`; provider invoice reconciliation remains open.

The earlier **274/274 automated checks**, **25/25 fixture browser cases**, **8/8 affected journey reruns**, seven Postgres suites, type checking, production build and 15 canonical handoff hashes passed. The final registry correction has **20/20 relay regressions**. Current totals and final build results are recorded in `evals/acceptance/current.json`. Fixture checks remain separate from live observations. All four provider attempts and two infrastructure preflights are retained locally; none completed all nine turns. Failed test conversations were deleted; the original notebook board and source versions were preserved.

## Run and shortest demo

From `C:\Dev\StudyBuddy`:

```powershell
pnpm db:start
pnpm dev
```

Open <http://localhost:3000/lessons/509a2601-41e4-45c2-96b5-2ac97f26b4f9>. Start Voice, then ask: “Show BFS on the undirected graph at step zero,” “Next step,” “Switch to DFS,” “Show the binary tree using inorder,” and “Search the BST for 7.” Ask for each next step to follow 8 → 3 → 6 → 7. The first item is the ready state; the first comparison appears after the next-step request.

Repeatable independent checks:

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm db:test
# Stop the live development server before the fixture browser suite:
pnpm test:e2e
```

To recreate synthetic audio locally, use `powershell.exe -ExecutionPolicy Bypass -File scripts/generate-dsa-switching-audio.ps1`. The paid browser probe requires an explicit numbered review, a concrete reason and a concrete fix before a provider retry. It has no automatic retries and a 120-second voice cap. Its original three attempts and the user's one explicitly approved extension have been used; the local probe rejects further runs. Infrastructure-only preflights remain in its history and do not count as provider measurements.

Human microphone/device audibility, human interruption timing, a 20-minute participant lesson, independent instructor review and invoice reconciliation remain separate open gates.
