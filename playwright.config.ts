import { defineConfig, devices } from '@playwright/test'

// Local runs drive the installed Google Chrome, which is the browser dealership
// staff actually use. CI installs Playwright's bundled Chromium (and WebKit, for
// the cross-browser acceptance subset), where no branded Chrome channel exists,
// so it sets PLAYWRIGHT_BUNDLED_CHROMIUM and we drop the channel instead of
// pulling a second Chrome down on every run.
const chromiumChannel = process.env.PLAYWRIGHT_BUNDLED_CHROMIUM ? undefined : 'chrome'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: process.env.CI ? 'test-results' : '/tmp/inventory-flow-qa/e2e',
  // The cross-browser suite owns isolated synthetic servers and its own config.
  testIgnore: '**/cross-browser/**',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The default 30s per-test timeout is tight for records-clarity's three
  // viewport passes and transfer-start's role-switching flow once several
  // spec files share the machine in parallel; 45s is slack for a loaded
  // machine, not a licence for a slow test to grow further.
  timeout: 45_000,
  // `list` is the readable local default. CI additionally writes the HTML report
  // so a failed run uploads traces and screenshots instead of only console text.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4473',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel: chromiumChannel,
  },
  // Dedicated synthetic servers keep test writes out of an employee's open demo.
  webServer: [
    {
      command: 'node scripts/start-synthetic-demo.mjs',
      env: { INVENTORY_OPS_PORT: '4474', INVENTORY_OPS_IDENTITY_MODE: 'demo', NODE_ENV: 'development' },
      url: 'http://127.0.0.1:4474/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite --config tests/e2e/vite.config.ts --host 127.0.0.1',
      url: 'http://127.0.0.1:4473',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', channel: chromiumChannel } },
  ],
})
