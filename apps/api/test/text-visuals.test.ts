import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildServer } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";

test("fixture text request computes a vector visual before publishing the grounded reply and replays once", async () => {
  const { app } = await buildServer(
    loadConfig({
      APP_MODE: "fixture",
      NODE_ENV: "test",
      DEV_AUTH_BYPASS: "true",
      DATA_DIR: await mkdtemp(path.join(tmpdir(), "tutor-text-visual-")),
    }),
  );
  const headers = { origin: "http://localhost:3000" };
  const call = (method: any, url: string, payload?: any) =>
    app.inject({ method, url, headers, payload });
  try {
    const course = (
      await call("POST", "/api/courses", { name: "Linear algebra" })
    ).json();
    const lesson = (
      await call("POST", "/api/lessons", { courseId: course.id })
    ).json();
    const payload = {
      clientMessageId: crypto.randomUUID(),
      text: "Show the dot product and projection of a=[2,2] onto b=[-1,3].",
    };
    const response = await call(
      "POST",
      `/api/lessons/${lesson.id}/messages`,
      payload,
    );
    assert.equal(response.statusCode, 200, response.body);
    const output = response.json();
    assert.equal(output.board.kind, "vectors");
    assert.equal(output.board.result.dot, 4);
    assert.ok(Math.abs(output.board.result.projection[0] + 0.4) < 1e-12);
    assert.ok(Math.abs(output.board.result.projection[1] - 1.2) < 1e-12);
    assert.match(output.message.text, /\*\*4\*\*/);
    assert.match(output.message.text, /\[-0\.4, 1\.2\]/);
    assert.equal(output.message.fixture, true);
    assert.equal(output.message.providerCalls.length, 2);
    const again = (
      await call("POST", `/api/lessons/${lesson.id}/messages`, payload)
    ).json();
    assert.equal(again.message.id, output.message.id);
    const snapshot = (await call("GET", `/api/lessons/${lesson.id}`)).json();
    assert.equal(snapshot.lesson.board.revision, 1);
    assert.equal(
      snapshot.lesson.messages.filter((m: any) => m.role === "tutor").length,
      1,
    );
  } finally {
    await app.close();
  }
});

test("fixture missing vectors never creates an arbitrary chart or invented operands", async () => {
  const { app } = await buildServer(
    loadConfig({
      APP_MODE: "fixture",
      NODE_ENV: "test",
      DEV_AUTH_BYPASS: "true",
      DATA_DIR: await mkdtemp(path.join(tmpdir(), "tutor-missing-vectors-")),
    }),
  );
  const headers = { origin: "http://localhost:3000" };
  try {
    const c = (
      await app.inject({
        method: "POST",
        url: "/api/courses",
        headers,
        payload: { name: "Course" },
      })
    ).json();
    const l = (
      await app.inject({
        method: "POST",
        url: "/api/lessons",
        headers,
        payload: { courseId: c.id },
      })
    ).json();
    const response = await app.inject({
      method: "POST",
      url: `/api/lessons/${l.id}/messages`,
      headers,
      payload: {
        clientMessageId: crypto.randomUUID(),
        text: "Please draw the vectors in my assignment.",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().board, undefined);
    assert.match(response.json().message.text, /provide the two actual/);
  } finally {
    await app.close();
  }
});

test("existing histogram patch fixture is computed before its grounded explanation", async () => {
  const { app, store } = await buildServer(
    loadConfig({
      APP_MODE: "fixture",
      NODE_ENV: "test",
      DEV_AUTH_BYPASS: "true",
      DATA_DIR: await mkdtemp(path.join(tmpdir(), "tutor-bin-grounding-")),
    }),
  );
  const headers = { origin: "http://localhost:3000" },
    call = (method: any, url: string, payload?: any) =>
      app.inject({ method, url, headers, payload });
  try {
    const c = (
      await call("POST", "/api/courses", { name: "Statistics" })
    ).json();
    const owner = (await store.owners())[0],
      sourceId = crypto.randomUUID(),
      versionId = crypto.randomUUID();
    // A synthetic ready source tests the message/gateway contract; ordinary file
    // ingestion remains covered by the independent real-browser journey suite.
    await store.transact(owner, (s) =>
      s.sources.push({
        id: sourceId,
        courseId: c.id,
        name: "scores.csv",
        versionId,
        revision: 1,
        hash: "synthetic-fixture",
        storageKey: "synthetic-fixture",
        status: "ready",
        passages: [],
        skippedPages: [],
        dataset: {
          columns: ["score"],
          numericColumns: ["score"],
          rows: [0, 5, 10, 10, 15, 20, 25, 30, 35, 40].map((score) => ({
            score: String(score),
          })),
        },
      }),
    );
    const l = (await call("POST", "/api/lessons", { courseId: c.id })).json();
    const initial = await call("POST", `/api/lessons/${l.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      text: "Explain my histogram.",
    });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.deepEqual(initial.json().board.result.counts, [2, 3, 2, 3]);
    const changed = await call("POST", `/api/lessons/${l.id}/messages`, {
      clientMessageId: crypto.randomUUID(),
      text: "Use five bins.",
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.deepEqual(changed.json().board.result.counts, [2, 3, 1, 2, 2]);
    assert.match(
      changed.json().message.text,
      /5 intervals with counts \[2, 3, 1, 2, 2\]/,
    );
    assert.equal(changed.json().message.providerCalls.length, 2);
  } finally {
    await app.close();
  }
});
