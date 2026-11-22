import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildServer } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";
const origin = "http://localhost:3000";
test("private course scope, origin, provider outage and deletion range revocation", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tutor-api-"));
  const { app, upload, store } = await buildServer(
    loadConfig({
      APP_MODE: "fixture",
      WEB_ORIGIN: origin,
      DATA_DIR: dataDir,
    } as any),
  );
  try {
    const login = async (email: string) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/auth/verify",
        headers: { origin },
        payload: { email, code: "246810", adult: true, consent: true },
      });
      assert.equal(r.statusCode, 200);
      return r.cookies[0].value;
    };
    const one = await login("one@example.test"),
      two = await login("two@example.test");
    const call = (token: string, method: any, url: string, payload?: any) =>
      app.inject({
        method,
        url,
        headers: { origin, cookie: `tutor_session=${token}` },
        payload,
      });
    const c = (
      await call(one, "POST", "/api/courses", { name: "Private stats" })
    ).json();
    assert.equal(
      (await call(two, "GET", `/api/courses/${c.id}`)).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/courses",
          headers: {
            origin: "https://evil.test",
            cookie: `tutor_session=${one}`,
          },
          payload: { name: "No" },
        })
      ).statusCode,
      403,
    );
    const l = (
      await call(one, "POST", "/api/lessons", { courseId: c.id })
    ).json();
    assert.equal(
      (await call(one, "POST", `/api/lessons/${l.id}/live-ticket`)).statusCode,
      503,
    );
    const owners = await store.owners();
    let owner = "";
    for (const candidate of owners) {
      if (
        await store.transact(candidate, (s) =>
          s.courses.some((c) => c.id === l.courseId),
        )
      )
        owner = candidate;
    }
    const s = await upload(
      owner,
      c.id,
      "notes.txt",
      Buffer.from("Density is count divided by n and bin width."),
    );
    const url = `/api/sources/${s.id}/versions/${s.versionId}/content`;
    assert.equal((await call(one, "GET", url)).statusCode, 200);
    assert.equal((await call(two, "GET", url)).statusCode, 404);
    await call(one, "DELETE", `/api/sources/${s.id}`);
    const removed = await app.inject({
      url,
      headers: { cookie: `tutor_session=${one}`, range: "bytes=0-10" },
    });
    assert.equal(removed.statusCode, 404);
    assert.equal(
      (await call(one, "GET", `/api/lessons/${l.id}`)).statusCode,
      200,
    );
  } finally {
    await app.close();
  }
});
test("production and remote fixture starts fail closed", () => {
  assert.throws(
    () => loadConfig({ APP_MODE: "fixture", NODE_ENV: "production" }),
    /Fixture/,
  );
  assert.throws(
    () =>
      loadConfig({ APP_MODE: "fixture", WEB_ORIGIN: "https://remote.test" }),
    /Fixture/,
  );
  assert.throws(() => loadConfig({ APP_MODE: "live" }), /Missing required/);
});
