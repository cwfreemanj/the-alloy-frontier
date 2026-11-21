import { defineConfig } from '@playwright/test';

/**
 * Browser tests run against the PRODUCTION build (vite preview) using the locally
 * installed Chrome (no Playwright browser download). Set PW_CHANNEL=msedge to use Edge.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4178',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    viewport: { width: 1920, height: 1080 },
    headless: process.env.PW_HEADED ? false : true,
    launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] },
  },
  webServer: [
    {
      command: 'npm run build -w @alloy/web && npm run preview',
      url: 'http://localhost:4178',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // Shared-world server (serves the same production build) for the multiplayer test.
      command: 'npx tsx apps/server/src/worldMain.ts',
      url: 'http://localhost:2569/world-info',
      // Accounts for tests live in a throwaway file, never the dev data.
      env: { PORT: '2569', DATA_FILE: '.tmp/e2e-accounts.json' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
