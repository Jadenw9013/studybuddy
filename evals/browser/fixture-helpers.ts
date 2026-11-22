import { expect, type Page, type Locator } from "@playwright/test";
import path from "node:path";

/** This suite cannot silently reuse a paid/live development server. */
export async function loginFixture(
  page: Page,
  prefix = "learner",
  options: { openDraft?: boolean } = {},
) {
  await page.goto("/");
  const configuration = await (await page.request.get("/api/config")).json();
  expect(configuration.mode).toBe("fixture");
  await page
    .getByLabel("Email", { exact: true })
    .fill(prefix + "-" + crypto.randomUUID() + "@example.test");
  await page.getByLabel("I am 18").check();
  await page.getByLabel("I understand private").check();
  await page.getByRole("button", { name: "Send a code", exact: true }).click();
  await page.getByLabel("One-time code").fill("246810");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Notebook library", exact: true }),
  ).toBeVisible();
  if (options.openDraft === false) return;
  await page
    .locator(".topbar")
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "What are we learning today?",
      exact: true,
    }),
  ).toBeVisible();
}
export async function showNotebookPanel(
  page: Page,
  view: "Sources" | "Chat" | "Studio",
) {
  const tabs = page.getByRole("navigation", {
    name: "Notebook panels",
    exact: true,
  });
  if (await tabs.isVisible()) {
    const button = tabs.getByRole("button", { name: view, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
}
export const lessonWorkspace = (page: Page) =>
  page.getByRole("complementary", { name: "Lesson workspace", exact: true });
export async function openWorkspace(
  page: Page,
  view: "Materials" | "Visuals" | "Practice",
) {
  if (!(await lessonWorkspace(page).count())) {
    await showNotebookPanel(page, "Chat");
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
  }
  await showNotebookPanel(page, "Studio");
  const panel = lessonWorkspace(page);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: view, exact: true }).click();
  return panel;
}
export async function readySources(page: Page, count: number) {
  const sources = page.getByRole("button", {
    name: "Sources (" + count + ")",
    exact: true,
  });
  await expect(sources).toBeVisible();
  await sources.click();
  const dialog = page.getByRole("dialog", {
    name: "Course sources",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Ready · version 1", { exact: true }),
  ).toHaveCount(count, { timeout: 30000 });
  await dialog
    .getByRole("button", { name: "Close sources", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
export async function uploadFixtureFiles(page: Page, files: string[]) {
  await page
    .getByLabel("Upload course files", { exact: true })
    .setInputFiles(files.map((file) => path.resolve("fixtures", file)));
  await expect(page).toHaveURL(/\/lessons\/[a-f0-9-]+$/);
  await readySources(page, files.length);
}
export async function includedLesson(page: Page) {
  await page
    .getByRole("button", {
      name: "Try the included statistics course",
      exact: true,
    })
    .click();
  await readySources(page, 3);
  await page.getByRole("button", { name: "Open lesson", exact: true }).click();
  await expect(page).toHaveURL(/\/lessons\/[a-f0-9-]+$/);
}
export async function createHistogram(page: Page) {
  const panel = await openWorkspace(page, "Visuals");
  await panel.getByText("Create a visual", { exact: true }).click();
  await panel
    .getByRole("combobox", { name: "Visual type", exact: true })
    .selectOption("histogram");
  await expect(
    panel.getByRole("button", { name: "Create histogram", exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: "Create histogram", exact: true })
    .click();
  await expect(page.getByTestId("chart-summary")).toContainText("4 intervals");
  await expect(page.locator(".chart svg")).toBeVisible();
  return panel;
}
export async function askFixture(page: Page, question: string) {
  await showNotebookPanel(page, "Chat");
  const before = await page.locator(".tutor-message").count();
  await page.getByLabel("Ask about your work", { exact: true }).fill(question);
  const pending = page.waitForResponse(
    (response) =>
      /\/api\/lessons\/[^/]+\/messages$/.test(
        new URL(response.url()).pathname,
      ) && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await response.finished();
  if (response.headers()["content-type"]?.includes("application/x-ndjson")) {
    const events = (await response.text())
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "complete")).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
  }
  await expect(page.locator(".tutor-message")).toHaveCount(before + 1);
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toHaveCount(0);
}
export function lessonId(page: Page) {
  const id = new URL(page.url()).pathname.match(/^\/lessons\/([^/]+)/)?.[1];
  if (!id) throw Error("Expected a saved lesson URL.");
  return id;
}
export async function snapshot(page: Page) {
  const response = await page.request.get("/api/lessons/" + lessonId(page));
  expect(response.status()).toBe(200);
  return response.json();
}
export async function primary44(control: Locator) {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}
