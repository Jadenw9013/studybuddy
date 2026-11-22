import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  loginFixture,
  readySources,
  askFixture,
  lessonWorkspace,
  openWorkspace,
  snapshot,
  primary44,
  showNotebookPanel,
} from "./fixture-helpers";

function algebraNotebook() {
  return Buffer.from(
    JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
      },
      cells: [
        {
          id: "projection-prompt",
          cell_type: "markdown",
          metadata: {},
          source:
            "# Linear algebra homework\n\nFor vectors $u = \\begin{bmatrix}2\\\\2\\end{bmatrix}$ and $v = \\begin{bmatrix}-1\\\\3\\end{bmatrix}$, find the dot product and the orthogonal projection of vector $u$ onto $v$.\n\n$$\n\\operatorname{proj}_v(u)=\\frac{u\\cdot v}{v\\cdot v}v\n$$",
        },
        {
          id: "student-attempt",
          cell_type: "code",
          metadata: {},
          execution_count: null,
          outputs: [],
          source:
            "import numpy as np\nu = np.array([2., 2.])\nv = np.array([-1., 3.])\nprint(np.dot(u, v))",
        },
        {
          id: "independent-reasoning",
          cell_type: "markdown",
          metadata: {},
          source:
            "Explain why the residual $u - \\operatorname{proj}_v(u)$ is perpendicular to $v$. The saved notebook code has not been executed by this tutor.",
        },
      ],
    }),
  );
}

test("fixture linear algebra notebook: rendered math → selected cell → typed vector visual → coordinates → undo → reload", async ({
  page,
}) => {
  await loginFixture(page, "linear-algebra");
  await page
    .getByLabel("Upload course files", { exact: true })
    .setInputFiles({
      name: "linear-algebra-homework.ipynb",
      mimeType: "application/x-ipynb+json",
      buffer: algebraNotebook(),
    });
  await expect(page).toHaveURL(/\/lessons\/[a-f0-9-]+$/);
  await readySources(page, 1);
  const materials = await openWorkspace(page, "Materials"),
    cell = materials.locator(
      '.notebook-cell[data-cell-id="projection-prompt"]',
    );
  await expect(
    materials.getByRole("heading", {
      name: "linear-algebra-homework.ipynb",
      exact: true,
    }),
  ).toBeVisible();
  await expect(cell.locator(".katex-html").first()).toBeVisible();
  await expect(cell.locator(".katex-display")).toHaveCount(1);
  await expect(
    materials.getByLabel("Code in cell 2", { exact: true }),
  ).toContainText("np.dot(u, v)");
  await materials
    .getByRole("button", { name: "Ask about this cell, cell 1", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove selected cell", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Ask about your work")).toBeFocused();
  const message = page.waitForRequest(
    (request) =>
      /\/api\/lessons\/[^/]+\/messages$/.test(
        new URL(request.url()).pathname,
      ) && request.method() === "POST",
  );
  await askFixture(
    page,
    "Explain the projection of u onto v in the selected cell, and draw both vectors.",
  );
  const sent = (await message).postDataJSON();
  expect(sent.text).toContain("projection-prompt");
  expect(sent.text).toContain("Selected uploaded cell");
  await expect(page.getByTestId("vector-dot")).toHaveText("4");
  await expect(page.locator(".visual-vector-svg")).toBeVisible();
  await expect(page.getByTestId("vector-projection")).toContainText(
    "[-0.4, 1.2]",
  );
  const original = await snapshot(page);
  expect(original.sources).toHaveLength(1);
  expect(original.lesson.board.kind).toBe("vectors");
  expect(original.lesson.board.vectorA).toEqual([2, 2]);
  expect(original.lesson.board.vectorB).toEqual([-1, 3]);
  expect(original.lesson.board.result.dot).toBe(4);
  const boardId = original.lesson.board.id;
  await page.getByLabel("Vector a x", { exact: true }).fill("1");
  await page.getByLabel("Vector a y", { exact: true }).fill("0");
  await page.getByLabel("Vector b x", { exact: true }).fill("0");
  await page.getByLabel("Vector b y", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Apply coordinates", exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot(page)).lesson.board.revision)
    .toBe(2);
  await expect(page.getByTestId("vector-dot")).toHaveText("0");
  await expect(page.getByTestId("vector-angle")).toHaveText("90°");
  expect((await snapshot(page)).lesson.board.id).toBe(boardId);
  await lessonWorkspace(page)
    .getByRole("button", { name: "Undo board change", exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot(page)).lesson.board.revision)
    .toBe(3);
  await expect(page.getByTestId("vector-dot")).toHaveText("4");
  await page.reload();
  await expect(page.getByTestId("vector-dot")).toHaveText("4");
  const resumed = await snapshot(page);
  expect(resumed.lesson.board.id).toBe(boardId);
  expect(resumed.lesson.board.revision).toBe(3);
  expect(resumed.lesson.board.vectorA).toEqual([2, 2]);
  await page.screenshot({
    path: "evals/results/linear-algebra-workspace.png",
    fullPage: true,
  });
});

test("fixture mobile 360: source-less vector keyboard edits, readable workspace, axe and primary 44px controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await loginFixture(page, "vector-mobile");
  await askFixture(
    page,
    "Show vectors u = [2, 2] and v = [-1, 3], with their angle and the projection of u onto v.",
  );
  await showNotebookPanel(page, "Studio");
  await expect(page.getByTestId("vector-dot")).toHaveText("4");
  const panel = lessonWorkspace(page);
  const handle = panel.getByRole("button", { name: /Move vector a endpoint/ });
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await snapshot(page)).lesson.board.vectorA)
    .toEqual([2.1, 2]);
  await expect(page.getByTestId("vector-dot")).toHaveText("3.9");
  await primary44(
    panel.getByRole("button", { name: "Close workspace", exact: true }),
  );
  await primary44(
    panel.getByRole("button", { name: "Materials", exact: true }),
  );
  await primary44(panel.getByRole("button", { name: "Visuals", exact: true }));
  await primary44(panel.getByRole("button", { name: "Practice", exact: true }));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const workspaceAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(workspaceAxe.violations).toEqual([]);
  await page.screenshot({
    path: "evals/results/linear-algebra-mobile.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Close workspace", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await showNotebookPanel(page, "Chat");
  await expect(
    page.getByLabel("Ask about your work", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Ask about your work")
    .fill("Explain the edited vector");
  await primary44(page.getByRole("button", { name: "Ask", exact: true }));
  await primary44(
    page.getByRole("button", { name: "Attach course files", exact: true }),
  );
  await primary44(page.getByRole("button", { name: "Workspace", exact: true }));
  const composerAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(composerAxe.violations).toEqual([]);
  await page.getByRole("button", { name: "Workspace", exact: true }).focus();
  await page.keyboard.press("Enter");
  await showNotebookPanel(page, "Studio");
  await lessonWorkspace(page)
    .getByRole("button", { name: "Visuals", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("vector-dot")).toHaveText("3.9");
});
