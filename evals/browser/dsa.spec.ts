import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  askFixture,
  lessonWorkspace,
  loginFixture,
  primary44,
  readySources,
  snapshot,
  uploadFixtureFiles,
} from "./fixture-helpers";

const files = [
  "01-undirected-graph.json",
  "02-directed-graph.json",
  "03-binary-tree.json",
  "04-binary-search-tree.json",
  "05-study-guide.md",
];
async function uploadedDsa(page: Page, prefix: string) {
  await loginFixture(page, prefix);
  await uploadFixtureFiles(
    page,
    files.map((file) => "dsa/" + file),
  );
}
async function next(page: Page, expectedIndex: number) {
  await lessonWorkspace(page)
    .getByRole("button", { name: "Next step", exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot(page)).lesson.board.result.stepIndex)
    .toBe(expectedIndex);
  await expect(page.getByTestId("dsa-step")).toContainText(
    `Step ${expectedIndex} of`,
  );
}

test("fixture DSA: five ordinary uploads → actual BFS queue/highlights → previous → DFS stack", async ({
  page,
}) => {
  await uploadedDsa(page, "dsa-graph");
  await askFixture(
    page,
    "Show BFS on 01-undirected-graph.json from A. Show the queue and explain only the current step.",
  );
  const panel = lessonWorkspace(page);
  await expect(page.getByTestId("dsa-svg")).toBeVisible();
  await expect(
    panel.getByText("Mock teaching dataset", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("dsa-current")).toHaveText("None yet");
  await expect(page.getByTestId("dsa-frontier")).toHaveText("A");
  await expect(
    page.getByTestId("dsa-svg").locator('[data-node-id="A"]'),
  ).toHaveAttribute("data-node-status", "frontier");
  const initial = await snapshot(page),
    source = initial.sources.find((item: any) => item.name === files[0]);
  expect(initial.sources).toHaveLength(5);
  expect(initial.lesson.board.kind).toBe("dsa");
  expect(initial.lesson.board.sourceId).toBe(source.id);
  expect(initial.lesson.board.sourceVersionId).toBe(source.versionId);
  expect(initial.lesson.board.result.nodes.map((node: any) => node.id)).toEqual(
    ["A", "B", "C", "D", "E", "F", "G"],
  );
  expect(initial.lesson.board.result.edges).toHaveLength(7);
  expect(initial.lesson.board.result.order).toEqual([
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
  ]);
  expect(initial.lesson.board.result.stepIndex).toBe(0);
  await next(page, 1);
  await expect(page.getByTestId("dsa-current")).toHaveText("A");
  await expect(page.getByTestId("dsa-frontier")).toHaveText("B · C");
  await expect(
    page.getByTestId("dsa-svg").locator('[data-node-id="A"]'),
  ).toHaveAttribute("data-node-status", "current");
  await next(page, 2);
  await expect(page.getByTestId("dsa-current")).toHaveText("B");
  await expect(page.getByTestId("dsa-frontier")).toHaveText("C · D · E");
  await expect(
    page.getByTestId("dsa-svg").locator('[data-node-id="A"]'),
  ).toHaveAttribute("data-node-status", "visited");
  await panel
    .getByRole("button", { name: "Previous step", exact: true })
    .click();
  await expect(page.getByTestId("dsa-current")).toHaveText("A");
  await expect(page.getByTestId("dsa-frontier")).toHaveText("B · C");
  await panel
    .getByRole("combobox", { name: "Traversal algorithm", exact: true })
    .selectOption("dfs");
  await expect(page.getByTestId("dsa-step")).toContainText("Step 0 of");
  await expect
    .poll(async () => (await snapshot(page)).lesson.board.result.algorithm)
    .toBe("dfs");
  expect((await snapshot(page)).lesson.board.id).toBe(initial.lesson.board.id);
  await next(page, 1);
  await next(page, 2);
  await expect(page.getByTestId("dsa-current")).toHaveText("B");
  await expect(page.getByTestId("dsa-frontier")).toHaveText("D · E · C");
  expect((await snapshot(page)).lesson.board.result.frontierKind).toBe("stack");
  expect((await snapshot(page)).lesson.board.result.order).toEqual([
    "A",
    "B",
    "D",
    "E",
    "G",
    "F",
    "C",
  ]);
  await panel
    .getByRole("button", { name: "Restart traversal", exact: true })
    .click();
  await expect(page.getByTestId("dsa-current")).toHaveText("None yet");
  await expect(page.getByTestId("dsa-visited")).toHaveText("None yet");
  await page.screenshot({
    path: "evals/results/dsa-graph-workspace.png",
    fullPage: true,
  });
});

test("fixture DSA: binary tree inorder → BST present/absent search → exact source → undo and reload", async ({
  page,
}) => {
  await uploadedDsa(page, "dsa-tree");
  await askFixture(
    page,
    "Show BFS on 03-binary-tree.json and explain only the current step.",
  );
  const first = await snapshot(page);
  expect(first.lesson.board.result.kind).toBe("binary_tree");
  expect(first.lesson.board.result.order).toEqual([
    "n1",
    "n2",
    "n3",
    "n4",
    "n5",
    "n6",
    "n7",
  ]);
  await askFixture(page, "Use inorder traversal on 03-binary-tree.json.");
  const inorder = await snapshot(page);
  expect(inorder.lesson.board.result.algorithm).toBe("inorder");
  expect(inorder.lesson.board.result.order).toEqual([
    "n4",
    "n2",
    "n5",
    "n1",
    "n6",
    "n3",
    "n7",
  ]);
  await next(page, 1);
  await expect(page.getByTestId("dsa-current")).toHaveText("4");
  await expect(page.getByTestId("dsa-frontier")).toHaveText("1 · 2");
  await expect(
    lessonWorkspace(page)
      .locator(".dsa-state dt")
      .filter({ hasText: "Recursion stack" }),
  ).toBeVisible();
  await lessonWorkspace(page)
    .locator(".workspace-body")
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  await askFixture(
    page,
    "Search for 7 in 04-binary-search-tree.json using BST search. Explain the current comparison only.",
  );
  const search = await snapshot(page),
    bst = search.sources.find((item: any) => item.name === files[3]);
  expect(search.lesson.board.sourceId).toBe(bst.id);
  expect(search.lesson.board.result.kind).toBe("bst");
  expect(search.lesson.board.result.targetValue).toBe(7);
  expect(search.lesson.board.result.order).toEqual(["n8", "n3", "n6", "n7"]);
  await expect(page.getByTestId("dsa-svg")).toBeInViewport({ ratio: 0.2 });
  await expect(page.getByTestId("dsa-playback-bar")).toBeInViewport({
    ratio: 1,
  });
  for (let step = 1; step <= 4; step++) await next(page, step);
  await expect(page.getByTestId("dsa-current")).toHaveText("7");
  await expect(page.getByTestId("dsa-step")).toContainText("Found target 7");
  expect((await snapshot(page)).lesson.board.result.foundId).toBe("n7");

  // The actual resolver must authorize the exact structured-source revision.
  const citation = page
    .locator(".tutor-message")
    .getByRole("button", { name: /04-binary-search-tree\.json.*DSA/ })
    .first();
  await expect(citation).toBeVisible();
  const citationAction = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/api\/lessons\/[^/]+\/actions$/.test(new URL(request.url()).pathname) &&
      request.postDataJSON().type === "source.open",
  );
  await citation.click();
  const opened = (await citationAction).postDataJSON();
  expect(opened.args.sourceId).toBe(bst.id);
  expect(opened.args.versionId).toBe(bst.versionId);
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "Return to problem", exact: true }),
  });
  await expect(
    dialog.getByRole("heading", { name: files[3], exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText("DSA");
  await dialog
    .getByRole("button", { name: "Return to problem", exact: true })
    .click();

  const panel = lessonWorkspace(page);
  await panel.getByLabel("Target value", { exact: true }).fill("5");
  await panel.getByRole("button", { name: "Search tree", exact: true }).click();
  await expect(page.getByTestId("dsa-step")).toContainText("Step 0 of");
  for (let step = 1; step <= 4; step++) await next(page, step);
  await expect(page.getByTestId("dsa-step")).toContainText(
    "target is not in this BST",
  );
  const absent = await snapshot(page);
  expect(absent.lesson.board.result.order).toEqual(["n8", "n3", "n6", "n4"]);
  expect(absent.lesson.board.result.foundId).toBeNull();
  await panel
    .getByRole("button", { name: "Undo board change", exact: true })
    .click();
  await expect(page.getByTestId("dsa-step")).toContainText("Step 3 of");
  const undone = await snapshot(page);
  expect(undone.lesson.board.revision).toBe(absent.lesson.board.revision + 1);
  expect(undone.lesson.board.result.targetValue).toBe(5);
  await page.reload();
  await expect(page.getByTestId("dsa-current")).toHaveText("6");
  const resumed = await snapshot(page);
  expect(resumed.lesson.board.id).toBe(undone.lesson.board.id);
  expect(resumed.lesson.board.revision).toBe(undone.lesson.board.revision);
  expect(resumed.lesson.board.result.stepIndex).toBe(3);
  expect(resumed.lesson.board.sourceVersionId).toBe(bst.versionId);
  await page.screenshot({
    path: "evals/results/dsa-tree-workspace.png",
    fullPage: true,
  });
});

test("fixture DSA: manual source replacement uses the current revision and undo without a model call", async ({
  page,
}) => {
  await uploadedDsa(page, "dsa-manual-change");
  await askFixture(page, "Show BFS on 01-undirected-graph.json from A.");
  await next(page, 1);
  await next(page, 2);
  const before = await snapshot(page),
    tree = before.sources.find((source: any) => source.name === files[2]);
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/(messages|live-ticket)$/.test(path))
      providerRequests.push(path);
  });
  const panel = lessonWorkspace(page);
  await panel.getByText("Change data or visual", { exact: true }).click();
  await expect(
    panel.getByRole("combobox", { name: "Visual type", exact: true }),
  ).toHaveValue("dsa");
  const source = panel.getByRole("combobox", {
    name: "Graph or tree source",
    exact: true,
  });
  await expect(source).toHaveValue(before.lesson.board.sourceId);
  await source.selectOption(tree.id);
  await panel
    .getByRole("combobox", { name: "New traversal algorithm", exact: true })
    .selectOption("inorder");
  const replacement = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/actions$/.test(new URL(request.url()).pathname) &&
      request.postDataJSON().type === "board.replace",
  );
  await panel
    .getByRole("button", { name: "Use this visual", exact: true })
    .click();
  const action = (await replacement).postDataJSON();
  expect(action.targetId).toBe(before.lesson.board.id);
  expect(action.expectedRevision).toBe(before.lesson.board.revision);
  expect(action.args).toMatchObject({
    kind: "dsa",
    sourceId: tree.id,
    algorithm: "inorder",
    stepIndex: 0,
  });
  await expect
    .poll(async () => (await snapshot(page)).lesson.board.sourceId)
    .toBe(tree.id);
  await expect(page.getByTestId("dsa-current")).toHaveText("None yet");
  await expect(
    page.getByTestId("dsa-svg").locator('[data-node-id="n1"]'),
  ).toBeVisible();
  const changed = await snapshot(page);
  expect(changed.lesson.board.id).toBe(before.lesson.board.id);
  expect(changed.lesson.board.sourceVersionId).toBe(tree.versionId);
  expect(changed.lesson.board.result.kind).toBe("binary_tree");
  expect(changed.lesson.board.result.order).toEqual([
    "n4",
    "n2",
    "n5",
    "n1",
    "n6",
    "n3",
    "n7",
  ]);
  expect(providerRequests).toEqual([]);
  await panel
    .getByRole("button", { name: "Undo board change", exact: true })
    .click();
  await expect(page.getByTestId("dsa-current")).toHaveText("B");
  const restored = await snapshot(page);
  expect(restored.lesson.board.sourceId).toBe(before.lesson.board.sourceId);
  expect(restored.lesson.board.sourceVersionId).toBe(
    before.lesson.board.sourceVersionId,
  );
  expect(restored.lesson.board.result.stepIndex).toBe(2);
  expect(restored.lesson.board.result.algorithm).toBe("bfs");
  expect(providerRequests).toEqual([]);
});

test("fixture DSA mobile 360: keyboard stepping and node inspection, 44px controls and axe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await uploadedDsa(page, "dsa-mobile");
  await askFixture(
    page,
    "Show BFS on 01-undirected-graph.json from A. Explain only the current step.",
  );
  const panel = lessonWorkspace(page);
  await expect(panel).toBeVisible();
  const nextButton = panel.getByRole("button", {
    name: "Next step",
    exact: true,
  });
  await primary44(nextButton);
  await primary44(
    panel.getByRole("button", { name: "Previous step", exact: true }),
  );
  await primary44(
    panel.getByRole("button", { name: "Restart traversal", exact: true }),
  );
  await primary44(
    panel.getByRole("button", { name: "Close workspace", exact: true }),
  );
  await nextButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dsa-current")).toHaveText("A");
  await expect(page.getByTestId("dsa-playback-bar")).toHaveCount(1);
  await expect(nextButton).toHaveCount(1);
  await expect(page.getByTestId("dsa-current")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("dsa-frontier")).toBeInViewport({ ratio: 1 });
  await expect(nextButton).toBeInViewport({ ratio: 1 });
  await page.getByTestId("dsa-step").scrollIntoViewIfNeeded();
  const positionBeforeStep = await panel
    .locator(".workspace-body")
    .evaluate((element) => element.scrollTop);
  await next(page, 2);
  const positionAfterStep = await panel
    .locator(".workspace-body")
    .evaluate((element) => element.scrollTop);
  expect(Math.abs(positionAfterStep - positionBeforeStep)).toBeLessThan(2);
  await expect(page.getByTestId("dsa-current")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("dsa-frontier")).toBeInViewport({ ratio: 1 });
  await expect(nextButton).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("dsa-current")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("dsa-frontier")).toBeInViewport({ ratio: 1 });
  await expect(nextButton).toBeInViewport({ ratio: 1 });
  await panel
    .getByText("Explore nodes, edges and steps", { exact: true })
    .click();
  const inspector = panel.getByRole("combobox", {
    name: "Inspect node",
    exact: true,
  });
  await inspector.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(inspector).toHaveValue("G");
  await expect(
    page.getByTestId("dsa-svg").locator('[data-node-id="G"] rect'),
  ).toBeVisible();
  await expect(page.getByTestId("dsa-current")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("dsa-frontier")).toBeInViewport({ ratio: 1 });
  await expect(nextButton).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: "evals/results/dsa-mobile-workspace.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Close workspace", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Ask about your work", { exact: true }),
  ).toBeFocused();
});

test("fixture DSA mobile: large diagram stays readable and its long queue scrolls internally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await loginFixture(page, "dsa-large-mobile");
  const children = Array.from({ length: 30 }, (_, index) => ({
    id: `n${index + 1}`,
    label: `Frontier node ${index + 1}`,
  }));
  const file = {
    format: "live-tutor-dsa-v1",
    teachingExample: true,
    title: "Large graph teaching example",
    structure: {
      kind: "graph",
      directed: true,
      rootId: "A",
      nodes: [{ id: "A", label: "A" }, ...children],
      edges: children.map((node) => ({ from: "A", to: node.id })),
    },
  };
  await page.getByLabel("Upload course files", { exact: true }).setInputFiles({
    name: "large-graph.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(page).toHaveURL(/\/lessons\/[a-f0-9-]+$/);
  await readySources(page, 1);
  await askFixture(
    page,
    "Show BFS on large-graph.json from A. Show the queue.",
  );
  await next(page, 1);
  const queue = page.getByTestId("dsa-frontier"),
    current = page.getByTestId("dsa-current");
  await expect(current).toHaveText("A");
  await expect(queue).toContainText("Frontier node 30");
  await expect(queue).toBeInViewport({ ratio: 1 });
  const dimensions = await queue.evaluate((element) => ({
    content: element.scrollHeight,
    visible: element.clientHeight,
  }));
  expect(dimensions.content).toBeGreaterThan(dimensions.visible);
  expect(dimensions.visible).toBeLessThanOrEqual(54);
  await queue.focus();
  await page.keyboard.press("PageDown");
  await expect
    .poll(() => queue.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const saved = await snapshot(page),
    svg = page.getByTestId("dsa-svg");
  const box = await svg.boundingBox();
  expect(box).not.toBeNull();
  expect(
    (box!.width / saved.lesson.board.result.bounds.width) * 17,
  ).toBeGreaterThanOrEqual(12);
  await expect(
    lessonWorkspace(page).getByRole("button", {
      name: "Next step",
      exact: true,
    }),
  ).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "evals/results/dsa-large-mobile-workspace.png",
    fullPage: true,
  });
});
