import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  askFixture,
  includedLesson,
  lessonId,
  loginFixture,
  primary44,
  showNotebookPanel,
  snapshot,
  uploadFixtureFiles,
} from "./fixture-helpers";

const library = (page: Page) =>
  page.getByRole("region", { name: "Notebook library", exact: true });
const sources = (page: Page) =>
  page.getByRole("complementary", { name: "Notebook sources", exact: true });
const studio = (page: Page) =>
  page.getByRole("complementary", { name: "Studio", exact: true });
async function openLibrary(page: Page) {
  await page
    .locator(".topbar")
    .getByRole("button", { name: "All notebooks", exact: true })
    .click();
  await expect(library(page)).toBeVisible();
}
async function createNotebook(page: Page, name: string) {
  await library(page)
    .locator(".nl-header")
    .getByRole("button", { name: "Create notebook", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create a notebook",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Notebook name", { exact: true }).fill(name);
  await dialog
    .getByRole("button", { name: "Create notebook", exact: true })
    .click();
  await expect(page).toHaveURL(/\/lessons\/[a-f0-9-]+$/);
  await expect(
    page
      .locator(".topbar")
      .getByRole("button", { name: "Sources (0)", exact: true }),
  ).toBeVisible();
  return snapshot(page);
}

test("fixture notebook library: create real notebooks, upload counts, search/list/sort, rename and resume", async ({
  page,
}) => {
  await loginFixture(page, "notebook-library", { openDraft: false });
  const first = await createNotebook(page, "Algorithms study notebook");
  await uploadFixtureFiles(page, [
    "lecture.pdf",
    "scores.csv",
    "attempt.ipynb",
  ]);
  const firstLesson = lessonId(page),
    firstCourse = first.lesson.courseId;
  await openLibrary(page);
  await expect(
    library(page)
      .locator(`[data-course-id="${firstCourse}"]`)
      .getByRole("button", {
        name: "Open sources for Algorithms study notebook",
        exact: true,
      }),
  ).toHaveText("3 sources");
  await createNotebook(page, "Biology study notebook");
  const second = await snapshot(page);
  await openLibrary(page);
  const collection = library(page).locator(".nl-notebooks");
  await expect(collection.locator(":scope > li")).toHaveCount(2);
  const algorithmCard = collection.locator(`[data-course-id="${firstCourse}"]`);
  await expect(
    algorithmCard.getByRole("button", {
      name: "Open sources for Algorithms study notebook",
      exact: true,
    }),
  ).toHaveText("3 sources");
  await expect(algorithmCard).toContainText("1 lesson");
  await library(page)
    .getByLabel("Search notebooks", { exact: true })
    .fill("algorithms");
  await expect(collection.locator(":scope > li")).toHaveCount(1);
  await library(page)
    .getByRole("button", { name: "List view", exact: true })
    .click();
  await expect(collection).toHaveClass(/nl-list/);
  await algorithmCard
    .getByRole("button", {
      name: "Rename notebook Algorithms study notebook",
      exact: true,
    })
    .click();
  const rename = page.getByRole("dialog", {
    name: "Rename notebook",
    exact: true,
  });
  await expect(rename).toBeVisible();
  await rename
    .getByLabel("Notebook name", { exact: true })
    .fill("Discrete structures");
  const persisted = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === `/api/courses/${firstCourse}`,
  );
  await rename.getByRole("button", { name: "Save name", exact: true }).click();
  expect((await persisted).status()).toBe(200);
  await expect(rename).not.toBeVisible();
  await expect(
    library(page).getByRole("heading", {
      name: "No matching notebooks",
      exact: true,
    }),
  ).toBeVisible();
  await library(page).getByLabel("Search notebooks", { exact: true }).fill("");
  await library(page)
    .getByLabel("Sort notebooks", { exact: true })
    .selectOption("name");
  await expect(collection.locator(":scope > li").first()).toHaveAttribute(
    "data-course-id",
    second.lesson.courseId,
  );
  await library(page)
    .getByLabel("Sort notebooks", { exact: true })
    .selectOption("sources");
  await expect(collection.locator(":scope > li").first()).toHaveAttribute(
    "data-course-id",
    firstCourse,
  );
  await library(page)
    .getByRole("button", { name: "With sources", exact: true })
    .click();
  await expect(collection.locator(":scope > li")).toHaveCount(1);
  await library(page)
    .getByRole("button", { name: "Grid view", exact: true })
    .click();
  await expect(collection).toHaveClass(/nl-grid/);
  await library(page)
    .getByRole("button", {
      name: "Resume notebook Discrete structures",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL("/lessons/" + firstLesson);
  await expect(
    page
      .locator(".topbar")
      .getByRole("button", { name: "Sources (3)", exact: true }),
  ).toBeVisible();
  const saved = await snapshot(page);
  expect(saved.lesson.courseId).toBe(firstCourse);
  expect(saved.sources).toHaveLength(3);
  const me = await (await page.request.get("/api/me")).json();
  expect(
    me.courses.find((course: any) => course.id === firstCourse),
  ).toMatchObject({
    name: "Discrete structures",
    sourceCount: 3,
    lessonCount: 1,
  });
  await openLibrary(page);
  await expect(library(page).locator(".nl-notebooks > li")).toHaveCount(2);
  await page.screenshot({
    path: "evals/results/notebook-library.png",
    fullPage: true,
  });
});

test("fixture notebook sources: selection persists, zero sources blocks Studio, cited answer saves and edited note resumes", async ({
  page,
}) => {
  await loginFixture(page, "notebook-notes");
  await includedLesson(page);
  const original = await snapshot(page),
    lecture = original.sources.find(
      (source: any) => source.name === "lecture.pdf",
    );
  await sources(page)
    .getByRole("checkbox", { name: "Select all ready sources", exact: true })
    .uncheck();
  await expect
    .poll(async () => (await snapshot(page)).lesson.selectedSourceIds)
    .toEqual([]);
  await page.reload();
  await expect(
    sources(page).getByRole("checkbox", {
      name: "Select all ready sources",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    studio(page).getByRole("button", {
      name: "Generate flashcards",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    studio(page).getByRole("button", { name: "Generate quiz", exact: true }),
  ).toBeDisabled();
  const denied = await page.request.post(
    `/api/lessons/${lessonId(page)}/studio`,
    {
      headers: { Origin: new URL(page.url()).origin },
      data: { requestId: crypto.randomUUID(), kind: "flashcards" },
    },
  );
  expect(denied.status()).toBe(409);
  await sources(page)
    .getByRole("checkbox", { name: "Use lecture.pdf", exact: true })
    .check();
  await expect
    .poll(async () => (await snapshot(page)).lesson.selectedSourceIds)
    .toEqual([lecture.id]);
  await page.reload();
  await expect(
    sources(page).getByRole("checkbox", {
      name: "Use lecture.pdf",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    sources(page).getByRole("checkbox", {
      name: "Use scores.csv",
      exact: true,
    }),
  ).not.toBeChecked();
  await askFixture(
    page,
    "Explain count versus density directly from the selected lecture.",
  );
  const answered = await snapshot(page),
    answer = answered.lesson.messages
      .filter((message: any) => message.role === "tutor")
      .at(-1);
  expect(answer.citations.length).toBeGreaterThan(0);
  expect(
    answer.citations.every(
      (citation: any) =>
        citation.sourceId === lecture.id &&
        citation.versionId === lecture.versionId,
    ),
  ).toBe(true);
  await page
    .locator(".tutor-message")
    .last()
    .getByRole("button", { name: "Save response to note", exact: true })
    .click();
  const notes = page.getByRole("region", { name: "Saved notes", exact: true });
  await expect(notes.locator(".saved-note")).toHaveCount(1);
  await notes.locator(".saved-note summary").click();
  await notes.getByRole("button", { name: "Edit", exact: true }).click();
  await notes
    .getByLabel("Note title", { exact: true })
    .fill("Count and density recap");
  await notes
    .getByLabel("Your note", { exact: true })
    .fill(
      "Density divides count by sample size and bin width. Bar area gives relative frequency.",
    );
  await notes.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(notes.locator(".saved-note summary")).toContainText(
    "Count and density recap",
  );
  let saved = (
    await (
      await page.request.get(`/api/lessons/${lessonId(page)}/notes`)
    ).json()
  ).notes[0];
  expect(saved.fromMessageId).toBe(answer.id);
  expect(saved.revision).toBe(2);
  expect(saved.citations.map((citation: any) => citation.sourceId)).toEqual(
    answer.citations.map((citation: any) => citation.sourceId),
  );
  await page.reload();
  await expect(notes.locator(".saved-note summary")).toContainText(
    "Count and density recap",
  );
  await notes.locator(".saved-note summary").click();
  await expect(notes).toContainText("Bar area gives relative frequency.");
  saved = (await snapshot(page)).lesson.notes[0];
  expect(saved.revision).toBe(2);
  expect(saved.citations[0].versionId).toBe(lecture.versionId);
});

test("fixture Studio: flashcard recall and quiz answer persist separately from independent attempts", async ({
  page,
}) => {
  await loginFixture(page, "notebook-studio");
  await includedLesson(page);
  const tools = page.getByRole("region", { name: "Study tools", exact: true });
  await tools
    .getByRole("button", { name: "Generate flashcards", exact: true })
    .click();
  const cards = tools.getByRole("article", {
    name: "Development fixture flashcards",
    exact: true,
  });
  await expect(cards).toBeVisible();
  await expect(cards).toContainText(
    "Development fixture · source excerpts, not a live provider result",
  );
  await cards
    .getByRole("button", { name: "Reveal answer", exact: true })
    .click();
  await expect(
    cards.locator(".studio-citations .citation").first(),
  ).toBeVisible();
  await cards.getByRole("button", { name: "Mark known", exact: true }).click();
  await expect(cards).toContainText("Known");
  let artifacts = (
    await (
      await page.request.get(`/api/lessons/${lessonId(page)}/studio`)
    ).json()
  ).artifacts;
  const cardArtifact = artifacts.find(
    (artifact: any) => artifact.kind === "flashcards",
  );
  expect(cardArtifact.fixture).toBe(true);
  expect(cardArtifact.progress.knownCardIds).toHaveLength(1);
  await tools
    .getByRole("button", { name: "Generate quiz", exact: true })
    .click();
  const quiz = tools.getByRole("article", {
    name: "Development fixture source quiz",
    exact: true,
  });
  await expect(quiz).toBeVisible();
  await quiz.locator(".studio-options button").first().click();
  await expect(quiz.locator(".studio-feedback")).toContainText("Correct");
  artifacts = (
    await (
      await page.request.get(`/api/lessons/${lessonId(page)}/studio`)
    ).json()
  ).artifacts;
  const quizArtifact = artifacts.find(
    (artifact: any) => artifact.kind === "quiz",
  );
  expect(Object.values(quizArtifact.progress.answers)).toEqual([0]);
  expect((await snapshot(page)).lesson.attempts).toHaveLength(0);
  await page.reload();
  await tools
    .getByRole("button", { name: /Development fixture source quiz/ })
    .click();
  await expect(quiz.locator(".studio-feedback")).toContainText("Correct");
  await tools
    .getByRole("button", { name: /Development fixture flashcards/ })
    .click();
  await expect(cards).toContainText("Known");
  await page.screenshot({
    path: "evals/results/notebook-workspace.png",
    fullPage: true,
  });
});

test("fixture mobile notebook panels: Sources/Chat/Studio keyboard flow and saved note remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await loginFixture(page, "notebook-mobile");
  await includedLesson(page);
  const tabs = page.getByRole("navigation", {
    name: "Notebook panels",
    exact: true,
  });
  for (const name of ["Sources", "Chat", "Studio"])
    await primary44(tabs.getByRole("button", { name, exact: true }));
  await showNotebookPanel(page, "Sources");
  await expect(sources(page)).toBeVisible();
  await primary44(
    sources(page).getByRole("button", { name: "Add sources", exact: true }),
  );
  await sources(page)
    .getByRole("button", { name: "Create note", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    tabs.getByRole("button", { name: "Studio", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const notes = page.getByRole("region", { name: "Saved notes", exact: true });
  await notes
    .getByLabel("Note title", { exact: true })
    .fill("Mobile study note");
  await notes
    .getByLabel("Your note", { exact: true })
    .fill("Remember to distinguish counts from density.");
  await primary44(
    notes.getByRole("button", { name: "Save note", exact: true }),
  );
  await notes.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(notes.locator(".saved-note summary")).toContainText(
    "Mobile study note",
  );
  await showNotebookPanel(page, "Chat");
  await expect(
    page.getByLabel("Ask about your work", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Ask about your work", { exact: true })
    .fill("Draft a question");
  await primary44(page.getByRole("button", { name: "Ask", exact: true }));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await showNotebookPanel(page, "Studio");
  await expect(notes.locator(".saved-note summary")).toContainText(
    "Mobile study note",
  );
  await page.screenshot({
    path: "evals/results/notebook-workspace-mobile.png",
    fullPage: true,
  });
});
