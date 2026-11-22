import {defineConfig} from '@playwright/test';
/** Explicit paid suite, excluded from ordinary CI and offline browser tests. */
export default defineConfig({
 testDir:'./evals/live',testMatch:'illustration-browser.spec.ts',workers:1,retries:0,timeout:150000,
 reporter:[['list']],outputDir:'.data/illustration-live-test',
 use:{baseURL:'http://localhost:3000',browserName:'chromium',trace:'off',screenshot:'off'},
 webServer:{command:'node node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 -p 3000',
  url:'http://localhost:3000',reuseExistingServer:false,timeout:60000,
  env:{API_INTERNAL_ORIGIN:'http://127.0.0.1:3001',BFL_API_KEY:'',GEMINI_API_KEY:'',SUPABASE_SERVICE_ROLE_KEY:''}},
});
