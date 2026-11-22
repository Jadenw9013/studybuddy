"use client";
import { useState } from "react";
import {
  readyDsaSources,
  readyVisualDatasets,
  visualCreation,
  type VisualKind,
  type VisualSource,
} from "../../../packages/board/visual-creation.ts";
import type { DsaAlgorithm } from "../../../packages/board/dsa.ts";
import { dsaAlgorithmLabels } from "./DsaVisual";

export default function CreateChart({
  sources,
  onCreate,
  mode = "create",
  defaultKind = "vectors",
  defaultSourceId = "",
  defaultAlgorithm = "bfs",
  defaultStartNode = "",
  defaultTargetValue,
}: {
  sources: VisualSource[];
  onCreate: (args: any) => Promise<unknown>;
  mode?: "create" | "replace";
  defaultKind?: VisualKind;
  defaultSourceId?: string;
  defaultAlgorithm?: DsaAlgorithm;
  defaultStartNode?: string;
  defaultTargetValue?: number;
}) {
  const [kind, setKind] = useState<VisualKind>(defaultKind),
    [dataset, setDataset] = useState(defaultSourceId),
    [x, setX] = useState(""),
    [y, setY] = useState("");
  const [vectors, setVectors] = useState(["2", "2", "-1", "3"]),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [algorithm, setAlgorithm] = useState<DsaAlgorithm>(defaultAlgorithm),
    [startNode, setStartNode] = useState(defaultStartNode),
    [target, setTarget] = useState(
      defaultTargetValue === undefined ? "" : String(defaultTargetValue),
    );
  const datasets = readyVisualDatasets(sources),
    dsaSources = readyDsaSources(sources);
  const choice =
    dataset ||
    (kind === "probability"
      ? "reviewed"
      : kind === "dsa"
        ? (dsaSources[0]?.id ?? "")
        : (datasets[0]?.id ?? ""));
  const selected = datasets.find((source) => source.id === choice),
    structured = dsaSources.find((source) => source.id === choice)?.dsa;
  const columns = selected?.dataset?.numericColumns ?? [],
    xChoice = columns.includes(x) ? x : (columns[0] ?? ""),
    yChoice =
      columns.includes(y) && y !== xChoice
        ? y
        : (columns.find((column) => column !== xChoice) ?? "");
  const algorithms: DsaAlgorithm[] =
    !structured || structured.kind === "graph"
      ? ["bfs", "dfs"]
      : [
          "bfs",
          "dfs",
          "inorder",
          "preorder",
          "postorder",
          ...(structured.kind === "bst" ? ["search" as const] : []),
        ];
  const algorithmChoice = algorithms.includes(algorithm) ? algorithm : "bfs";
  const rootOperation = ["inorder", "preorder", "postorder", "search"].includes(
    algorithmChoice,
  );
  const startChoice =
    (rootOperation
      ? structured?.rootId
      : structured?.nodes.some((node) => node.id === startNode)
        ? startNode
        : structured?.rootId) ??
    structured?.nodes[0]?.id ??
    "";
  const creation = visualCreation(
    {
      kind,
      sourceId: choice,
      xColumn: xChoice,
      yColumn: yChoice,
      vectorA: vectors
        .slice(0, 2)
        .map((value) => (value.trim() ? Number(value) : NaN)),
      vectorB: vectors
        .slice(2)
        .map((value) => (value.trim() ? Number(value) : NaN)),
      algorithm: algorithmChoice,
      startNode: startChoice,
      targetValue: target.trim() ? Number(target) : NaN,
    },
    sources,
  );
  const chooseDataset = (value: string) => {
    setDataset(value);
    setX("");
    setY("");
    setStartNode("");
    setError("");
  };
  return (
    <details className="create-chart visual-create">
      <summary>
        {mode === "replace" ? "Change data or visual" : "Create a visual"}
      </summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!creation.ready || !creation.args || saving) return;
          setSaving(true);
          setError("");
          try {
            await onCreate(creation.args);
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "The visual could not be created. Try again.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {mode === "replace" && (
          <p className="visual-help">
            Choose the data and visual to use here. You can undo this change.
          </p>
        )}
        <label>
          Visual type
          <select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as VisualKind;
              setKind(next);
              chooseDataset(next === "probability" ? "reviewed" : "");
            }}
          >
            <option value="vectors">Vectors, dot product and projection</option>
            <option value="dsa">Graph and tree algorithms</option>
            <option value="histogram">Histogram</option>
            <option value="regression">Scatterplot and fitted line</option>
            <option value="probability">Conditional probability table</option>
          </select>
        </label>
        {kind === "vectors" ? (
          <>
            <p className="visual-help">
              Enter the two vectors from your question. No data file is needed.
            </p>
            <div className="visual-vector-controls">
              {["a", "b"].map((name, index) => (
                <fieldset key={name}>
                  <legend>Vector {name}</legend>
                  {["x", "y"].map((axis, coordinate) => (
                    <label key={axis}>
                      {axis}
                      <input
                        aria-label={"New vector " + name + " " + axis}
                        type="number"
                        step="any"
                        min={-1e6}
                        max={1e6}
                        required
                        value={vectors[index * 2 + coordinate]}
                        onChange={(event) =>
                          setVectors((previous) =>
                            previous.map((value, i) =>
                              i === index * 2 + coordinate
                                ? event.target.value
                                : value,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </>
        ) : kind === "dsa" ? (
          <>
            <label>
              Graph or tree source
              <select
                value={choice}
                onChange={(event) => chooseDataset(event.target.value)}
                disabled={!dsaSources.length}
              >
                <option value="" disabled>
                  Choose a ready graph or tree
                </option>
                {dsaSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New traversal algorithm
              <select
                value={algorithmChoice}
                onChange={(event) => {
                  setAlgorithm(event.target.value as DsaAlgorithm);
                  setStartNode("");
                }}
                disabled={!structured}
              >
                {algorithms.map((value) => (
                  <option key={value} value={value}>
                    {dsaAlgorithmLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New traversal start node
              <select
                value={startChoice}
                onChange={(event) => setStartNode(event.target.value)}
                disabled={!structured || rootOperation}
              >
                {structured?.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label}
                  </option>
                ))}
              </select>
            </label>
            {rootOperation && (
              <p className="visual-help">
                This operation begins at the tree root. Left and right children
                come from your file.
              </p>
            )}
            {algorithmChoice === "search" && (
              <label>
                New search target
                <input
                  type="number"
                  step="any"
                  min={-1e6}
                  max={1e6}
                  required
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
              </label>
            )}
            <p className="visual-help">
              Uses the nodes and edges in your uploaded file. Step through one
              visit at a time; no uploaded code is executed.
            </p>
          </>
        ) : (
          <>
            <label>
              {kind === "probability" ? "Count table" : "Dataset"}
              <select
                value={choice}
                onChange={(event) => chooseDataset(event.target.value)}
              >
                {kind === "probability" ? (
                  <option value="reviewed">Reviewed example</option>
                ) : (
                  <option value="" disabled>
                    Choose a ready CSV
                  </option>
                )}
                {datasets.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
            {(kind !== "probability" || choice !== "reviewed") && (
              <>
                <label>
                  {kind === "histogram"
                    ? "Numeric column"
                    : kind === "probability"
                      ? "First count column"
                      : "x column"}
                  <select
                    value={xChoice}
                    onChange={(event) => {
                      setX(event.target.value);
                      if (y === event.target.value) setY("");
                    }}
                    disabled={!selected}
                  >
                    {columns.map((column) => (
                      <option key={column}>{column}</option>
                    ))}
                  </select>
                </label>
                {kind !== "histogram" && (
                  <label>
                    {kind === "probability"
                      ? "Second count column"
                      : "y column"}
                    <select
                      value={yChoice}
                      onChange={(event) => setY(event.target.value)}
                      disabled={!selected || columns.length < 2}
                    >
                      {columns
                        .filter((column) => column !== xChoice)
                        .map((column) => (
                          <option key={column}>{column}</option>
                        ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {kind === "probability" && choice === "reviewed" && (
              <p className="visual-help">
                Reviewed example: 3 of 12 evening students travel by train.
                Choose your own two-row count CSV to use your data.
              </p>
            )}
          </>
        )}
        {!creation.ready && (
          <p className="visual-help" role="status">
            {creation.message}
          </p>
        )}
        {error && (
          <p className="visual-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="secondary"
          type="submit"
          disabled={!creation.ready || saving}
        >
          {saving
            ? mode === "replace"
              ? "Changing…"
              : "Creating…"
            : mode === "replace"
              ? "Use this visual"
              : "Create " +
                (kind === "vectors"
                  ? "vector diagram"
                  : kind === "dsa"
                    ? "traversal"
                    : kind === "regression"
                      ? "scatterplot"
                      : kind === "probability"
                        ? "probability table"
                        : "histogram")}
        </button>
      </form>
    </details>
  );
}
