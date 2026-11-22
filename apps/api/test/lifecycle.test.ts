import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildServer } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";
const origin = "http://localhost:3000";
test("worker lease fencing, replacement continuity, idempotency and deletion race", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tutor-lifecycle-"));
  const { app, store, upload } = await buildServer(
    loadConfig({ APP_MODE: "fixture", WEB_ORIGIN: origin, DATA_DIR: dataDir }),
  );
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      headers: { origin },
      payload: {
        email: "lifecycle@example.test",
        code: "246810",
        adult: true,
        consent: true,
      },
    });
    const cookie = login.cookies[0].value;
    const user = (method: any, url: string, payload?: any) =>
      app.inject({
        method,
        url,
        headers: { origin, cookie: `tutor_session=${cookie}` },
        payload,
      });
    const worker = (url: string, payload: any) =>
      app.inject({
        method: "POST",
        url,
        headers: { authorization: "Bearer local-worker-development-secret" },
        payload,
      });
    const c = (
      await user("POST", "/api/courses", { name: "Race course" })
    ).json();
    const owner = (await store.owners())[0];
    const old = await upload(
      owner,
      c.id,
      "lecture.txt",
      Buffer.from("Density equals count divided by observations and width."),
    );
    const duplicate = await upload(
      owner,
      c.id,
      "renamed.txt",
      Buffer.from("Density equals count divided by observations and width."),
    );
    assert.equal(old.id, duplicate.id);
    const first = (await worker("/internal/jobs/claim", {})).json();
    assert.equal(
      (
        await worker("/internal/jobs/publish", {
          id: first.id,
          leaseToken: "wrong",
          result: { passages: [] },
        })
      ).statusCode,
      409,
    );
    const parsed = {
      status: "ready",
      skippedPages: [],
      passages: [
        {
          text: "Density equals count divided by observations and width.",
          locator: { pageIndex: 1 },
        },
      ],
    };
    assert.equal(
      (
        await worker("/internal/jobs/publish", {
          id: first.id,
          leaseToken: first.leaseToken,
          result: parsed,
        })
      ).json().published,
      true,
    );
    const replacement = await upload(
      owner,
      c.id,
      "lecture.txt",
      Buffer.from("New density lesson with changed wording."),
      old.id,
    );
    assert.equal(replacement.published.versionId, old.versionId);
    assert.equal(
      (
        await user(
          "GET",
          `/api/sources/${old.id}/versions/${old.versionId}/content`,
        )
      ).statusCode,
      200,
    );
    const second = (await worker("/internal/jobs/claim", {})).json();
    await user("DELETE", `/api/sources/${old.id}`);
    assert.equal(
      (
        await worker("/internal/jobs/publish", {
          id: second.id,
          leaseToken: second.leaseToken,
          result: parsed,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await user(
          "GET",
          `/api/sources/${old.id}/versions/${old.versionId}/content`,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await user(
          "GET",
          `/api/sources/${old.id}/versions/${replacement.versionId}/content`,
        )
      ).statusCode,
      404,
    );
    await assert.rejects(
      access(path.join(dataDir, "originals", old.versionId)),
    );
    await assert.rejects(
      access(path.join(dataDir, "originals", replacement.versionId)),
    );
    const state = await store.transact(owner, (s) => s);
    assert.ok(state.purges?.every((p) => p.status === "complete"));
  } finally {
    await app.close();
  }
});
