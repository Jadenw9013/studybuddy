import {defineConfig} from '@playwright/test';
/** Explicit paid single-query suite against the already-running local live app. */
export default defineConfig({
  testDir:'.',testMatch:'dsa-text.spec.ts',workers:1,retries:0,timeout:120_000,
  reporter:[['list']],outputDir:'../../.data/dsa-text-test',
  use:{baseURL:'http://localhost:3000',browserName:'chromium',trace:'off',screenshot:'off'},
});
