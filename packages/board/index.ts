import { DomainError } from "../contracts/index.ts";
export {dsaAnalysis,validateDsaDataset,type DsaAlgorithm,type DsaDataset,type DsaAnalysis,type DsaStep,type DsaOptions} from './dsa.ts';
export {vectorAnalysis,MAX_VECTOR_COMPONENT,MIN_VECTOR_COMPONENT,type Vector2,type VectorAnalysis} from './vectors.ts';
export function histogram(
  values: unknown[],
  opts: { edges?: number[]; binCount?: number; mode?: string } = {},
) {
  const finite = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  let edges = opts.edges;
  if (!edges) {
    if (!finite.length)
      throw new DomainError(
        "insufficient_evidence",
        "Choose a numeric column with observations.",
      );
    const min = Math.min(...finite),
      max = Math.max(...finite);
    const k = opts.binCount ?? 4;
    if (!Number.isInteger(k) || k < 1 || k > 50)
      throw new DomainError(
        "invalid_params",
        "Choose between 1 and 50 bins.",
        400,
      );
    const lo = min === max ? min - 0.5 : min,
      hi = min === max ? max + 0.5 : max;
    edges = Array.from({ length: k + 1 }, (_, i) =>
      i === k ? hi : lo + ((hi - lo) * i) / k,
    );
  }
  if (
    edges.length < 2 ||
    edges.length > 51 ||
    edges.some((e, i) => !Number.isFinite(e) || (i > 0 && e <= edges![i - 1]))
  )
    throw new DomainError(
      "invalid_params",
      "Bin edges must be finite and increasing.",
      400,
    );
  const counts = Array(edges.length - 1).fill(0) as number[];
  let outside = 0;
  for (const v of finite) {
    if (v < edges[0] || v > edges.at(-1)!) {
      outside++;
      continue;
    }
    let i = edges.length - 2;
    for (let j = 0; j < edges.length - 1; j++)
      if (v < edges[j + 1]) {
        i = j;
        break;
      }
    counts[i]++;
  }
  const n = counts.reduce((a, b) => a + b, 0),
    bins = counts.map((count, i) => ({
      lower: edges![i],
      upper: edges![i + 1],
      count,
      mass: n ? count / n : 0,
      density: n ? count / (n * (edges![i + 1] - edges![i])) : 0,
    }));
  return {
    edges,
    counts,
    bins,
    included: n,
    missing: values.length - finite.length,
    outside,
    area: bins.reduce((a, b) => a + b.density * (b.upper - b.lower), 0),
    mode: opts.mode ?? "count",
    units: opts.mode === "density" ? "per score unit" : "observations",
  };
}
export function regression(xs: unknown[], ys: unknown[]) {
  const pairs = xs.flatMap((x, i) =>
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof ys[i] === "number" &&
    Number.isFinite(ys[i])
      ? [[x, ys[i] as number]]
      : [],
  );
  const n = pairs.length;
  if (n < 2)
    return {
      defined: false,
      n,
      excluded: xs.length - n,
      reason: "At least two pairs are needed.",
    };
  const meanX = pairs.reduce((s, p) => s + p[0], 0) / n,
    meanY = pairs.reduce((s, p) => s + p[1], 0) / n;
  const xx = pairs.reduce((s, [x]) => s + (x - meanX) ** 2, 0);
  if (xx === 0)
    return {
      defined: false,
      n,
      excluded: xs.length - n,
      reason: "The x values are constant.",
    };
  const slope =
    pairs.reduce((s, [x, y]) => s + (x - meanX) * (y - meanY), 0) / xx;
  return {
    defined: true,
    n,
    excluded: xs.length - n,
    slope,
    intercept: meanY - slope * meanX,
    meanX,
    meanY,
    points: pairs,
    domain: [
      Math.min(...pairs.map((p) => p[0])),
      Math.max(...pairs.map((p) => p[0])),
    ],
  };
}
export function predict(fit: ReturnType<typeof regression>, x: number) {
  return fit.defined ? fit.meanY! + fit.slope! * (x - fit.meanX!) : null;
}
export function probability(cells: number[], conditioning = "row0") {
  if (cells.length !== 4 || cells.some((x) => !Number.isFinite(x) || x < 0))
    throw new DomainError(
      "invalid_params",
      "Use four nonnegative group counts.",
      400,
    );
  const [a, b, c, d] = cells;
  const total = a + b + c + d;
  const indices =
    conditioning === "row1"
      ? [2, 3]
      : conditioning === "column0"
        ? [0, 2]
        : conditioning === "column1"
          ? [1, 3]
          : [0, 1];
  const denominator = indices.reduce((s, i) => s + cells[i], 0);
  return {
    cells,
    total,
    conditioning,
    denominator,
    probability: denominator ? cells[indices[0]] / denominator : null,
    reason: denominator ? null : "No observations in the conditioning group.",
  };
}
export function mapPoint(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
  frameW: number,
  frameH: number,
) {
  const scale = Math.min(viewW / frameW, viewH / frameH),
    w = frameW * scale,
    h = frameH * scale,
    left = (viewW - w) / 2,
    top = (viewH - h) / 2;
  if (x < left || x > left + w || y < top || y > top + h) return null;
  return { x: (x - left) / w, y: (y - top) / h };
}
export function numericColumn(rows: Record<string, string>[], column: string) {
  return rows.map((r) => (r[column]?.trim() ? Number(r[column]) : NaN));
}
