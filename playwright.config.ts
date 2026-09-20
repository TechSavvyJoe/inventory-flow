import { defineConfig, devices } from '@playwright/test'

// Local runs drive the installed Google Chrome, which is the browser dealership
// staff actually use. CI installs only Playwright's bundled Chromium, where no
// branded channel exists, so it sets PLAYWRIGHT_BUNDLED_CHROMIUM and we drop the
// channel instead of pulling a second browser down on every run.
const chromiumChannel = process.env.PLAYWRIGHT_BUNDLED_CHROMIUM ? undefined : 'chrome'

export default defineConfig({
  testDir: './tests/e2e',
  // The cross-browser suite owns isolated synthetic servers and its own config.
  testIgnore: '**/cross-browser/**',
  fullyParallel: false,
  retries: 0,
  // `list` is the readable local default. CI additionally writes the HTML report
  // so a failed run uploads traces and screenshots instead of only console text.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel: chromiumChannel,
  },
  webServer: {
    // The synthetic demo, never the live-source server: `pnpm dev` reads the
    // developer's runtime/ sources and is reserved for the authorized host.
    command: 'pnpm dev:demo',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', channel: chromiumChannel } },
  ],
})
