import "dotenv/config";
import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Explicit paid tests; never included in the offline suite. No private homework
// is captured: these use original supplied fixtures and synthetic vectors only.
for (const variant of ["original", "unseen", "vectors"])
  test(`real Gemini ${variant}: uploaded work, grounded response and saved visual`, async ({
    page,
    browser,
  }) => {
    if (process.env.RUN_PAID_TUTOR_BROWSER !== "true")
      throw Error(
        "Set RUN_PAID_TUTOR_BROWSER=true for the paid browser probe.",
      );
    const filename = "evals/results/tutor-live-browser.json";
    let history: any = { runs: [] };
    try {
      history = JSON.parse(await readFile(filename, "utf8"));
    } catch {}
    // Root reviewed the retained serializer and truncated-output failures on
    // November 20. Exactly one additional run per variant is authorized after
    // the concrete fixes; this is not an automatic generation retry loop.
    if (history.runs.filter((r: any) => r.variant === variant).length >= 3)
      throw Error(
        "Three-run cap reached for this variant; inspect results before another paid run.",
      );
    const report: any = {
      variant,
      fixture: false,
      provider: "gemini-3.8-flash",
      syntheticInput: true,
      humanParticipants: 0,
      startedAt: new Date().toISOString(),
      browser: browser.version(),
      passed: false,
    };
    history.runs.push(report);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, JSON.stringify(history, null, 2));
    let courseId = "",
      lessonId = "";
    const snapshot = async () => {
      const r = await page.request.get(`/api/lessons/${lessonId}`);
      expect(r.ok()).toBe(true);
      return (await r.json()).lesson;
    };
    const ask = async (text: string) => {
      await page.getByLabel("Ask about your work", { exact: true }).fill(text);
      const pending = page.waitForResponse(
        (r) => r.url().endsWith("/messages") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Ask", exact: true }).click();
      const response = await pending;
      expect(response.status()).toBe(200);
      const stream = await response.text();
      expect(stream).toContain('"type":"complete"');
      expect(stream).not.toContain('"type":"error"');
      await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
      ).toHaveCount(0);
    };
    try {
      await page.goto("/");
      const c = await (await page.request.get("/api/config")).json();
      expect(c.mode).toBe("live");
      expect(c.authentication).toBe("local_test");
      expect(c.textAvailable).toBe(true);
      if (variant === "vectors") {
        const notebook = {
          nbformat: 4,
          nbformat_minor: 5,
          metadata: {},
          cells: [
            {
              id: "live-vector-problem",
              cell_type: "markdown",
              metadata: {},
              source:
                "# Orthogonal projection\n\nUse $u=[2,2]$ and $v=[-1,3]$. Find the dot product and projection of u onto v. Explain why the residual is perpendicular.",
            },
          ],
        };
        await page
          .getByLabel("Upload course files", { exact: true })
          .setInputFiles({
            name: "live-vector-homework.ipynb",
            mimeType: "application/x-ipynb+json",
            buffer: Buffer.from(JSON.stringify(notebook)),
          });
      } else
        await page
          .getByLabel("Upload course files", { exact: true })
          .setInputFiles(
            (variant === "original"
              ? ["lecture.pdf", "attempt.ipynb", "scores.csv"]
              : [
                  "unseen/lecture-renamed.pdf",
                  "unseen/attempt-renamed.ipynb",
                  "unseen/measurements.csv",
                ]
            ).map((f) => path.resolve("fixtures", f)),
          );
      await expect(page).toHaveURL(/\/lessons\/[a-f0-9-]+$/);
      lessonId = page.url().split("/lessons/")[1];
      let l = await snapshot();
      courseId = l.courseId;
      await expect
        .poll(
          async () => {
            const r = await page.request.get(`/api/courses/${courseId}`);
            const d = await r.json();
            return d.sources.every((s: any) => s.status.startsWith("ready"));
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      if (variant === "vectors") {
        await expect(
          page.locator(".notebook-cell .katex-html").first(),
        ).toBeVisible();
        const start = performance.now();
        await ask(
          "Use the uploaded notebook values u = [2,2] and v = [-1,3]. Draw both vectors and the orthogonal projection of u onto v. Explain the actual computed results directly and cite the notebook.",
        );
        await expect(page.getByTestId("vector-dot")).toHaveText("4");
        await expect(page.getByTestId("vector-projection")).toContainText(
          "[-0.4, 1.2]",
        );
        report.firstCorrectVisibleChartProxyMs = Math.round(
          performance.now() - start,
        );
        l = await snapshot();
        expect(l.board.kind).toBe("vectors");
        expect(l.board.result.dot).toBe(4);
        expect(l.board.result.projection[0]).toBeCloseTo(-0.4, 12);
        expect(l.board.result.projection[1]).toBeCloseTo(1.2, 12);
        expect(
          l.messages.filter((m: any) => m.role === "tutor").at(-1).fixture,
        ).toBe(false);
        await page.getByLabel("Vector a x", { exact: true }).fill("1");
        await page.getByLabel("Vector a y", { exact: true }).fill("0");
        await page
          .getByRole("button", { name: "Apply coordinates", exact: true })
          .click();
        await expect(page.getByTestId("vector-dot")).toHaveText("-1");
        await page
          .getByRole("button", { name: "Undo board change", exact: true })
          .click();
        await expect(page.getByTestId("vector-dot")).toHaveText("4");
      } else {
        const start = performance.now();
        await ask(
          "Why does my histogram peak at 3 instead of 0.03? Please explain directly using the uploaded data and cite the exact lecture page.",
        );
        await expect(page.getByTestId("chart-summary")).toContainText(
          "4 intervals",
        );
        report.firstCorrectVisibleChartProxyMs = Math.round(
          performance.now() - start,
        );
        const cite = page
          .locator(".conversation")
          .getByRole("button", { name: /physical page 2/ })
          .first();
        await expect(cite).toBeVisible();
        await cite.click();
        await expect(page.getByLabel("PDF physical page 2")).toBeVisible();
        await page
          .getByRole("button", { name: "Return to problem", exact: true })
          .click();
        const before = await snapshot();
        await ask(
          "Change my existing chart to five bins. Keep the same dataset.",
        );
        await expect(page.getByTestId("chart-summary")).toContainText(
          "5 intervals",
        );
        l = await snapshot();
        expect(l.board.id).toBe(before.board.id);
        expect(l.board.result.counts).toEqual(
          variant === "original" ? [2, 3, 1, 2, 2] : [3, 1, 3, 2, 3],
        );
        await page
          .getByRole("button", { name: "Practice", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Start independent practice",
            exact: true,
          })
          .click();
        await page
          .getByLabel("Your answer and reasoning")
          .fill(
            "Relative frequency = 20%. Density = 0.04 per score unit. Bar area equals probability because density times bin width is relative frequency.",
          );
        await page
          .getByRole("button", { name: "Record my attempt", exact: true })
          .click();
        await expect(
          page.getByText(/Independent response recorded/),
        ).toBeVisible();
        l = await snapshot();
        expect(l.attempts.at(-1).independent).toBe(true);
        expect(l.attempts.at(-1).result.numeric).toBe(true);
      }
      const before = await snapshot();
      await page.reload();
      if (variant === "vectors")
        await expect(page.getByTestId("vector-dot")).toHaveText("4");
      else
        await expect(page.getByTestId("chart-summary")).toContainText(
          "5 intervals",
        );
      const restored = await snapshot();
      expect(restored.board.id).toBe(before.board.id);
      expect(restored.board.revision).toBe(before.board.revision);
      report.providerCalls = restored.messages
        .filter((m: any) => m.role === "tutor")
        .flatMap((m: any) => m.providerCalls ?? []);
      report.board = {
        kind: restored.board.kind,
        revision: restored.board.revision,
        result: restored.board.result,
      };
      report.attempts = restored.attempts.length;
      report.passed = true;
      await page.screenshot({
        path: `evals/results/tutor-live-${variant}.png`,
        fullPage: true,
      });
    } catch (error) {
      report.failure =
        error instanceof Error ? error.message : "Unknown test failure";
      throw error;
    } finally {
      report.finishedAt = new Date().toISOString();
      if (courseId)
        report.courseCleanup = (
          await page.request.delete(`/api/courses/${courseId}`, {
            headers: { origin: "http://localhost:3000" },
          })
        ).ok();
      await writeFile(filename, JSON.stringify(history, null, 2));
    }
  });
