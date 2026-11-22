# DSA playground acceptance

**Later voice follow-up:** earlier scoped trials observed spoken graph → binary-tree → BST switching, but the approved extra trial failed at a repeated create-on-existing-board request. A final registry correction has deterministic coverage and awaits live confirmation. The full nine-turn journey remains open. See [the current results](dsa-voice-switching.md); the older failures below remain historical evidence.

The local playground is a saved course with five ordinary private uploads: an undirected cyclic graph, a directed graph, a binary tree, a BST and a study guide. All five source hashes match `fixtures/dsa`; all are ready. The four structured datasets are explicitly marked as mock teaching data. The learner's earlier six ready sources remain present.

## Implemented behavior

Trusted code computes BFS, DFS, preorder, inorder, postorder and BST search. The SVG shows source nodes and relationships, the current node, visited sequence and queue, stack or recursion path. Next, previous and restart controls persist their step. Source changes use reversible board replacement. **Change data or visual** also permits manual switching without a provider request. Trees expand to avoid overlapping accepted nodes, including a 31-node skew tree; larger diagrams support scrolling and enlargement.

Text opens the computed visual before the grounded explanation completes. Voice waits for the matching paint receipt before receiving a shown result. Saved-lesson actions wait for their actual lesson and sources, preventing accidental blank conversations during loading. Live tools enforce one successful board mutation per learner turn, return typed error guidance for a correction, and stop after two failed attempts. A new learner utterance invalidates an older pending action without reopening the audio connection.

## Observed checks

- **225/225** unit, contract, component, collector, companion and worker checks passed: 195 TypeScript checks, 3 collector checks, 11 companion checks, 13 parser checks and 3 embedding checks.
- **21/21** fixture browser checks passed, including original and unseen upload journeys, DSA tree/search/undo, mobile keyboard and accessibility checks, manual source switching and delayed-load/retry regressions. Fixture tutor replies do not establish provider integration.
- **5/5** local SQL suites passed after migration `202611200006_dsa.sql` was applied.
- Production build and type checking passed. All 15 canonical revision-2 handoff files retain their manifest hashes.
- **1/1** normal-service playground browser check passed with provider endpoints blocked: five actual source hashes, BFS, manual inorder tree, BST search for 7, reload and restoration to initial BFS. No provider request occurred. The permanent playground was retained. Evidence: `evals/results/dsa-playground-browser.json` and its desktop/mobile screenshots.
- The reviewed real text browser run passed: two metered Gemini calls, exact owned DFS source/version, a painted diagram and four citations matching supplied passages. Paint acknowledgement was observed after 8.936 seconds; the completed reply after 16.425 seconds. These are one-run browser timing proxies. The initial failed test used the wrong shape for the recorded provider-call array; that failure remains in `evals/live/results/dsa-text.json`.

The real voice evidence and final gate status are recorded below. Paid histories retain failed attempts; deterministic fixture results are separate from provider measurements. No observation establishes a human learning outcome, real-microphone audibility, a 20-minute lesson or an invoice total.

### Earlier voice observations (historical)

Four individually reviewed, bounded real-provider attempts are retained in `evals/live/results/dsa-voice.json`. The first stopped at a test assumption about a permitted replacement operation; the second exposed the saved-lesson loading race. The third passed initial BFS, requested next step and DFS, but exposed unsolicited advancement and repeated rejected tree replacements. Those product defects received explicit loading, turn-budget and error-recovery fixes.

The fourth run observed the correct BFS graph, requested BFS step and DFS on the same source, each with matching paint, post-receipt provider PCM and naturally drained playback. Its final post-playback state stayed on the requested step: the unsolicited advancement was prevented. It still failed graph-to-binary-tree replacement; two rejected attempts produced `visual_retry_limit`, stopped the voice session and preserved DFS step zero. This is an unresolved live acceptance failure, not a passing voice journey. Manual switching to the tree/BST passed against actual storage, and the real text question passed independently. Use those controls while the voice cross-source gate remains open. No additional automatic paid retries are permitted by this probe.

After that observation, complete DSA-only lessons received a narrower Live schema: only DSA parameters, actual authorized source-ID enums and required kind/source/algorithm. Mixed data, incomplete context, paired notebooks and existing non-DSA boards retain the general tool schema. Four focused checks verified those branches and correct tree replacement against the gateway. This final request-format change has **not** received another paid live observation; it does not close the gate. DSA-only Live connections offer DSA visuals until their tools are rebuilt; the manual app controls still support other visual types.

Real microphone/device audibility, human interruption timing, a 20-minute participant lesson, instructor teaching-quality review and provider invoice reconciliation also remain open. The available voice observations use synthetic silent microphone input and actual provider audio, not a human conversation.

## Run and demo

From `C:\Dev\StudyBuddy`, with the existing local environment configured:

```powershell
pnpm db:start
pnpm db:migrate
pnpm dev
```

In a second terminal, `pnpm seed:dsa` imports or finds the mock files and prints the saved lesson URL. The current lesson is `http://localhost:3000/lessons/509a2601-41e4-45c2-96b5-2ac97f26b4f9`.

Ask **“Explain BFS on this graph, one displayed step at a time”**, then **“Next step”** and **“Switch to DFS on the same graph.”** Ask for the binary tree's inorder traversal or search the BST for 7 and then 5. Use **Change data or visual** to choose a specific source directly. Manual controls require no model call. Use **Voice** for the configured live provider.

Repeatable checks are `pnpm test`, `pnpm test:e2e`, `pnpm db:test`, and `pnpm exec playwright test --config evals/live/dsa-playground.playwright.config.ts`. Stop the live development app before the fixture browser suite. Paid text/voice probes are explicitly gated and preserve bounded run histories; ordinary CI never invokes them.

This increment supports imported graphs and binary trees, not arbitrary DSA drawings, linked lists, sorting animations, tree balancing, or extraction of a graph from unstructured lecture text. See [the DSA guide](dsa-playground.md) for traversal conventions and the upload contract.
