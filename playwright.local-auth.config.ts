import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./evals/local-auth',workers:1,retries:0,timeout:60000,reporter:[['list']],
 use:{baseURL:'http://localhost:3000',browserName:'chromium',trace:'off'},
 webServer:{command:'node scripts/dev.mjs',url:'http://localhost:3000/api/health',reuseExistingServer:true,timeout:60000},
});
