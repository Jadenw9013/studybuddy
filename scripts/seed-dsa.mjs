import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const origin = "http://localhost:3000";
const api = async (path, method = "GET", body) => {
  const r = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      ...(!(body instanceof FormData) && body
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(data.message ?? `Local DSA setup failed (${r.status}).`);
  return data;
};
const config = await api("/api/config");
if (config.mode !== "live" || config.authentication !== "local_test")
  throw Error(
    "This seed imports mock data only into the configured local test workspace.",
  );
const files = [
  "01-undirected-graph.json",
  "02-directed-graph.json",
  "03-binary-tree.json",
  "04-binary-search-tree.json",
  "05-study-guide.md",
];
const recordPath = ".data/dsa-playground.json";
let record;
try {
  record = JSON.parse(await readFile(recordPath, "utf8"));
  await api(`/api/courses/${record.courseId}`);
} catch {
  const course = await api("/api/courses", "POST", {
    name: "DSA · Visual playground",
  });
  record = { courseId: course.id };
  await mkdir(".data", { recursive: true });
  await writeFile(recordPath, JSON.stringify(record, null, 2));
}
for (let i = 0; i < files.length; i += 3) {
  const form = new FormData();
  for (const name of files.slice(i, i + 3)) {
    const bytes = await readFile(`fixtures/dsa/${name}`);
    form.append(
      "files",
      new Blob([bytes], {
        type: name.endsWith(".json") ? "application/json" : "text/markdown",
      }),
      name,
    );
  }
  await api(`/api/courses/${record.courseId}/uploads`, "POST", form);
}
let course;
for (let i = 0; i < 120; i++) {
  course = await api(`/api/courses/${record.courseId}`);
  if (course.sources.some((s) => s.status === "needs_attention"))
    throw Error(
      "A mock dataset could not be processed. Inspect Sources before retrying.",
    );
  if (
    course.sources.filter((s) => s.status.startsWith("ready")).length ===
    files.length
  )
    break;
  await new Promise((r) => setTimeout(r, 500));
}
if (
  course.sources.filter((s) => s.status.startsWith("ready")).length !==
  files.length
)
  throw Error(
    "DSA ingestion is still pending. Rerun the seed after the worker is available.",
  );
let lesson;
if (record.lessonId)
  try {
    const existing = await api(`/api/lessons/${record.lessonId}`);
    lesson = existing.lesson ?? existing;
  } catch {}
if (!lesson) {
  lesson = await api("/api/lessons", "POST", {
    courseId: record.courseId,
    goal: "Understand DSA through the imported mock graphs, binary tree and BST. Show the matching computed visual before explaining, use BFS/DFS or a requested tree traversal, and explain one displayed step at a time.",
  });
  record.lessonId = lesson.id;
}
const graph = course.sources.find((s) => s.name === files[0]);
if (!lesson.board) {
  await api(`/api/lessons/${lesson.id}/actions`, "POST", {
    actionId: randomUUID(),
    sessionId: lesson.id,
    turnEpoch: lesson.epoch,
    type: "board.create",
    targetId: randomUUID(),
    expectedRevision: 0,
    args: {
      kind: "dsa",
      sourceId: graph.id,
      algorithm: "bfs",
      startNode: "A",
      stepIndex: 0,
    },
  });
}
const result = {
  ...record,
  kind: "synthetic-dsa-mock-course",
  url: `${origin}/lessons/${lesson.id}`,
  sources: course.sources.map((s) => ({
    id: s.id,
    name: s.name,
    versionId: s.versionId,
    hash: s.hash,
  })),
  importedFiles: files.length,
  fixtureProvider: false,
  providerCalls: 0,
};
await writeFile(recordPath, JSON.stringify(result, null, 2));
await mkdir("evals/results", { recursive: true });
await writeFile("evals/results/dsa-seed.json", JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    url: result.url,
    importedFiles: result.importedFiles,
    structuredDatasets: course.sources.filter((s) => s.dsa).length,
    providerCalls: 0,
  }),
);
