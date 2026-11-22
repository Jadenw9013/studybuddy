import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createMetricsWriter, sanitizeMetric } from "../src/metrics.ts";

test("metrics drop raw content, untrusted codes, nested media and secret-shaped fields", () => {
  const safe = sanitizeMetric({
    name: "usage",
    at: 1234,
    fixture: false,
    ownerId: "learner@example.test",
    runId: "private-run",
    promptTokenCount: 40,
    prompt: "private course passage",
    audio: "private base64",
    transcript: "private spoken text",
    apiKey: "private provider secret",
    email: "learner@example.test",
    filename: "private notes.pdf",
    nested: { text: "private" },
    code: "private provider error",
    model: "private provider secret",
  });
  assert.equal(safe!.fixture, false);
  assert.equal(safe!.promptTokenCount, 40);
  assert.equal(safe!.code, "other");
  assert.match(String(safe!.ownerId), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(safe).includes("private"), false);
  assert.equal(JSON.stringify(safe).includes("@"), false);
  assert.equal(sanitizeMetric({ name: "private course passage" }), null);
});

test("missing evidence label defaults to fixture and invalid numeric values are omitted", () => {
  const safe = sanitizeMetric({
    name: "audio_packet",
    at: NaN,
    activeSeconds: -1,
    elapsedMs: Infinity,
    fixture: undefined,
  });
  assert.deepEqual(safe, { name: "audio_packet", fixture: true });
});

test("visual metrics preserve known action and conflict codes without accepting raw errors", () => {
  for (const code of ["board.create", "board.replace", "board.patch", "board.undo", "payload_conflict", "learner_turn_limit", "visual_busy"]) {
    assert.equal(sanitizeMetric({ name: "tool_completed", fixture: false, code })!.code, code);
  }
  assert.equal(sanitizeMetric({ name: "error", fixture: false, code: "private source or provider details" })!.code, "other");
});

test("concurrent metric writes are redacted and remain whole JSONL events", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "tutor-metrics-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "events.jsonl");
  const write = createMetricsWriter(file);
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      write({
        name: "usage",
        at: index,
        fixture: true,
        promptTokenCount: index,
        transcript: "must never persist",
      }),
    ),
  );
  await write.flush();
  const raw = await readFile(file, "utf8");
  assert.equal(raw.includes("must never persist"), false);
  assert.equal(
    raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)).length,
    20,
  );
  await createMetricsWriter()({ name: "usage", fixture: false });
});
