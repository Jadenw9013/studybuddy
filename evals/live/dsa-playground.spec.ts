import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

type Seed = {
  kind: string;
  courseId: string;
  lessonId: string;
  url: string;
  sources: { id: string; name: string; versionId: string; hash: string }[];
};
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Lesson workspace", exact: true });

test("normal-service DSA playground: manual graph/tree/search persistence with zero provider requests", async ({
  page,
}) => {
  const seed: Seed = JSON.parse(
    await readFile(path.resolve(".data/dsa-playground.json"), "utf8"),
  );
  expect(seed.kind).toBe("synthetic-dsa-mock-course");
  expect(new URL(seed.url).origin).toBe("http://localhost:3000");
  expect(new URL(seed.url).pathname).toBe("/lessons/" + seed.lessonId);
  expect(seed.sources).toHaveLength(5);
  const blocked: string[] = [],
    stages: Record<string, unknown>[] = [];
  const report: any = {
    startedAt: new Date().toISOString(),
    fixtureProvider: false,
    providerCalls: 0,
    courseId: seed.courseId,
    lessonId: seed.lessonId,
    syntheticTeachingData: true,
    stages,
    restoredInitialBfs: false,
    passed: false,
  };
  let touched = false;
  await page.route(
    /\/api\/lessons\/[^/]+\/(messages|live-ticket)(?:\?|$)/,
    async (route) => {
      blocked.push(new URL(route.request().url()).pathname);
      await route.fulfill({
        status: 503,
        json: {
          message:
            "This no-provider playground check blocks tutoring and live tickets.",
        },
      });
    },
  );
  const snapshot = async () => {
    const response = await page.request.get("/api/lessons/" + seed.lessonId);
    expect(response.status()).toBe(200);
    return response.json();
  };
  const replace = async (
    sourceName: string,
    algorithm: string,
    target?: number,
  ) => {
    const source = seed.sources.find((item) => item.name === sourceName);
    expect(source).toBeTruthy();
    const form = panel(page).locator("details.visual-create");
    if (
      !(await form.evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await form.locator("summary").click();
    await form
      .getByRole("combobox", { name: "Visual type", exact: true })
      .selectOption("dsa");
    await form
      .getByRole("combobox", { name: "Graph or tree source", exact: true })
      .selectOption(source!.id);
    await form
      .getByRole("combobox", { name: "New traversal algorithm", exact: true })
      .selectOption(algorithm);
    if (target !== undefined)
      await form
        .getByLabel("New search target", { exact: true })
        .fill(String(target));
    await form
      .getByRole("button", { name: "Use this visual", exact: true })
      .click();
    await expect
      .poll(async () => {
        const board = (await snapshot()).lesson.board;
        return {
          sourceId: board.sourceId,
          algorithm: board.result.algorithm,
          step: board.result.stepIndex,
        };
      })
      .toEqual({ sourceId: source!.id, algorithm, step: 0 });
    await expect(page.getByTestId("dsa-current")).toHaveText("None yet");
    const saved = await snapshot();
    expect(saved.lesson.board.sourceVersionId).toBe(source!.versionId);
    return saved;
  };
  try {
    const configuration = await (await page.request.get("/api/config")).json();
    expect(configuration.mode).toBe("live");
    expect(configuration.authentication).toBe("local_test");
    const identity = await (await page.request.get("/api/me")).json();
    expect(identity.authentication).toBe("local_test");
    const courseResponse = await page.request.get(
      "/api/courses/" + seed.courseId,
    );
    expect(courseResponse.status()).toBe(200);
    const course = await courseResponse.json();
    expect(course.sources).toHaveLength(5);
    expect(course.sources.filter((source: any) => source.dsa)).toHaveLength(4);
    report.sourceHashes = [];
    for (const source of seed.sources) {
      const actual = course.sources.find((item: any) => item.id === source.id);
      expect(actual?.status).toBe("ready");
      expect(actual.versionId).toBe(source.versionId);
      expect(
        digest(await readFile(path.resolve("fixtures/dsa", source.name))),
      ).toBe(source.hash);
      const content = await page.request.get(
        `/api/sources/${source.id}/versions/${source.versionId}/content`,
      );
      expect(content.status()).toBe(200);
      const hash = digest(await content.body());
      expect(hash).toBe(source.hash);
      report.sourceHashes.push({
        name: source.name,
        versionId: source.versionId,
        sha256: hash,
        verified: true,
      });
    }
    await page.goto(seed.url);
    await expect(
      page.getByRole("button", { name: "Sources (5)", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("dsa-svg")).toBeVisible();
    const initial = await snapshot();
    expect(initial.lesson.courseId).toBe(seed.courseId);
    expect(initial.lesson.messages).toHaveLength(0);
    expect(initial.lesson.board.sourceId).toBe(seed.sources[0].id);
    expect(initial.lesson.board.result.algorithm).toBe("bfs");
    expect(initial.lesson.board.result.stepIndex).toBe(0);
    expect(
      initial.lesson.board.result.nodes.map((node: any) => node.id),
    ).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    await expect(
      panel(page).getByText("Mock teaching dataset", { exact: true }),
    ).toBeVisible();
    touched = true;
    await panel(page)
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    await expect(page.getByTestId("dsa-current")).toHaveText("A");
    await expect(page.getByTestId("dsa-frontier")).toHaveText("B · C");
    expect((await snapshot()).lesson.board.result.stepIndex).toBe(1);
    stages.push({ name: "bfs", step: 1, currentId: "A" });
    let saved = await replace("03-binary-tree.json", "inorder");
    expect(saved.lesson.board.result.order).toEqual([
      "n4",
      "n2",
      "n5",
      "n1",
      "n6",
      "n3",
      "n7",
    ]);
    await panel(page)
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    await expect(page.getByTestId("dsa-current")).toHaveText("4");
    stages.push({ name: "binary-tree-inorder", step: 1, currentId: "n4" });
    saved = await replace("04-binary-search-tree.json", "search", 7);
    expect(saved.lesson.board.result.order).toEqual(["n8", "n3", "n6", "n7"]);
    for (let step = 1; step <= 4; step++) {
      await panel(page)
        .getByRole("button", { name: "Next step", exact: true })
        .click();
      await expect(page.getByTestId("dsa-step")).toContainText(
        `Step ${step} of`,
      );
    }
    saved = await snapshot();
    expect(saved.lesson.board.result.foundId).toBe("n7");
    await expect(page.getByTestId("dsa-current")).toHaveText("7");
    const revision = saved.lesson.board.revision;
    await page.reload();
    await expect(page.getByTestId("dsa-current")).toHaveText("7");
    saved = await snapshot();
    expect(saved.lesson.board.revision).toBe(revision);
    expect(saved.lesson.board.result.stepIndex).toBe(4);
    expect(saved.lesson.board.sourceVersionId).toBe(seed.sources[3].versionId);
    stages.push({
      name: "bst-search-and-reload",
      target: 7,
      step: 4,
      currentId: "n7",
      revision,
    });
    await replace("01-undirected-graph.json", "bfs");
    report.restoredInitialBfs = true;
    await expect(page.getByTestId("dsa-frontier")).toHaveText("A");
    await mkdir(path.resolve("evals/results"), { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await panel(page)
      .locator(".workspace-body")
      .evaluate((element) => {
        element.scrollTop = 0;
      });
    await page
      .locator("main#main")
      .screenshot({ path: "evals/results/dsa-playground-desktop.png" });
    await page.setViewportSize({ width: 360, height: 800 });
    await panel(page)
      .locator(".workspace-body")
      .evaluate((element) => {
        element.scrollTop = 0;
      });
    await expect(page.getByTestId("dsa-current")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("dsa-frontier")).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .locator("main#main")
      .screenshot({ path: "evals/results/dsa-playground-mobile.png" });
    expect(blocked).toEqual([]);
    report.passed = true;
    report.screenshots = [
      "evals/results/dsa-playground-desktop.png",
      "evals/results/dsa-playground-mobile.png",
    ];
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (touched && !report.restoredInitialBfs) {
      try {
        await replace("01-undirected-graph.json", "bfs");
        report.restoredInitialBfs = true;
      } catch (error) {
        report.restoreFailure =
          error instanceof Error ? error.message : String(error);
      }
    }
    report.finishedAt = new Date().toISOString();
    report.blockedProviderRequests = blocked;
    report.permanentCoursePreserved = true;
    await mkdir(path.resolve("evals/results"), { recursive: true });
    await writeFile(
      path.resolve("evals/results/dsa-playground-browser.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
});
