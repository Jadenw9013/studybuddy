import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { buildServer } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";
test("synthetic companion protocol computes expected patch hash and deduplicates dispatch", async () => {
  const { app } = await buildServer(
    loadConfig({
      APP_MODE: "fixture",
      DATA_DIR: await mkdtemp(path.join(tmpdir(), "tutor-pair-")),
    }),
  );
  let socket: any;
  try {
    const origin = "http://localhost:3000";
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      headers: { origin },
      payload: {
        email: "pair@example.test",
        code: "246810",
        adult: true,
        consent: true,
      },
    });
    const cookie = `tutor_session=${r.cookies[0].value}`;
    const call = (method: any, url: string, payload?: any) =>
      app.inject({ method, url, headers: { origin, cookie }, payload });
    const c = (
        await call("POST", "/api/courses", { name: "Paired course" })
      ).json(),
      l = (await call("POST", "/api/lessons", { courseId: c.id })).json();
    const pair = (await call("POST", `/api/lessons/${l.id}/pair`)).json();
    socket = await app.injectWS(`/companion?secret=${pair.secret}`);
    const before = "ax.hist(scores, bins=10)";
    socket.send(
      JSON.stringify({
        type: "snapshot",
        documentId: "doc",
        notebookPath: "local.ipynb",
        cellId: "plot1",
        source: before,
        revision: 0,
        baseHash: createHash("sha256").update(before).digest("hex"),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const command = once(socket, "message");
    const payload = {
      actionId: "edit1",
      type: "notebook.propose",
      turnEpoch: 0,
      args: { replacement: "ax.hist(scores, bins=5)" },
    };
    const preview = await call(
      "POST",
      `/api/lessons/${l.id}/companion/actions`,
      payload,
    );
    assert.equal(preview.statusCode, 200);
    const raw = (await command)[0];
    const action = JSON.parse(raw.toString()).action;
    assert.equal(
      action.args.expectedHash,
      createHash("sha256").update(payload.args.replacement).digest("hex"),
    );
    assert.equal(
      action.baseHash,
      createHash("sha256").update(before).digest("hex"),
    );
    assert.equal(
      (
        await call("POST", `/api/lessons/${l.id}/companion/actions`, payload)
      ).json().status,
      "checking_edit",
    );
    assert.equal(
      (
        await call("POST", `/api/lessons/${l.id}/companion/actions`, {
          ...payload,
          args: { replacement: "different" },
        })
      ).statusCode,
      409,
    );
    socket.send(
      JSON.stringify({
        type: "receipt",
        receipt: {
          actionId: "edit1",
          status: "applied",
          newHash: action.args.expectedHash,
          revision: 1,
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      (await call("GET", `/api/lessons/${l.id}/companion/actions/edit1`)).json()
        .status,
      "applied",
    );
    await call("POST", `/api/lessons/${l.id}/interrupt`, {});
    assert.equal(
      (await call("GET", `/api/lessons/${l.id}/companion`)).json().paired,
      false,
    );
  } finally {
    socket?.terminate();
    await app.close();
  }
});
