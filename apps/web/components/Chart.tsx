"use client";
import { useEffect, useRef, useState } from "react";
import VectorVisual,{type VectorPatch} from './VectorVisual';
import DsaVisual,{type DsaPatch} from './DsaVisual';
export default function Chart({
  board,
  onPaint,
  onPatch,
}: {
  board: any;
  onPaint?: (revision: number) => void;
  onPatch?: (args:VectorPatch|DsaPatch)=>void|Promise<unknown>;
}) {
  const host = useRef<HTMLDivElement>(null),
    [table, setTable] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let view: any;
    async function draw() {
      if (!host.current || !board || ['vectors','dsa'].includes(board.kind)) return;
      setError('');
      try {
        const embed = (await import("vega-embed")).default;
        const r = board.result;
        const common = {
          title: board.label || undefined,
          width: "container",
          height: 235,
          background: "transparent",
          config: {
            font: "Segoe UI",
            axis: {
              labelFontSize: 12,
              titleFontSize: 13,
              gridColor: "#2D384B",
              labelColor:"#AAB7CA",titleColor:"#DCE5F6",domainColor:"#46536A",tickColor:"#46536A",
            },
            title:{color:"#DCE5F6"},legend:{labelColor:"#AAB7CA",titleColor:"#DCE5F6"},
            view: { stroke: null },
          },
          aria: true,
        };
        let spec: any;
        if (board.kind === "histogram")
          spec = {
            ...common,
            data: {
              values: r.bins.map((b: any) => ({
                ...b,
                height: board.mode === "density" ? b.density : b.count,
              })),
            },
            mark: {
              type: "rect",
              color: "#8BAAFF",
              stroke: "#141C2B",
              strokeWidth: 2,
            },
            encoding: {
              x: {
                field: "lower",
                type: "quantitative",
                title: board.column ?? "Score",
                scale: { domain: [r.edges[0], r.edges.at(-1)] },
                axis: { values: r.edges },
              },
              x2: { field: "upper" },
              y2: { datum: 0 },
              y: {
                field: "height",
                type: "quantitative",
                scale: { zero: true, domainMin: 0 },
                title:
                  board.mode === "density"
                    ? `Density (per ${board.column??"measurement"} unit)`
                    : "Count (observations)",
              },
              tooltip: [
                { field: "lower" },
                { field: "upper" },
                { field: "count" },
                { field: "density" },
              ],
            },
          };
        else if (board.kind === "regression") {
          const points = r.points?.map(([x, y]: number[]) => ({ x, y })) ?? [];
          spec = {
            ...common,
            data: { values: points },
            layer: [
              {
                mark: { type: "point", filled: true, color: "#8BAAFF" },
                encoding: {
                  x: { field: "x", type: "quantitative", title: board.xColumn },
                  y: { field: "y", type: "quantitative", title: board.yColumn },
                },
              },
              ...(r.defined
                ? [
                    {
                      data: {
                        values: r.domain.map((x: number) => ({
                          x,
                          y: r.meanY + r.slope * (x - r.meanX),
                        })),
                      },
                      mark: { type: "line", color: "#F1BB74" },
                      encoding: {
                        x: { field: "x", type: "quantitative" },
                        y: { field: "y", type: "quantitative" },
                      },
                    },
                  ]
                : []),
            ],
          };
        } else {
          spec = {
            ...common,
            data: {
              values: r.cells.map((count: number, i: number) => ({
                group: `${r.rowLabels?.[Math.floor(i / 2)] ?? "Group"} / ${r.columnLabels?.[i % 2] ?? "Outcome"}`,
                count,
              })),
            },
            mark: { type: "bar", color: "#8BAAFF" },
            encoding: {
              x: { field: "group", type: "nominal", title: "Group" },
              y: {
                field: "count",
                type: "quantitative",
                title: "Observations",
              },
            },
          };
        }
        if (disposed) return;
        const result = await embed(host.current!, spec, {
          actions: false,
          renderer: "svg",
        });
        view = result.view;
        if (disposed) {
          view.finalize();
          return;
        }
        onPaint?.(board.revision);
      } catch {
        setError(
          "The chart could not be drawn. The verified data table is available.",
        );
      }
    }
    void draw();
    return () => {
      disposed = true;
      view?.finalize();
    };
  }, [board?.revision, board?.id]);
  if (!board)
    return (
      <div className="board-empty">
        <div className="empty-plot" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <h3>A board for your question</h3>
        <p>
          Ask for a diagram or bring your data. Coordinates, calculations, and
          changes stay together here.
        </p>
      </div>
    );
  const r = board.result;
  if(board.kind==='vectors')return <VectorVisual board={board} onPatch={onPatch} onPaint={onPaint}/>;
  if(board.kind==='dsa')return <DsaVisual board={board} onPatch={onPatch} onPaint={onPaint}/>;
  return (
    <>
      <div
        ref={host}
        className="chart"
        role="img"
        aria-label={
          board.kind === "histogram"
            ? `Histogram with ${r.bins.length} bins; counts ${r.counts.join(", ")}. ${board.mode === "density" ? "Density" : "Count"} axis.`
            : `${board.kind} chart`
        }
      />
      {error && <p role="status">{error}</p>}
      <p className="chart-summary" data-testid="chart-summary">
        {board.kind === "histogram"
          ? `${r.included} included · ${r.missing} missing · ${r.outside} outside range. ${r.bins.length} intervals; final edge included.`
          : board.kind === "regression"
            ? r.defined
              ? `Slope ${r.slope}. ${r.n} paired observations, ${r.excluded} excluded.`
              : r.reason
            : `${r.origin}. Conditioning group: ${r.conditioning.startsWith("row")?r.rowLabels?.[Number(r.conditioning.slice(-1))]:r.columnLabels?.[Number(r.conditioning.slice(-1))]}. Denominator ${r.denominator}. Probability ${r.probability ?? "undefined"}.`}
      </p>
      <button
        className="text-button"
        onClick={() => setTable(!table)}
        aria-expanded={table}
      >
        {table ? "Hide data table" : "Show data table"}
      </button>
      {table && (
        <div className="table-scroll">
          <table>
            <caption>
              Verified values for board revision {board.revision}
            </caption>
            {board.kind === "histogram" ? (
              <>
                <thead>
                  <tr>
                    <th>Interval</th>
                    <th>Count</th>
                    <th>Relative frequency</th>
                    <th>Density</th>
                  </tr>
                </thead>
                <tbody>
                  {r.bins.map((b: any, i: number) => (
                    <tr key={i}>
                      <td>
                        [{b.lower}, {b.upper}
                        {i === r.bins.length - 1 ? "]" : ")"}
                      </td>
                      <td>{b.count}</td>
                      <td>{Number(b.mass.toFixed(5))}</td>
                      <td>{Number(b.density.toFixed(5))}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <tbody>
                {(r.cells ?? r.points ?? []).map((v: any, i: number) => (
                  <tr key={i}>
                    <th scope="row">Observation {i + 1}</th>
                    <td>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      )}
    </>
  );
}
