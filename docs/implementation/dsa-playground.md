# DSA visual playground

The playground draws and steps through an imported graph, binary tree or binary search tree (BST). The tutor proposes typed operations; trusted code computes the traversal, current node, frontier, visited sequence and layout. A description in chat does not itself create a visual.

## Supported structures and algorithms

| Structure | Operations | Traversal rules |
| --- | --- | --- |
| Directed graph | BFS, DFS | Follow outgoing edges only. Break neighbor ties using the source's `nodes` array order. |
| Undirected graph | BFS, DFS | Follow edges in either direction. Use the same node-order tie rule. |
| Binary tree | BFS, DFS, preorder, inorder, postorder | Follow explicit `left`/`right` child slots, left before right. Recursive traversals start at the root. |
| BST | All binary-tree operations, numeric search | Enforce strict ordering throughout every subtree. Search starts at the root and follows comparisons with the target. |

A graph traversal visits the component reachable from its selected start, not necessarily every node. BFS/DFS can start at a selected tree node and then traverse its descendants. Binary-tree traversal and BST search start at the dataset root. Inorder means left subtree, node, right subtree; preorder means node, left, right; postorder means left, right, node. Only a valid BST guarantees sorted values under inorder traversal.

BFS marks a node discovered when it is enqueued, so its queue contains no duplicate discovered nodes. DFS uses a stack and marks a node visited when it is popped. It pushes unvisited neighbors in reverse tie order so the first neighbor is processed next. A node can already be pending elsewhere in the stack when it is pushed again. Those duplicate entries remain visible. Popping an already visited entry produces an explicit `skip_visited` step, leaving the visited sequence unchanged. A DFS step count therefore need not equal its number of visited nodes.

For the queue, stack and next search node, the next entry is at the left. The recursive traversal frontier instead shows active ancestors from root to parent; it is not a queue of future visits. Step zero is the ready state. **Next step**, **Previous step** and **Restart traversal** change the saved step, rather than executing uploaded code. The complete computed order is a summary; the current step's visited sequence describes progress so far. BST search reports a found target at the corresponding selected step, and an absent target when the required child is missing.

## Source format and trust boundary

Upload UTF-8 `.json` using the `live-tutor-dsa-v1` format. For example:

```json
{
  "format": "live-tutor-dsa-v1",
  "title": "Three-node BST",
  "description": "A small tree for comparing traversal and search.",
  "structure": {
    "kind": "bst",
    "directed": true,
    "rootId": "n2",
    "nodes": [
      { "id": "n2", "label": "2", "value": 2 },
      { "id": "n1", "label": "1", "value": 1 },
      { "id": "n3", "label": "3", "value": 3 }
    ],
    "edges": [
      { "from": "n2", "to": "n1", "side": "left" },
      { "from": "n2", "to": "n3", "side": "right" }
    ]
  }
}
```

Use 1–31 nodes and at most 62 edges. Node IDs start with a letter and contain at most 40 letters, digits, underscores or dashes. Labels contain 1–60 characters; the title contains 1–100 characters and an optional description at most 2,000. Numeric values and search targets must be finite and within ±1,000,000. Graph self-loops and duplicate edges are unsupported. Graph edges have no child side. Trees require a root, directed edges, exactly one parent per non-root node and distinct left/right child slots; every node must be reachable from the root. BST values must be unique and obey all ancestor bounds, not only immediate parent comparisons.

The worker validates the structured source and produces ordinary retrievable source passages. The board engine validates the structure again before computing. Imported text, labels, notebook contents and descriptions remain data and cannot grant permissions. Files cannot supply node coordinates, SVG, generated JavaScript, shell commands or an alternative traversal implementation. Layout positions are computed by trusted code and labels render as text.

Tree canvases expand with node count and depth instead of squeezing a long tree into fixed bounds. The trusted layout reserves room for node and inspection outlines, including a fully skewed 31-node tree. Use the enlarged view and scroll within the diagram to inspect larger trees; the diagram's screen scale can differ from its saved layout coordinates.

The `dsa` board requires a ready source owned by the lesson's course and records its exact source version. `board.patch` changes its algorithm, start, search target, step, frontier visibility or title in place. Changing the algorithm, start or target resets to the ready step unless an explicit valid step is supplied. The source remains fixed for that board. `board.replace` switches to another requested visual while preserving the prior board for undo. Mutations retain the existing action-ID replay, turn-epoch and board-revision checks. Source deletion revokes future operations on that source.

## Included mock course and run commands

The four JSON files under [fixtures/dsa](../../fixtures/dsa) are synthetic teaching datasets: a seven-node cyclic undirected graph, a seven-node directed dependency graph, a complete seven-node binary tree, and a nine-node BST. The accompanying Markdown study guide supplies prompts. They are marked `teachingExample: true` and the board identifies them as **Imported mock teaching dataset**. They do not represent a learner's assignment or evidence of learner progress. A worked traversal is a demonstration, not an independent practice attempt.

The seed uses ordinary HTTP uploads and the normal worker/storage pipeline. It is restricted to the configured local test workspace (`APP_MODE=live`, local development authentication). It does not invoke a text, audio or image provider. The inputs remain mock data even though persistence and ingestion use real local services. Offline fixture-provider responses and paid provider lessons are separate modes of evidence.

Use the setup and local Supabase configuration in [SETUP.md](../../SETUP.md), including the current loopback-only test access. Apply migrations with the configured database connection. In PowerShell from `C:\Dev\StudyBuddy`:

```powershell
pnpm db:start
pnpm db:migrate
pnpm dev
```

Keep the development app and worker running. In a second terminal:

```powershell
pnpm seed:dsa
```

Open the lesson URL printed by the seed. It imports the five mock files, waits for ingestion and creates an initial BFS board only when the recorded lesson has no board. The local course/lesson record is in ignored `.data/dsa-playground.json`; the seed also writes `evals/results/dsa-seed.json`. These records describe the synthetic import, not a live tutoring acceptance result. To use ordinary sign-in instead of local test access, upload the files from `fixtures/dsa` through Materials in the desired course and create a DSA visual from a ready structured source; the seed itself refuses that authentication mode.

## Short demo

1. Open the seeded lesson and its **Visuals** tab. Inspect the source name, graph edges, initial queue and ready step. Choose **Next step** twice and compare the highlighted node, queue and visited sequence.
2. Ask: **“Show BFS on the undirected graph starting at A. Explain the currently displayed queue.”** Then ask: **“Switch to DFS on this same graph. Show why a pending node can appear twice in the stack.”** Inspect a `skip_visited` step when it occurs.
3. Ask: **“Show the binary tree and compare inorder with preorder, one displayed step at a time.”** Use the traversal selector and step controls to inspect the actual imported tree.
4. Ask: **“Search the BST for 7 and show each comparison. Now search for 5 and show why it is absent.”** The included BST has 7 and does not have 5. Use **Search tree** and the step controls to inspect the computed paths.
5. Undo a replacement to restore the prior visual, then reload the lesson and inspect its confirmed board revision and selected step. In a configured voice lesson, ask the same questions and interrupt between steps; the tutor must explain the matching confirmed visual.

Typed or voice prompts require the corresponding configured tutor provider, or explicitly labeled supported development fixtures. The manual visual controls do not require a model call. Missing provider configuration must remain an unavailable state rather than a fabricated answer. SVM, arbitrary diagram generation, tree mutation/balancing, linked lists and automatic extraction of a graph from arbitrary prose/PDFs are outside this DSA increment.

## Verification entry points

The engine tests cover traversal order, directed edges, cycles, duplicate DFS stack entries, tree/BST validation, search outcomes and layout bounds. Gateway tests cover source/course authorization, version binding, replay, stale edits, replacement and undo. The SQL test checks DSA metadata persistence, required source provenance, source-version foreign keys and owner RLS.

```powershell
node --import tsx --test packages/board/dsa.test.ts apps/api/test/dsa-gateway.test.ts
pnpm typecheck
pnpm db:test
```

Observed results and remaining gates are in [DSA acceptance](dsa-acceptance.md) and the later [voice-switching results](dsa-voice-switching.md). Earlier spoken switches were observed, but the latest approved trial failed; the final tool-registry correction awaits live confirmation. Manual **Change data or visual** and step controls remain available without provider calls.
