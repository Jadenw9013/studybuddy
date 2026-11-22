import {defineConfig} from '@playwright/test';
/** Explicitly opted-in paid calls against an already-running local live app. */
export default defineConfig({
  testDir:'.',testMatch:'notebook-studio.spec.ts',workers:1,retries:0,timeout:270_000,
  reporter:[['list']],outputDir:'../../.data/notebook-studio-test',
  use:{baseURL:'http://localhost:3000',browserName:'chromium',viewport:{width:1440,height:1000},trace:'off',screenshot:'off',actionTimeout:10_000},
});
