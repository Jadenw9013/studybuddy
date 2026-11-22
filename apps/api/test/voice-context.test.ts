import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, type Lesson, type Source } from "../src/store.ts";
import {
  voiceLessonContext,
  VOICE_CONTEXT_MAX_CHARS,
} from "../src/voice-context.ts";

function sample() {
  const s = emptyState(),
    l: Lesson = {
      id: "lesson",
      courseId: "course",
      goal: "Explain the selected coursework",
      epoch: 4,
      messages: [],
      receipts: {},
      attempts: [],
      quiet: false,
    };
  s.courses.push({ id: "course", name: "Course" });
  s.lessons.push(l);
  return { s, l };
}
function notebook(index: number): Source {
  return {
    id: `source-${index}`,
    courseId: "course",
    name: `Notebook ${index}`,
    versionId: `version-${index}`,
    revision: 1,
    hash: "h",
    status: "ready",
    storageKey: "private-original",
    passages: [],
    skippedPages: [],
    notebook: {
      cells: Array.from({ length: 20 }, (_, i) => ({
        id: `cell-${index}-${i}`,
        cellType: "markdown",
        source: "Course evidence ".repeat(400),
      })),
    },
  };
}
test("25 large notebooks produce bounded valid context and preserve actual course inventory without raw uploads", () => {
  const { s, l } = sample();
  s.sources = Array.from({ length: 25 }, (_, i) => notebook(i));
  const out = voiceLessonContext(s, l),
    json = JSON.stringify(out);
  assert.ok(json.length <= VOICE_CONTEXT_MAX_CHARS);
  assert.equal(JSON.parse(json).materialsTotal, 25);
  assert.equal(out.epoch, 4);
  assert.equal(out.goal, l.goal);
  assert.ok(out.notebook.length <= 5);
  assert.equal(json.includes("private-original"), false);
  assert.equal(json.includes("Course evidence ".repeat(401)), false);
});
test("selected notebook evidence is prioritized, foreign/deleted files and board history never enter live context", () => {
  const { s, l } = sample();
  s.sources = [
    notebook(0),
    notebook(1),
    { ...notebook(2), courseId: "foreign" },
    { ...notebook(3), deleted: true },
  ];
  s.sources[1].passages = [
    { id: "p", text: "Selected evidence", locator: { cellId: "cell-1-0" } },
  ];
  l.activeSource = { id: "source-1", versionId: "version-1", passageId: "p" };
  l.board = {
    id: "board",
    revision: 7,
    kind: "vectors",
    result: { vectorA: [2, 2], vectorB: [-1, 3], dot: 4 },
    history: Array.from(
      { length: 1000 },
      () =>
        ({
          id: "old",
          revision: 1,
          kind: "vectors",
          result: { secret: "OLD-BOARD-DATA" },
        }) as any,
    ),
  };
  const out = voiceLessonContext(s, l),
    json = JSON.stringify(out);
  assert.equal(out.board.revision, 7);
  assert.equal(out.board.result.dot, 4);
  assert.equal(out.notebook[0].sourceId, "source-1");
  assert.equal(out.selectedExcerpt.text, "Selected evidence");
  assert.equal(out.materialsTotal, 2);
  assert.equal(json.includes("OLD-BOARD-DATA"), false);
  assert.equal(json.includes("source-2"), false);
});
test("escaped source and paired-cell text never cause truncated or oversized JSON", () => {
  const { s, l } = sample();
  s.sources = Array.from({ length: 25 }, (_, i) => ({
    ...notebook(i),
    name: "\u0000".repeat(180),
    notebook: {
      cells: [
        {
          id: `cell-${i}`,
          cellType: "markdown",
          source: "\u0000".repeat(9000),
        },
      ],
    },
  }));
  const out = voiceLessonContext(s, l, {
    cellId: "paired",
    revision: 2,
    source: "\u0000".repeat(20000),
    cells: Array.from({ length: 60 }, () => ({ source: "\u0000".repeat(900) })),
  });
  assert.ok(JSON.stringify(out).length <= VOICE_CONTEXT_MAX_CHARS);
  assert.equal(JSON.parse(JSON.stringify(out)).materialsTotal, 25);
});
