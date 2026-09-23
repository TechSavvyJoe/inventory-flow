import { defineConfig, devices } from '@playwright/test'

/** Isolated acceptance suite: fabricated data only; never reuses a live server. */
export default defineConfig({
  testDir: './tests/e2e/cross-browser',
  outputDir: process.env.CI ? 'test-results/cross-browser' : '/tmp/inventory-flow-qa/cross-browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: [
    {
      command: 'node scripts/start-synthetic-demo.mjs',
      env: { INVENTORY_OPS_PORT: '4274', INVENTORY_OPS_IDENTITY_MODE: 'demo', NODE_ENV: 'development' },
      url: 'http://127.0.0.1:4274/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite --config tests/e2e/cross-browser/vite.config.ts --host 127.0.0.1',
      url: 'http://127.0.0.1:4273',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_BUNDLED_CHROMIUM ? undefined : 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-android', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    // Playwright WebKit with an iPhone viewport; this is not a physical iPhone.
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
})
