import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  dsaAnalysis,
  type DsaDataset,
  type DsaOptions,
} from "../../../../packages/board/dsa.ts";
import DsaVisual from "../DsaVisual";
import Chart from "../Chart";
import CreateChart from "../CreateChart";

const graph: DsaDataset = {
  kind: "graph",
  directed: true,
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
    { id: "d", label: "D" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "a", to: "c" },
    { from: "b", to: "d" },
    { from: "c", to: "d" },
  ],
};
const tree: DsaDataset = {
  kind: "bst",
  directed: true,
  rootId: "root",
  nodes: [
    { id: "root", label: "Seven", value: 7 },
    { id: "left", label: "Three", value: 3 },
    { id: "right", label: "Nine", value: 9 },
  ],
  edges: [
    { from: "root", to: "left", side: "left" },
    { from: "root", to: "right", side: "right" },
  ],
};
const board = (data: DsaDataset, options: DsaOptions = {}) => ({
  id: "dsa-board",
  revision: 2,
  kind: "dsa",
  startNode: options.startNode,
  result: dsaAnalysis(data, options),
});

test("DSA rendering shows the actual graph and distinct current/frontier/visited state", () => {
  const markup = renderToStaticMarkup(
    <DsaVisual
      board={board(graph, { algorithm: "bfs", stepIndex: 1 })}
      onPatch={() => {}}
    />,
  );
  assert.match(markup, /data-testid="dsa-svg"/);
  assert.match(markup, /role="img" aria-labelledby=/);
  assert.match(markup, /data-node-id="a" data-node-status="current"/);
  assert.match(markup, /data-node-id="b" data-node-status="frontier"/);
  assert.match(markup, /data-node-id="d" data-node-status="unvisited"/);
  assert.match(markup, /Queue/);
  assert.match(markup, /next node at the left/);
  assert.match(markup, /1 of 4 nodes visited/);
  assert.match(markup, /Visit A/);
  assert.match(markup, /Inspect node/);
  assert.match(markup, /All nodes in board revision 2/);
  assert.match(markup, /From your uploaded data/);
});

test("ready and completed traversal controls expose valid step boundaries", () => {
  const ready = renderToStaticMarkup(
    <DsaVisual board={board(graph)} onPatch={() => {}} />,
  );
  assert.match(ready, /<button[^>]*disabled=""[^>]*>Previous step/);
  assert.match(ready, /<button[^>]*disabled=""[^>]*>Restart traversal/);
  assert.doesNotMatch(ready, /<button[^>]*disabled=""[^>]*>Next step/);
  const done = renderToStaticMarkup(
    <DsaVisual board={board(graph, { stepIndex: 4 })} onPatch={() => {}} />,
  );
  assert.match(done, /<button[^>]*disabled=""[^>]*>Next step/);
  assert.match(done, /data-node-id="a" data-node-status="visited"/);
});

test("tree traversal labels recursion ancestors honestly and BST search shows the target path", () => {
  const inorder = renderToStaticMarkup(
    <DsaVisual
      board={board(tree, { algorithm: "inorder", stepIndex: 1 })}
      onPatch={() => {}}
    />,
  );
  assert.match(inorder, /Recursion stack/);
  assert.match(inorder, /ancestors from root to parent/);
  assert.match(inorder, /data-node-id="left" data-node-status="current"/);
  assert.match(inorder, /Seven → Three \(left child\)/);
  assert.match(inorder, /This operation starts at the tree root/);
  const search = renderToStaticMarkup(
    <DsaVisual
      board={board(tree, { algorithm: "search", targetValue: 9, stepIndex: 2 })}
      onPatch={() => {}}
    />,
  );
  assert.match(search, /Found target 9 at Nine/);
  assert.match(search, /Target: 9/);
  assert.match(search, /data-node-id="right" data-node-status="current"/);
  assert.match(search, /Search tree/);
});

test("disconnected graphs and hidden frontier never imply every uploaded node was visited", () => {
  const disconnected = {
    ...graph,
    nodes: [...graph.nodes, { id: "isolated", label: "Isolated" }],
  };
  const markup = renderToStaticMarkup(
    <DsaVisual
      board={board(disconnected, { stepIndex: 4, showFrontier: false })}
    />,
  );
  assert.match(markup, /4 of 5 nodes visited/);
  assert.match(
    markup,
    /4 nodes are reachable from this start; 1 are outside its reachable component/,
  );
  assert.doesNotMatch(markup, /data-testid="dsa-frontier"/);
});

test("source labels remain escaped text and cannot create active SVG or HTML", () => {
  const unsafe = {
    ...graph,
    nodes: [
      { ...graph.nodes[0], label: "<script>alert(1)</script>" },
      ...graph.nodes.slice(1),
    ],
  };
  const markup = renderToStaticMarkup(<DsaVisual board={board(unsafe)} />);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<(?:script|iframe|img|foreignObject|a)\b/i);
  assert.doesNotMatch(markup, /\shref=/i);
});

test("Chart dispatches DSA to the trusted renderer and manual creation offers graph/tree algorithms", () => {
  const markup = renderToStaticMarkup(
    <Chart board={board(graph, { stepIndex: 1 })} onPatch={() => {}} />,
  );
  assert.match(markup, /data-testid="dsa-svg"/);
  assert.match(markup, /Graph and tree algorithm visualization/);
  const creation = renderToStaticMarkup(
    <CreateChart sources={[]} onCreate={async () => {}} />,
  );
  assert.match(
    creation,
    /<option value="dsa">Graph and tree algorithms<\/option>/,
  );
});

test("manual replacement starts with the current DSA kind, source and traversal instead of unrelated vectors", () => {
  const markup = renderToStaticMarkup(
    <CreateChart
      mode="replace"
      sources={[
        { id: "graph-source", name: "graph.json", status: "ready", dsa: graph },
        { id: "tree-source", name: "tree.json", status: "ready", dsa: tree },
      ]}
      defaultKind="dsa"
      defaultSourceId="tree-source"
      defaultAlgorithm="inorder"
      onCreate={async () => {}}
    />,
  );
  assert.match(markup, /<summary>Change data or visual<\/summary>/);
  assert.match(markup, /<option value="dsa" selected="">/);
  assert.match(markup, /<option value="tree-source" selected="">/);
  assert.match(markup, /<option value="inorder" selected="">/);
  assert.match(markup, /Use this visual/);
  assert.match(markup, /You can undo this change/);
  assert.doesNotMatch(markup, /New vector a x/);
});
