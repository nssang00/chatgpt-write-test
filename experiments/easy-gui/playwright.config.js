import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:['e2e.spec.js','extra-e2e.spec.js','catalog-e2e.spec.js'],
  use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:4173'},
  webServer:{command:'npm run dev -- --port 4173 --strictPort',
    url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,timeout:120000},
  workers:1,reporter:'list'
});
