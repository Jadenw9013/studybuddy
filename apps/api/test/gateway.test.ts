import { test } from "node:test";
import assert from "node:assert/strict";
import { perform } from "../src/gateway.ts";
import { emptyState, type State } from "../src/store.ts";
import type { Action } from "../../../packages/contracts/index.ts";
function state() {
  const s = emptyState();
  s.courses.push({ id: "c1", name: "Stats" });
  s.sources.push({
    id: "s1",
    courseId: "c1",
    name: "scores.csv",
    hash: "x",
    versionId: "v1",
    revision: 1,
    status: "ready",
    storageKey: "private",
    skippedPages: [],
    passages: [],
    dataset: {
      columns: ["score"],
      numericColumns: ["score"],
      rows: [0, 5, 10, 10, 15, 20, 25, 30, 35, 40].map((score) => ({
        score: String(score),
      })),
    },
  });
  s.lessons.push({
    id: "l1",
    courseId: "c1",
    goal: "density",
    epoch: 0,
    messages: [],
    receipts: {},
    attempts: [],
    quiet: false,
  });
  return s;
}
function create(s: State) {
  return perform(s, {
    actionId: "create",
    sessionId: "l1",
    turnEpoch: 0,
    type: "board.create",
    targetId: "hist",
    expectedRevision: 0,
    args: { sourceId: "s1", column: "score", edges: [0, 10, 20, 30, 40] },
  });
}
test("same action exactly once; conflicting payload and stale manual update denied", () => {
  const s = state();
  create(s);
  const a: Action = {
    actionId: "a",
    sessionId: "l1",
    turnEpoch: 0,
    type: "board.patch",
    targetId: "hist",
    expectedRevision: 1,
    args: { binCount: 5 },
  };
  const r = perform(s, a);
  assert.deepEqual(perform(s, a), r);
  assert.equal(s.lessons[0].board!.revision, 2);
  assert.throws(
    () => perform(s, { ...a, args: { binCount: 10 } }),
    /different change/,
  );
  assert.throws(() => perform(s, { ...a, actionId: "new" }), /chart changed/);
  assert.deepEqual(s.lessons[0].board!.result.edges, [0, 8, 16, 24, 32, 40]);
});
test("interrupted turn, wrong course, unknown action and extra parameters cannot commit", () => {
  const s = state();
  s.courses.push({ id: "c2", name: "Other" });
  s.sources[0].courseId = "c2";
  assert.throws(() => create(s), /this course/);
  s.sources[0].courseId = "c1";
  create(s);
  s.lessons[0].epoch = 1;
  const a: Action = {
    actionId: "a",
    sessionId: "l1",
    turnEpoch: 0,
    type: "board.patch",
    targetId: "hist",
    expectedRevision: 1,
    args: { binCount: 5 },
  };
  assert.throws(() => perform(s, a), /interrupted/);
  assert.throws(
    () => perform(s, { ...a, turnEpoch: 1, args: { javascript: "alert(1)" } }),
    /not supported/,
  );
  assert.throws(
    () => perform(s, { ...a, turnEpoch: 1, type: "board.execute" } as any),
    /not supported/,
  );
  assert.equal(s.lessons[0].board!.revision, 1);
});
test("model cannot fabricate attempt; idempotent first answer and assistance ledger", () => {
  const s = state();
  const p = perform(s, {
    actionId: "p",
    sessionId: "l1",
    turnEpoch: 0,
    type: "practice.present",
    targetId: "l1",
    expectedRevision: 0,
    args: { skill: "histogram" },
  });
  const a: Action = {
    actionId: "answer",
    sessionId: "l1",
    turnEpoch: 0,
    type: "practice.record",
    targetId: p.id,
    expectedRevision: 0,
    args: {
      answer:
        "Relative frequency 20%, density 0.04 per score unit. Bar area gives probability.",
    },
  };
  assert.throws(() => perform(s, a, "model"), /Only the learner/);
  const r = perform(s, a);
  assert.equal(r.independent, true);
  assert.equal(r.result.numeric, true);
  assert.deepEqual(perform(s, a), r);
  assert.equal(s.lessons[0].attempts.length, 1);
  const retry = perform(s, { ...a, actionId: "retry" });
  assert.equal(retry.independent, false);
  assert.equal(s.lessons[0].attempts[0].independent, true);
});
test("undo cannot clobber a later student edit and stale screen cannot point", () => {
  const s = state();
  create(s);
  perform(s, {
    actionId: "patch",
    sessionId: "l1",
    turnEpoch: 0,
    type: "board.patch",
    targetId: "hist",
    expectedRevision: 1,
    args: { mode: "density" },
  });
  assert.throws(
    () =>
      perform(s, {
        actionId: "undo",
        sessionId: "l1",
        turnEpoch: 0,
        type: "board.undo",
        targetId: "hist",
        expectedRevision: 1,
        args: {},
      }),
    /chart changed/,
  );
  assert.throws(
    () =>
      perform(s, {
        actionId: "point",
        sessionId: "l1",
        turnEpoch: 0,
        type: "screen.point",
        targetId: "l1",
        expectedRevision: 0,
        args: { captureId: "stopped", frameId: "old", x: 0.5, y: 0.5 },
      }),
    /fresh shared frame/,
  );
});
