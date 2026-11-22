"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { DsaAlgorithm, DsaAnalysis } from "../../../packages/board/dsa.ts";

export type DsaPatch = {
  algorithm?: DsaAlgorithm;
  startNode?: string;
  stepIndex?: number;
  showFrontier?: boolean;
  targetValue?: number;
  label?: string;
};
type DsaBoard = {
  id: string;
  revision: number;
  label?: string;
  startNode?: string;
  sourceId?: string;
  sourceVersionId?: string;
  result: DsaAnalysis;
};
export const dsaAlgorithmLabels: Record<DsaAlgorithm, string> = {
  bfs: "Breadth-first search",
  dfs: "Depth-first search",
  inorder: "Inorder traversal",
  preorder: "Preorder traversal",
  postorder: "Postorder traversal",
  search: "Binary search tree search",
};
const color = {
  current: "#f1bb74",
  visited: "#50d5c3",
  frontier: "#a6b9ff",
  idle: "#94a4bd",
  edge: "#63738e",
  text: "#e4edff",
};
const short = (text: string, limit = 12) =>
  text.length > limit ? text.slice(0, limit - 1) + "…" : text;

/** Only trusted node coordinates and plain text enter SVG. Traversal is computed server-side. */
export default function DsaVisual({
  board,
  onPatch,
  onPaint,
}: {
  board: DsaBoard;
  onPatch?: (args: DsaPatch) => void | Promise<unknown>;
  onPaint?: (revision: number) => void;
}) {
  const unique = useId().replace(/:/g, ""),
    result = board.result;
  const visualIdentity = [
    board.id,
    board.sourceId ?? result.kind,
    board.sourceVersionId ?? result.rootId ?? "",
    result.nodes.map((node) => node.id).join("|"),
  ].join(":");
  const visualRoot = useRef<HTMLElement>(null),
    diagramViewport = useRef<HTMLElement>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [target, setTarget] = useState(String(result.targetValue ?? ""));
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [enlarged, setEnlarged] = useState(false);
  const request = useRef(0),
    paint = useRef(onPaint);
  paint.current = onPaint;
  useEffect(() => {
    request.current++;
    setSaving(false);
    setError("");
  }, [board.id, board.revision]);
  useEffect(() => {
    setInspectedId(null);
    setEnlarged(false);
    const workspace =
      visualRoot.current?.closest<HTMLElement>(".workspace-body");
    if (workspace) workspace.scrollTop = 0;
    if (diagramViewport.current) {
      diagramViewport.current.scrollTop = 0;
      diagramViewport.current.scrollLeft = 0;
    }
  }, [visualIdentity]);
  useEffect(() => {
    setTarget(String(result.targetValue ?? ""));
  }, [board.id, result.targetValue]);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => paint.current?.(board.revision));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [board.id, board.revision]);
  const step = result.steps[result.stepIndex];
  if (!step)
    return (
      <p role="status">
        This traversal has no confirmed step. Reopen your structured graph or
        tree.
      </p>
    );
  const byId = new Map(result.nodes.map((node) => [node.id, node]));
  const name = (nodeId: string) => byId.get(nodeId)?.label ?? nodeId;
  const inspected =
    byId.get(inspectedId ?? "") ??
    byId.get(step.currentId ?? "") ??
    result.nodes[0];
  const status = (nodeId: string) =>
    nodeId === step.currentId
      ? "Current"
      : step.visitedIds.includes(nodeId)
        ? "Visited"
        : result.showFrontier && step.frontierIds.includes(nodeId)
          ? "Frontier"
          : "Unvisited";
  const available: DsaAlgorithm[] =
    result.kind === "graph"
      ? ["bfs", "dfs"]
      : [
          "bfs",
          "dfs",
          "inorder",
          "preorder",
          "postorder",
          ...(result.kind === "bst" ? ["search" as const] : []),
        ];
  const frontierName = {
    queue: "Queue",
    stack: "Stack",
    "recursion-stack": "Recursion stack",
    "search-path": "Next search node",
  }[result.frontierKind];
  const frontierHint =
    result.frontierKind === "recursion-stack"
      ? "Ancestors from root to parent"
      : "Next node at the left";
  const radius = result.totalNodes > 20 ? 16 : result.totalNodes > 12 ? 21 : 27;
  const largeDiagram = result.totalNodes > 12;
  const minimumDiagramWidth = largeDiagram
    ? Math.ceil(result.bounds.width * 0.8 * (enlarged ? 1.5 : 1))
    : undefined;
  const save = async (args: DsaPatch) => {
    if (!onPatch || saving) return;
    const token = ++request.current;
    setSaving(true);
    setError("");
    try {
      await onPatch(args);
    } catch (e) {
      if (token === request.current)
        setError(
          e instanceof Error
            ? e.message
            : "This step could not be saved. Try again.",
        );
    } finally {
      if (token === request.current) setSaving(false);
    }
  };
  const incoming = result.edges.filter(
    (edge) =>
      edge.to === inspected.id ||
      (!result.directed && edge.from === inspected.id),
  );
  const outgoing = result.edges.filter(
    (edge) =>
      edge.from === inspected.id ||
      (!result.directed && edge.to === inspected.id),
  );
  const isRootOperation = [
    "inorder",
    "preorder",
    "postorder",
    "search",
  ].includes(result.algorithm);
  return (
    <section
      ref={visualRoot}
      className="visual-dsa"
      aria-label="Graph and tree algorithm visualization"
    >
      <header className="visual-heading">
        <div>
          <h3>{board.label || dsaAlgorithmLabels[result.algorithm]}</h3>
          <p>
            {result.kind === "bst"
              ? "Binary search tree"
              : result.kind === "binary_tree"
                ? "Binary tree"
                : result.directed
                  ? "Directed graph"
                  : "Undirected graph"}{" "}
            ·{" "}
            <span className="visual-source-badge">
              {result.origin === "Imported mock teaching dataset"
                ? "Mock teaching dataset"
                : "From your uploaded data"}
            </span>
          </p>
        </div>
        <span className="visual-revision">Revision {board.revision}</span>
      </header>
      <div className="dsa-playback-bar" data-testid="dsa-playback-bar">
        <dl
          className={`dsa-state dsa-live-state${result.showFrontier ? "" : " is-solo"}`}
          aria-label="Live algorithm state"
        >
          <div>
            <dt>Current node</dt>
            <dd data-testid="dsa-current" tabIndex={0}>
              {step.currentId ? name(step.currentId) : "None yet"}
            </dd>
          </div>
          {result.showFrontier && (
            <div>
              <dt>
                {frontierName} <small>({frontierHint.toLowerCase()})</small>
              </dt>
              <dd data-testid="dsa-frontier" tabIndex={0}>
                {step.frontierIds.length
                  ? step.frontierIds.map(name).join(" · ")
                  : "Empty"}
              </dd>
            </div>
          )}
        </dl>
        <div
          className="visual-actions dsa-step-controls"
          role="group"
          aria-label="Traversal playback"
        >
          <button
            className="secondary"
            onClick={() => void save({ stepIndex: 0 })}
            disabled={!onPatch || saving || result.stepIndex === 0}
          >
            Restart traversal
          </button>
          <button
            className="secondary"
            onClick={() => void save({ stepIndex: result.stepIndex - 1 })}
            disabled={!onPatch || saving || result.stepIndex === 0}
          >
            Previous step
          </button>
          <button
            className="secondary"
            onClick={() => void save({ stepIndex: result.stepIndex + 1 })}
            disabled={
              !onPatch || saving || result.stepIndex >= result.steps.length - 1
            }
          >
            Next step
          </button>
        </div>
      </div>
      <figure
        ref={diagramViewport}
        className={`visual-figure visual-dsa-figure${largeDiagram ? " is-large" : ""}`}
        tabIndex={largeDiagram ? 0 : undefined}
        aria-label={
          largeDiagram
            ? "Algorithm diagram. Use arrow keys to scroll."
            : undefined
        }
        style={{ overflowX: "auto" }}
      >
        <svg
          className="visual-dsa-svg"
          data-testid="dsa-svg"
          viewBox={`0 0 ${result.bounds.width} ${result.bounds.height}`}
          style={{
            display: "block",
            width: enlarged ? "180%" : "100%",
            minWidth: minimumDiagramWidth,
            maxWidth: "none",
            height: "auto",
            background: "#101723",
            border: "1px solid #3c4b67",
            borderRadius: 10,
          }}
          role="img"
          aria-labelledby={`${unique}-title ${unique}-description`}
        >
          <title
            id={`${unique}-title`}
          >{`${dsaAlgorithmLabels[result.algorithm]}: ${step.currentId ? `current node ${name(step.currentId)}` : "ready to begin"}`}</title>
          <desc id={`${unique}-description`}>
            {step.explanation} {step.visitedIds.length} of {result.totalNodes}{" "}
            nodes visited. Current nodes have a double ring, visited nodes a
            check, and frontier nodes a dashed frame. Every node and edge is
            listed below.
          </desc>
          <defs>
            <marker
              id={`${unique}-arrow`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color.edge} />
            </marker>
          </defs>
          {result.edges.map((edge, index) => {
            const from = byId.get(edge.from)!,
              to = byId.get(edge.to)!;
            const dx = to.x - from.x,
              dy = to.y - from.y,
              distance = Math.hypot(dx, dy) || 1;
            const x1 = from.x + (dx / distance) * (radius + 4),
              y1 = from.y + (dy / distance) * (radius + 4);
            const x2 = to.x - (dx / distance) * (radius + 8),
              y2 = to.y - (dy / distance) * (radius + 8);
            return (
              <g key={`${edge.from}-${edge.to}-${index}`}>
                {edge.from === edge.to ? (
                  <path
                    d={`M ${from.x - radius} ${from.y} C ${from.x - radius * 3} ${from.y - radius * 4}, ${from.x + radius * 3} ${from.y - radius * 4}, ${from.x + radius} ${from.y}`}
                    fill="none"
                    stroke={color.edge}
                    strokeWidth="3"
                    markerEnd={
                      result.directed ? `url(#${unique}-arrow)` : undefined
                    }
                  />
                ) : (
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={color.edge}
                    strokeWidth="3"
                    markerEnd={
                      result.directed ? `url(#${unique}-arrow)` : undefined
                    }
                  />
                )}
                {edge.side && (
                  <text
                    x={(from.x + to.x) / 2 + (edge.side === "left" ? -14 : 14)}
                    y={(from.y + to.y) / 2 - 9}
                    textAnchor="middle"
                    fill="#bfcde4"
                    fontSize="20"
                  >
                    {edge.side === "left" ? "L" : "R"}
                  </text>
                )}
              </g>
            );
          })}
          {result.nodes.map((node) => {
            const state = status(node.id),
              stroke =
                state === "Current"
                  ? color.current
                  : state === "Visited"
                    ? color.visited
                    : state === "Frontier"
                      ? color.frontier
                      : color.idle;
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                data-node-status={state.toLowerCase()}
              >
                <title>{`${node.label}${node.value !== undefined ? `, value ${node.value}` : ""}: ${state}`}</title>
                {inspectedId === node.id && (
                  <rect
                    x={node.x - radius - 14}
                    y={node.y - radius - 14}
                    width={(radius + 14) * 2}
                    height={(radius + 14) * 2}
                    rx="9"
                    fill="none"
                    stroke="#eef3ff"
                    strokeWidth="2"
                  />
                )}
                {state === "Frontier" && (
                  <rect
                    x={node.x - radius - 7}
                    y={node.y - radius - 7}
                    width={(radius + 7) * 2}
                    height={(radius + 7) * 2}
                    rx="7"
                    fill="none"
                    stroke={stroke}
                    strokeWidth="3"
                    strokeDasharray="6 5"
                  />
                )}
                {state === "Current" && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius + 7}
                    fill="none"
                    stroke={stroke}
                    strokeWidth="3"
                  />
                )}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={
                    state === "Current"
                      ? "#493625"
                      : state === "Visited"
                        ? "#153a37"
                        : "#202b40"
                  }
                  stroke={stroke}
                  strokeWidth="3"
                />
                <text
                  x={node.x}
                  y={node.y + 7}
                  textAnchor="middle"
                  fill={color.text}
                  fontSize={result.totalNodes > 20 ? 17 : 22}
                  fontWeight="600"
                >
                  {short(
                    String(node.value ?? node.label),
                    result.totalNodes > 20 ? 4 : 7,
                  )}
                </text>
                {state === "Visited" && (
                  <text
                    x={node.x + radius}
                    y={node.y - radius}
                    fill={stroke}
                    fontSize="22"
                    fontWeight="700"
                  >
                    ✓
                  </text>
                )}
                {node.value !== undefined &&
                  node.label !== String(node.value) && (
                    <text
                      x={node.x}
                      y={node.y + radius + 23}
                      textAnchor="middle"
                      fill="#aab7ca"
                      fontSize="18"
                    >
                      {short(node.label)}
                    </text>
                  )}
              </g>
            );
          })}
        </svg>
      </figure>
      <div className="visual-legend" aria-label="Node status legend">
        <span>◎ Current</span>
        <span>✓ Visited</span>
        <span>▧ Frontier</span>
        <span>○ Unvisited</span>
      </div>
      <p className="chart-summary" data-testid="dsa-summary">
        {step.visitedIds.length} of {result.totalNodes} nodes visited.{" "}
        {result.algorithm === "search" ? `Target: ${result.targetValue}. ` : ""}
        {result.kind === "graph" && result.reachableCount < result.totalNodes
          ? `${result.reachableCount} nodes are reachable from this start; ${result.totalNodes - result.reachableCount} are outside its reachable component.`
          : ""}
      </p>
      <p
        className="visual-step-explanation"
        role="status"
        data-testid="dsa-step"
      >
        <strong>
          Step {result.stepIndex} of {result.steps.length - 1}.
        </strong>{" "}
        {step.explanation}
      </p>
      <dl className="dsa-state" aria-label="Traversal history">
        <div>
          <dt>Visited so far</dt>
          <dd data-testid="dsa-visited">
            {step.visitedIds.length
              ? step.visitedIds.map(name).join(" → ")
              : "None yet"}
          </dd>
        </div>
      </dl>
      <div className="visual-display-controls">
        <label>
          <input
            type="checkbox"
            checked={result.showFrontier}
            disabled={!onPatch || saving}
            onChange={(event) =>
              void save({ showFrontier: event.target.checked })
            }
          />
          Show {frontierName.toLowerCase()}
        </label>
        <button
          className="text-button"
          aria-pressed={enlarged}
          onClick={() => setEnlarged(!enlarged)}
        >
          {enlarged ? "Fit diagram" : "Enlarge diagram"}
        </button>
      </div>
      <div className="dsa-options">
        <label>
          Traversal algorithm
          <select
            value={result.algorithm}
            disabled={!onPatch || saving}
            onChange={(event) => {
              const algorithm = event.target.value as DsaAlgorithm;
              void save({
                algorithm,
                stepIndex: 0,
                ...(["inorder", "preorder", "postorder", "search"].includes(
                  algorithm,
                )
                  ? { startNode: result.rootId }
                  : {}),
                ...(algorithm === "search"
                  ? {
                      targetValue:
                        result.targetValue ??
                        result.nodes.find((node) => node.id === result.rootId)
                          ?.value ??
                        0,
                    }
                  : {}),
              });
            }}
          >
            {available.map((algorithm) => (
              <option key={algorithm} value={algorithm}>
                {dsaAlgorithmLabels[algorithm]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start node
          <select
            value={board.startNode ?? result.rootId ?? result.nodes[0].id}
            disabled={!onPatch || saving || isRootOperation}
            onChange={(event) =>
              void save({ startNode: event.target.value, stepIndex: 0 })
            }
          >
            {result.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </label>
        {isRootOperation && (
          <p className="visual-help">This operation starts at the tree root.</p>
        )}
      </div>
      {result.kind === "bst" && (
        <form
          className="dsa-search"
          onSubmit={(event) => {
            event.preventDefault();
            const value = target.trim() ? Number(target) : NaN;
            if (!Number.isFinite(value) || Math.abs(value) > 1e6) {
              setError("Enter a target between −1,000,000 and 1,000,000.");
              return;
            }
            void save({
              algorithm: "search",
              targetValue: value,
              startNode: result.rootId,
              stepIndex: 0,
            });
          }}
        >
          <label>
            Target value
            <input
              type="number"
              step="any"
              min={-1e6}
              max={1e6}
              required
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={!onPatch || saving}
            />
          </label>
          <button
            className="secondary"
            disabled={!onPatch || saving}
            type="submit"
          >
            Search tree
          </button>
        </form>
      )}
      {error && (
        <p className="visual-error" role="alert">
          {error}
        </p>
      )}
      <details className="visual-data">
        <summary>Explore nodes, edges and steps</summary>
        <label>
          Inspect node
          <select
            value={inspected.id}
            onChange={(event) => setInspectedId(event.target.value)}
          >
            {result.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label} — {status(node.id)}
              </option>
            ))}
          </select>
        </label>
        <p>
          {inspected.label}
          {inspected.value !== undefined ? ` has value ${inspected.value}` : ""}
          . {status(inspected.id)}.{" "}
          {result.directed ? "Incoming from" : "Connected from"}:{" "}
          {incoming
            .map((edge) =>
              name(edge.from === inspected.id ? edge.to : edge.from),
            )
            .join(", ") || "none"}
          . {result.directed ? "Outgoing to" : "Connected to"}:{" "}
          {outgoing
            .map(
              (edge) =>
                `${name(edge.to === inspected.id ? edge.from : edge.to)}${edge.side ? ` (${edge.side} child)` : ""}`,
            )
            .join(", ") || "none"}
          .
        </p>
        <div className="table-scroll">
          <table>
            <caption>All nodes in board revision {board.revision}</caption>
            <thead>
              <tr>
                <th scope="col">Node</th>
                <th scope="col">Value</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.nodes.map((node) => (
                <tr key={node.id}>
                  <th scope="row">{node.label}</th>
                  <td>{node.value ?? "Not supplied"}</td>
                  <td>{status(node.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul>
          {result.edges.map((edge, index) => (
            <li key={index}>
              {name(edge.from)} {result.directed ? "→" : "↔"} {name(edge.to)}
              {edge.side ? ` (${edge.side} child)` : ""}
            </li>
          ))}
        </ul>
        <ol start={0}>
          {result.steps.map((entry, index) => (
            <li
              key={index}
              aria-current={index === result.stepIndex ? "step" : undefined}
            >
              {entry.explanation}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
