import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

/**
 * Browser tests run against the PRODUCTION build (vite preview).
 * Locally: the installed Chrome (no Playwright browser download). Set PW_CHANNEL=msedge to use Edge.
 * In CI (process.env.CI): Playwright's bundled Chromium, unless PW_CHANNEL is set.
 */
const channel = process.env.PW_CHANNEL ?? (isCI ? undefined : 'chrome');

// GPU flags tuned for Windows. ANGLE's d3d11 backend doesn't exist on Linux/macOS,
// so there we let Chromium render WebGL with SwiftShader instead.
const gpuArgs =
  process.platform === 'win32'
    ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader']
    : ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  forbidOnly: isCI,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:4178',
    channel,
    viewport: { width: 1920, height: 1080 },
    // CI has no GPU: SwiftShader at full resolution drops below the game's 20 fps
    // time-step floor, so game time falls behind the tests' real-time waits.
    // Half device scale makes the game render a quarter of the pixels (CSS layout unchanged).
    deviceScaleFactor: isCI ? 0.5 : undefined,
    headless: process.env.PW_HEADED ? false : true,
    launchOptions: { args: gpuArgs },
    trace: isCI ? 'retain-on-failure' : 'off',
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
      // DATABASE_URL is forced empty so tests never touch a real database.
      command: 'npx tsx apps/server/src/worldMain.ts',
      url: 'http://localhost:2569/world-info',
      env: { PORT: '2569', DATABASE_URL: '' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
