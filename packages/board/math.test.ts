import { test } from "node:test";
import assert from "node:assert/strict";
import {
  histogram,
  regression,
  predict,
  probability,
  mapPoint,
} from "./index.ts";
test("histogram count/density, exact five bins, unequal widths and inclusive final edge", () => {
  const v = [0, 5, 10, 10, 15, 20, 25, 30, 35, 40];
  const h = histogram(v, { edges: [0, 10, 20, 30, 40], mode: "density" });
  assert.deepEqual(h.counts, [2, 3, 2, 3]);
  assert.deepEqual(
    h.bins.map((b) => b.density),
    [0.02, 0.03, 0.02, 0.03],
  );
  assert.equal(h.area, 1);
  assert.deepEqual(histogram(v, { binCount: 5 }).edges, [0, 8, 16, 24, 32, 40]);
  assert.deepEqual(histogram(v, { edges: [0, 20, 40] }).counts, [5, 5]);
  const u = histogram([0, 1, 2, 3, 10, NaN], { edges: [0, 2, 10] });
  assert.deepEqual(u.counts, [2, 3]);
  assert.equal(u.missing, 1);
  assert.equal(u.area, 1);
});
test("empty/constant and missing range handling", () => {
  assert.throws(() => histogram([]));
  assert.equal(histogram([4, 4]).included, 2);
  assert.equal(histogram([-1, 0, 2, 4], { edges: [0, 2] }).outside, 2);
  assert.throws(() => histogram([1], { edges: [2, 1] }));
});
test("centered regression survives large offset; constant x and zero denominator explicit", () => {
  const f = regression([1e9, 1e9 + 1, 1e9 + 2, 1e9 + 3], [5, 7, 9, 11]);
  assert.equal(f.slope, 2);
  assert.equal(predict(f, 1e9 + 2.5), 10);
  assert.equal(regression([3, 3], [2, 5]).defined, false);
  assert.equal(probability([0, 0, 2, 3]).probability, null);
});
test("contain-fit pointer ignores letterbox", () => {
  assert.deepEqual(mapPoint(400, 75, 800, 600, 1600, 900), { x: 0.5, y: 0 });
  assert.deepEqual(mapPoint(400, 300, 800, 600, 1600, 900), { x: 0.5, y: 0.5 });
  assert.equal(mapPoint(400, 40, 800, 600, 1600, 900), null);
});
