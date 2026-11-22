import test from "node:test";
import assert from "node:assert/strict";
import {
  notebookEntries,
  openNotebook,
  renameNotebook,
  visibleNotebooks,
  type NotebookCourse,
  type NotebookLesson,
} from "../NotebookLibrary.model";
const courses: NotebookCourse[] = [
  {
    id: "algebra",
    name: "Algèbre linéaire",
    sourceCount: 5,
    updatedAt: "2026-11-20T12:00:00Z",
  },
  {
    id: "graphs",
    name: "Graphs and trees",
    sourceCount: 2,
    updatedAt: "2026-11-21T12:00:00Z",
  },
  { id: "empty", name: "New notebook", sourceCount: 0 },
  { id: "unknown", name: "Older notebook" },
];
const lessons: NotebookLesson[] = [
  {
    id: "old-graph",
    courseId: "graphs",
    title: "BFS",
    updatedAt: "2026-11-20T10:00:00Z",
  },
  { id: "algebra-lesson", courseId: "algebra", title: "Orthogonal projection" },
  {
    id: "new-graph",
    courseId: "graphs",
    title: "Depth first traversal",
    updatedAt: "2026-11-21T13:00:00Z",
  },
];
test("library derives real lesson counts and latest resume target while preserving unknown source counts", () => {
  const entries = notebookEntries(courses, lessons);
  assert.equal(entries[0].lessonCount, 1);
  assert.equal(entries[1].lessonCount, 2);
  assert.equal(entries[1].latestLesson?.id, "new-graph");
  assert.equal(entries[2].sourceCount, 0);
  assert.equal(entries[3].sourceCount, undefined);
  assert.equal(
    notebookEntries([{ id: "bad", name: "Bad count", sourceCount: -3 }], [])[0]
      .sourceCount,
    undefined,
  );
});
test("library search, source/lesson filters and sorting operate on actual owned metadata", () => {
  const entries = notebookEntries(courses, lessons);
  assert.deepEqual(
    visibleNotebooks(entries, "algebre", "all", "name").map((e) => e.course.id),
    ["algebra"],
  );
  assert.deepEqual(
    visibleNotebooks(entries, "depth traversal", "all", "updated").map(
      (e) => e.course.id,
    ),
    ["graphs"],
  );
  assert.deepEqual(
    visibleNotebooks(entries, "", "empty", "name").map((e) => e.course.id),
    ["empty"],
  );
  assert.deepEqual(
    visibleNotebooks(entries, "", "with-sources", "sources").map(
      (e) => e.course.id,
    ),
    ["algebra", "graphs"],
  );
  assert.deepEqual(
    visibleNotebooks(entries, "", "with-lessons", "updated").map(
      (e) => e.course.id,
    ),
    ["graphs", "algebra"],
  );
  assert.equal(
    visibleNotebooks(entries, "missing notebook", "all", "name").length,
    0,
  );
});
test("opening resumes the actual latest lesson and falls back to the empty course without creating data", () => {
  const entries = notebookEntries(courses, lessons),
    calls: string[] = [];
  const actions = {
    onOpenCourse: (id: string) => calls.push("course:" + id),
    onOpenLesson: (id: string) => calls.push("lesson:" + id),
  };
  openNotebook(entries[1], actions);
  openNotebook(entries[2], actions);
  assert.deepEqual(calls, ["lesson:new-graph", "course:empty"]);
});
test("rename action trims valid names, skips unchanged names and propagates persistence failures", async () => {
  const calls: unknown[] = [];
  const persist = async (id: string, name: string) => {
    calls.push({ id, name });
  };
  assert.equal(
    await renameNotebook(courses[1], "  Algorithms  ", persist),
    "Algorithms",
  );
  assert.deepEqual(calls, [{ id: "graphs", name: "Algorithms" }]);
  await renameNotebook(courses[1], courses[1].name, persist);
  assert.equal(calls.length, 1);
  await assert.rejects(
    renameNotebook(courses[1], " ", persist),
    /between 1 and 100/,
  );
  await assert.rejects(
    renameNotebook(courses[1], "x".repeat(101), persist),
    /between 1 and 100/,
  );
  await assert.rejects(
    renameNotebook(courses[1], "New name", async () => {
      throw Error("Save unavailable");
    }),
    /Save unavailable/,
  );
});
