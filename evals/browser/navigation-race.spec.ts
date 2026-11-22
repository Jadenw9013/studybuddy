import { test, expect, type APIResponse, type Page } from "@playwright/test";
import {
  askFixture,
  includedLesson,
  lessonId,
  loginFixture,
  snapshot,
} from "./fixture-helpers";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Hold delivery only after the unpaid fixture has executed and saved its reply. */
async function holdReply(page: Page, targetId: string) {
  const ready = deferred<APIResponse>();
  const release = deferred<"success" | "error">();
  const delivered = deferred<void>();
  let started = false;
  await page.route(`**/api/lessons/${targetId}/messages`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    started = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "complete")).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
    ready.resolve(response);
    const outcome = await release.promise;
    try {
      if (outcome === "error") {
        await route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body:
            JSON.stringify({ type: "progress", stage: "visual_check" }) +
            "\n" +
            JSON.stringify({
              type: "error",
              message: "Stale conversation A delivery failed.",
            }) +
            "\n",
        });
      } else {
        await route.fulfill({ response });
      }
    } finally {
      delivered.resolve();
    }
  });
  return {
    ready: ready.promise,
    async release(outcome: "success" | "error" = "success") {
      release.resolve(outcome);
      if (started) await delivered.promise;
    },
  };
}

async function submit(page: Page, text: string) {
  await page.getByLabel("Ask about your work", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

// A rendering barrier after a delivered fetch lets its microtasks and React commit finish.
async function rendered(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

for (const outcome of ["success", "error"] as const) {
  test(`fixture navigation: stale A ${outcome} cannot replace or clear pending B`, async ({
    page,
  }) => {
    await loginFixture(page, "navigation-" + outcome);
    await includedLesson(page);
    const a = lessonId(page),
      savedA = await snapshot(page);
    const createdB = await page.request.post("/api/lessons", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        courseId: savedA.lesson.courseId,
        goal: "Separate conversation B",
      },
    });
    expect(createdB.status()).toBe(200);
    const b = (await createdB.json()).id;
    // Seed real app history through the library, then use browser Forward for
    // the pending A→B navigation. This preserves the same app/async requests.
    await page.reload();
    await expect(
      page
        .locator(".topbar")
        .getByRole("button", { name: "Sources (3)", exact: true }),
    ).toBeVisible();
    await page
      .locator(".topbar")
      .getByRole("button", { name: "All notebooks", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Notebook library", exact: true })
      .locator(`[data-course-id="${savedA.lesson.courseId}"] .nl-notebook-open`)
      .click();
    await expect(page).toHaveURL("/lessons/" + b);
    await expect(
      page
        .locator(".topbar")
        .getByRole("button", { name: "Sources (3)", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL("/");
    await page.goBack();
    await expect(page).toHaveURL("/lessons/" + a);
    await expect(
      page
        .locator(".topbar")
        .getByRole("button", { name: "Sources (3)", exact: true }),
    ).toBeVisible();
    const heldA = await holdReply(page, a),
      heldB = await holdReply(page, b);
    const questionA = "Explain relative frequency directly in conversation A.";
    const questionB =
      "Explain conditional probability directly in conversation B.";
    try {
      await submit(page, questionA);
      await heldA.ready;
      await expect(page.locator(".pending-message")).toContainText(questionA);
      const bLoaded = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/lessons/${b}`,
      );
      const bCourseLoaded = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
          `/api/courses/${savedA.lesson.courseId}`,
      );
      await page.goForward();
      await expect(page).toHaveURL("/");
      await page.goForward();
      await expect(page).toHaveURL("/lessons/" + b);
      await (await bLoaded).finished();
      await (await bCourseLoaded).finished();
      await rendered(page);
      await submit(page, questionB);
      await heldB.ready;
      await expect(page.locator(".pending-message")).toContainText(questionB);
      await expect(page.locator('.thinking[role="status"]')).toHaveText(
        "Finding relevant coursework…",
      );

      const finishedA = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/lessons/${a}/messages` &&
          response.request().method() === "POST",
      );
      const aRefresh =
        outcome === "success"
          ? page.waitForResponse(
              (response) => new URL(response.url()).pathname === "/api/me",
            )
          : null;
      await heldA.release(outcome);
      await (await finishedA).finished();
      if (aRefresh) await (await aRefresh).finished();
      await rendered(page);

      await expect(page).toHaveURL("/lessons/" + b);
      await expect(page.locator(".pending-message")).toContainText(questionB);
      await expect(page.locator('.thinking[role="status"]')).toHaveText(
        "Finding relevant coursework…",
      );
      await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Ask", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByLabel("Ask about your work", { exact: true }),
      ).toHaveValue("");
      await expect(page.locator('.notice[role="alert"]')).toHaveCount(0);
      await expect(
        page.locator(".student-message").filter({ hasText: questionA }),
      ).toHaveCount(0);

      await heldB.release();
      await expect(page.locator(".tutor-message")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".student-message")).toHaveCount(1);
      await expect(page.locator(".student-message")).toContainText(questionB);
      const savedB = await snapshot(page);
      expect(savedB.lesson.id).toBe(b);
      expect(
        savedB.lesson.messages
          .filter((message: any) => message.role === "student")
          .map((message: any) => message.text),
      ).toEqual([questionB]);
      expect(
        savedB.lesson.messages.find((message: any) => message.role === "tutor")
          .fixture,
      ).toBe(true);
    } finally {
      await Promise.allSettled([heldA.release(outcome), heldB.release()]);
    }
  });
}

test("fixture navigation: delayed lesson creation cannot redirect a newer conversation", async ({
  page,
}) => {
  await loginFixture(page, "creation-navigation");
  const ready = deferred<string>(),
    release = deferred<void>(),
    delivered = deferred<void>();
  let started = false;
  await page.route("**/api/lessons", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    started = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    ready.resolve((await response.json()).id);
    await release.promise;
    try {
      await route.fulfill({ response });
    } finally {
      delivered.resolve();
    }
  });
  const messages: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/lessons\/[^/]+\/messages$/.test(new URL(request.url()).pathname)
    )
      messages.push(request.url());
  });
  try {
    await submit(
      page,
      "This old question must stay out of my new conversation.",
    );
    const createdId = await ready.promise;
    // This also exercises cancelling on the same URL, where pathname never changes.
    await page
      .locator(".topbar")
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    const nextDraft = "Keep this new conversation draft.";
    await page
      .getByLabel("Ask about your work", { exact: true })
      .fill(nextDraft);
    const courseRead = page.waitForResponse((response) =>
      /\/api\/courses\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    release.resolve();
    if (started) await delivered.promise;
    await (await courseRead).finished();
    await rendered(page);
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", {
        name: "What are we learning today?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Ask about your work", { exact: true }),
    ).toHaveValue(nextDraft);
    await expect(
      page.getByRole("button", { name: "Ask", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Stop response", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.notice[role="alert"]')).toHaveCount(0);
    expect(messages).toEqual([]);
    const abandoned = await page.request.get("/api/lessons/" + createdId);
    expect(abandoned.status()).toBe(200);
    expect((await abandoned.json()).lesson.messages).toEqual([]);
  } finally {
    release.resolve();
    if (started) await delivered.promise;
  }
});

test("fixture navigation: saved lesson actions wait for its initial load without creating a blank lesson", async ({
  page,
}) => {
  await loginFixture(page, "saved-lesson-loading");
  await includedLesson(page);
  const savedUrl = page.url(),
    existingId = lessonId(page),
    original = await snapshot(page);
  // Advertise voice readiness in the UI while retaining fixture-only upstream.
  // A blocked ticket route guarantees this regression can never invoke a provider.
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch(),
      configuration = await response.json();
    expect(configuration.mode).toBe("fixture");
    await route.fulfill({
      response,
      json: { ...configuration, liveAvailable: true },
    });
  });
  await page.route("**/live-ticket", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Fixture regression blocks all live tickets." },
    }),
  );
  const held = deferred<void>(),
    release = deferred<void>(),
    delivered = deferred<void>();
  await page.route(`**/api/lessons/${existingId}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    held.resolve();
    await release.promise;
    try {
      await route.fulfill({ response });
    } finally {
      delivered.resolve();
    }
  });
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST")
      mutations.push(new URL(request.url()).pathname);
  });
  try {
    await page.goto(savedUrl);
    await held.promise;
    await expect(page.getByTestId("lesson-loading")).toBeVisible();
    const question = page.getByLabel("Ask about your work", { exact: true });
    await question.fill("Keep this draft with the saved course.");
    const voice = page.getByRole("button", { name: "Start live", exact: true });
    await expect(voice).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Ask", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Attach course files", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("Upload course files", { exact: true }),
    ).toBeDisabled();
    // A keyboard submit also exercises the handler guard, independently of button state.
    await question.press("Enter");
    await voice.evaluate((button: HTMLButtonElement) => button.click());
    await rendered(page);
    expect(mutations).toEqual([]);
    await expect(page).toHaveURL(savedUrl);
    await expect(question).toHaveValue(
      "Keep this draft with the saved course.",
    );
    await expect(page.getByRole("button", { name: /^Sources \(/ })).toHaveCount(
      0,
    );
    release.resolve();
    await delivered.promise;
    await expect(
      page.getByRole("button", { name: "Sources (3)", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("lesson-loading")).toHaveCount(0);
    await expect(voice).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Ask", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Attach course files", exact: true }),
    ).toBeEnabled();
    expect(mutations).toEqual([]);
    const restored = await snapshot(page);
    expect(restored.lesson.id).toBe(existingId);
    expect(restored.lesson.courseId).toBe(original.lesson.courseId);
    expect(restored.sources.map((source: any) => source.id)).toEqual(
      original.sources.map((source: any) => source.id),
    );
    await askFixture(
      page,
      "Explain conditional probability directly in this saved course.",
    );
    expect(
      mutations.filter(
        (path) =>
          path === "/api/lessons" ||
          path === "/api/courses" ||
          path.endsWith("/live-ticket"),
      ),
    ).toEqual([]);
    expect(mutations.filter((path) => path.endsWith("/messages"))).toEqual([
      `/api/lessons/${existingId}/messages`,
    ]);
    await expect(page).toHaveURL(savedUrl);
  } finally {
    release.resolve();
  }
});

test("fixture navigation: failed saved-lesson load offers retry while actions remain guarded", async ({
  page,
}) => {
  await loginFixture(page, "saved-lesson-retry");
  await includedLesson(page);
  const savedUrl = page.url(),
    existingId = lessonId(page);
  let failed = false;
  await page.route(`**/api/lessons/${existingId}`, async (route) => {
    if (route.request().method() === "GET" && !failed) {
      failed = true;
      return route.fulfill({
        status: 503,
        json: { message: "Synthetic saved lesson load failure." },
      });
    }
    return route.continue();
  });
  const created: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      ["/api/lessons", "/api/courses"].includes(path)
    )
      created.push(path);
  });
  await page.goto(savedUrl);
  await expect(
    page.getByRole("button", { name: "Retry loading lesson", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Ask about your work", { exact: true })
    .fill("Preserve this question while retrying.");
  await expect(
    page.getByRole("button", { name: "Ask", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry loading lesson", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sources (3)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ask", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByLabel("Ask about your work", { exact: true }),
  ).toHaveValue("Preserve this question while retrying.");
  await expect(page).toHaveURL(savedUrl);
  expect(created).toEqual([]);
});
