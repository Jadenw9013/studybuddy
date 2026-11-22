import { test, expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import type { IllustrationItem } from "../../apps/web/components/Illustrations";
import {loginFixture,includedLesson,createHistogram,askFixture} from './fixture-helpers';

// These tests mock only image-generation transport. Login, course ingestion,
// tutoring and the verified chart use the real development-fixture application.
// No test in this file calls an image provider or proves provider integration.
function syntheticPng() {
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([name, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 23, 107, 98, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

type TransportMode = "ready" | "pending" | "failed" | "unsafe-url";
async function mockIllustrations(page: Page, mode: TransportMode) {
  const state = {
    items: [] as IllustrationItem[], actions: [] as any[], deleted: [] as string[],
    listReads: 0, contentReads: 0, pendingReads: 0,
  };
  await page.route("**/api/lessons/**", async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    const actionMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/actions$/);
    if (request.method() === "POST" && actionMatch) {
      const action = request.postDataJSON();
      if (action?.type !== "illustration.generate") { await route.fallback(); return; }
      state.actions.push(action);
      const content = `/api/lessons/${actionMatch[1]}/illustrations/${action.targetId}/content`;
      const item: IllustrationItem = {
        id: action.targetId, title: action.args.title, prompt: action.args.prompt,
        purpose: action.args.purpose, model: "synthetic-ui-fixture", fixture: true,
        estimateUsd: 0.014, status: mode === "failed" ? "failed" : mode === "unsafe-url" ? "ready" : "queued",
        ...(mode === "failed" ? { message: "Fixture image provider unavailable. No image was generated." } : {}),
        ...(mode === "unsafe-url" ? { imageUrl: "https://provider.invalid/private-result.png" } : {}),
      };
      if (!state.items.some(existing => existing.id === item.id)) state.items.push(item);
      // Preserve a queued response so the UI must read confirmed job status.
      await route.fulfill({ json: { status: "queued", objectId: item.id, imageUrl: content } });
      return;
    }
    const listMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/illustrations$/);
    if (request.method() === "GET" && listMatch) {
      state.listReads++;
      if (mode === "ready" && state.items.some(item => item.status === "queued" || item.status === "generating")) {
        state.pendingReads++;
        for (const item of state.items) {
          item.status = state.pendingReads >= 2 ? "ready" : "generating";
          if (item.status === "ready") item.imageUrl = `${pathname}/${item.id}/content`;
        }
      }
      await route.fulfill({ json: { items: state.items, available: true, estimateUsd: 0.014 } });
      return;
    }
    const contentMatch = pathname.match(/^\/api\/lessons\/[^/]+\/illustrations\/([^/]+)\/content$/);
    if (request.method() === "GET" && contentMatch) {
      state.contentReads++;
      await route.fulfill({ contentType: "image/png", body: syntheticPng(), headers: { "Cache-Control": "private, no-store" } });
      return;
    }
    const deleteMatch = pathname.match(/^\/api\/lessons\/[^/]+\/illustrations\/([^/]+)$/);
    if (request.method() === "DELETE" && deleteMatch) {
      state.deleted.push(deleteMatch[1]);
      state.items = state.items.filter(item => item.id !== deleteMatch[1]);
      await route.fulfill({ json: { status: "cancelled", id: deleteMatch[1] } });
      return;
    }
    await route.fallback();
  });
  return state;
}

async function realFixtureLesson(page: Page) {
  await loginFixture(page,'illustration-ui');await includedLesson(page);await createHistogram(page);await askFixture(page,'Explain my histogram directly');
  const panel = page.getByRole("region", { name: "Optional illustrations" });
  await expect(panel.getByLabel("Illustration title")).toBeEnabled();
  return panel;
}

async function fillRequest(page: Page) {
  const panel = page.getByRole("region", { name: "Optional illustrations" });
  await panel.locator("summary").click();
  await panel.getByLabel("Illustration title").fill("Sampling jars (UI fixture)");
  await panel.getByLabel("What should the image show?").fill("Two jars of colored counters. This is a synthetic frontend test, not an image-provider result.");
  await panel.getByLabel("What should this help you understand?").fill("Picture how a sample can differ from its population.");
  return panel;
}

test("illustration UI fixture: labeled image, intact real chart, and mocked saved result after reload", async ({ page }) => {
  const mocked = await mockIllustrations(page, "ready");
  const panel = await realFixtureLesson(page);
  const before = await page.getByTestId("chart-summary").textContent();
  await fillRequest(page);
  await expect(panel.getByRole("button", { name: /Generate illustration/ })).toContainText("$0.014");
  await panel.getByRole("button", { name: /Generate illustration/ }).click();
  await expect(panel.getByText("Generating image", { exact: true })).toBeVisible();
  const image = panel.getByRole("img", { name: "Sampling jars (UI fixture)" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(panel.getByText("Development fixture: no image provider was called.", { exact: true })).toBeVisible();
  await expect(panel.locator("figcaption")).toHaveText("Illustration development fixture");
  expect(mocked.actions).toHaveLength(1);
  expect(mocked.actions[0]).toMatchObject({ type: "illustration.generate", args: { title: "Sampling jars (UI fixture)" } });
  expect(mocked.actions[0].actionId).not.toBe(mocked.actions[0].targetId);
  await expect(page.getByTestId("chart-summary")).toHaveText(before!);
  await page.reload();
  await expect(panel.getByRole("img", { name: "Sampling jars (UI fixture)" })).toBeVisible();
  await expect(panel.getByText("Development fixture: no image provider was called.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("chart-summary")).toHaveText(before!);
  expect(mocked.actions).toHaveLength(1);
  expect(mocked.contentReads).toBeGreaterThanOrEqual(2);
});

test("illustration UI fixture: cancel a pending image without changing the chart", async ({ page }) => {
  const mocked = await mockIllustrations(page, "pending");
  const panel = await realFixtureLesson(page);
  const before = await page.getByTestId("chart-summary").textContent();
  await fillRequest(page);
  await panel.getByRole("button", { name: /Generate illustration/ }).click();
  await expect(panel.getByText("Waiting to generate", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Cancel illustration Sampling jars (UI fixture)", exact: true }).click();
  await expect(panel.locator(".illustration-item")).toHaveCount(0);
  expect(mocked.deleted).toEqual([mocked.actions[0].targetId]);
  expect(mocked.contentReads).toBe(0);
  await expect(page.getByTestId("chart-summary")).toHaveText(before!);
});

test("illustration UI fixture: provider failure is visible and creates no pretend image", async ({ page }) => {
  const mocked = await mockIllustrations(page, "failed");
  const panel = await realFixtureLesson(page);
  await fillRequest(page);
  await panel.getByRole("button", { name: /Generate illustration/ }).click();
  await expect(panel.getByText("Generation failed", { exact: true })).toBeVisible();
  await expect(panel.getByText("Fixture image provider unavailable. No image was generated.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("img")).toHaveCount(0);
  expect(mocked.contentReads).toBe(0);
  await expect(page.getByTestId("chart-summary")).toContainText("4 intervals");
});

test("illustration UI fixture: a provider URL is never embedded or requested", async ({ page }) => {
  await mockIllustrations(page, "unsafe-url");
  let remoteRequests = 0;
  // A regression is blocked locally rather than contacting an external host.
  await page.route("https://provider.invalid/**", route => { remoteRequests++; return route.abort(); });
  const panel = await realFixtureLesson(page);
  await fillRequest(page);
  await panel.getByRole("button", { name: /Generate illustration/ }).click();
  await expect(panel.getByText("The illustration image could not be loaded. Refresh its status or remove it.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("img")).toHaveCount(0);
  expect(remoteRequests).toBe(0);
});
