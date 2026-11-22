import { defineConfig } from "@playwright/test";

/** Existing live/local-test app only. No service startup or provider access. */
export default defineConfig({
  testDir: ".",
  testMatch: "dsa-playground.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  outputDir: "../../.data/dsa-playground-browser",
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
  },
});
