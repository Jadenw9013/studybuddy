import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  loginFixture,
  uploadFixtureFiles,
  includedLesson,
  createHistogram,
  openWorkspace,
  askFixture,
  snapshot,
  lessonId,
  lessonWorkspace,
  primary44,
  showNotebookPanel,
} from "./fixture-helpers";

for (const variant of ["original", "unseen"])
  test(
    "fixture " +
      variant +
      ": ordinary upload → exact page → five bins → independent attempt → reload",
    async ({ page }) => {
      await loginFixture(page);
      await uploadFixtureFiles(
        page,
        variant === "original"
          ? ["lecture.pdf", "attempt.ipynb", "scores.csv"]
          : [
              "unseen/lecture-renamed.pdf",
              "unseen/attempt-renamed.ipynb",
              "unseen/measurements.csv",
            ],
      );
      await createHistogram(page);
      await askFixture(
        page,
        "Why does my histogram peak at 3 instead of 0.03? Please explain directly.",
      );
      await expect(page.getByTestId("chart-summary")).toContainText(
        "4 intervals",
      );
      const before = await snapshot(page);
      expect(before.lesson.board.result.included).toBe(
        variant === "original" ? 10 : 12,
      );
      if (variant === "original")
        expect(before.lesson.board.result.counts).toEqual([2, 3, 2, 3]);
      const cite = page
        .getByRole("button", { name: /physical page 2/ })
        .first();
      await expect(cite).toBeVisible();
      await cite.click();
      const dialog = page
        .getByRole("dialog")
        .filter({
          has: page.getByRole("button", {
            name: "Return to problem",
            exact: true,
          }),
        });
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel("PDF physical page 2")).toBeVisible();
      await dialog
        .getByRole("button", { name: "Return to problem", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Show data table", exact: true })
        .click();
      if (variant === "original")
        await expect(
          page.locator(".workspace table tbody tr").nth(1),
        ).toContainText("0.03");
      await page.screenshot({
        path: "evals/results/" + variant + "-workspace.png",
        fullPage: true,
      });
      await askFixture(page, "Use five bins");
      await expect(page.getByTestId("chart-summary")).toContainText(
        "5 intervals",
      );
      await expect(page.locator(".workspace table tbody tr")).toHaveCount(5);
      const five = await snapshot(page);
      expect(five.lesson.board.id).toBe(before.lesson.board.id);
      expect(five.lesson.board.result.counts).toEqual(
        variant === "original" ? [2, 3, 1, 2, 2] : [3, 1, 3, 2, 3],
      );
      const practice = await openWorkspace(page, "Practice");
      await practice
        .getByRole("button", {
          name: "Start independent practice",
          exact: true,
        })
        .click();
      await practice
        .getByLabel("Your answer and reasoning")
        .fill(
          "Relative frequency = 20%. Density = 0.04 per score unit. Bar area equals probability, since density times width gives relative frequency.",
        );
      await practice
        .getByRole("button", { name: "Record my attempt", exact: true })
        .click();
      await expect(
        practice.getByText(/Independent response recorded/),
      ).toBeVisible();
      const recorded = await snapshot(page);
      expect(recorded.lesson.attempts).toHaveLength(1);
      expect(recorded.lesson.attempts[0].independent).toBe(true);
      expect(recorded.lesson.attempts[0].result.numeric).toBe(true);
      await page.reload();
      await expect(page.getByTestId("chart-summary")).toContainText(
        "5 intervals",
      );
      await page.getByRole("button", { name: "Recap", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: /Independent first response/ }),
      ).toBeVisible();
      await page.screenshot({
        path: "evals/results/" + variant + "-recap.png",
        fullPage: true,
      });
    },
  );

test("fixture unavailable voice stays honest; mobile text and workspace controls remain accessible", async ({
  page,
}) => {
  await loginFixture(page);
  await includedLesson(page);
  await createHistogram(page);
  await askFixture(page, "Explain my histogram directly");
  const unavailable = await page.request.post(
    "/api/lessons/" + lessonId(page) + "/live-ticket",
    { headers: { Origin: "http://localhost:3000" } },
  );
  expect(unavailable.status()).toBe(503);
  expect(await unavailable.text()).toContain("unavailable");
  await page.setViewportSize({ width: 360, height: 800 });
  await showNotebookPanel(page, "Studio");
  await lessonWorkspace(page)
    .getByRole("button", { name: "Close workspace", exact: true })
    .click();
  await showNotebookPanel(page, "Chat");
  await expect(
    page.getByLabel("Ask about your work", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start live", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Ask about your work").fill("One more question");
  await primary44(page.getByRole("button", { name: "Ask", exact: true }));
  await primary44(
    page.getByRole("button", { name: "Attach course files", exact: true }),
  );
  await primary44(
    page
      .locator(".topbar")
      .getByRole("button", { name: "All notebooks", exact: true }),
  );
  await primary44(page.getByRole("button", { name: "Workspace", exact: true }));
  const panel = await openWorkspace(page, "Visuals");
  await panel
    .getByRole("button", { name: "Screen & notebook tools", exact: true })
    .click();
  await panel.getByRole("button", { name: "Pause tutor", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).lesson.quiet).toBe(true);
  await expect(
    page.getByText("Paused · work silently", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({
    path: "evals/results/mobile-workspace.png",
    fullPage: true,
  });
});
