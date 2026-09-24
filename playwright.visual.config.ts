import { defineConfig } from '@playwright/test'

// Pinned visual-regression gate. Baselines are pixel-exact captures of the
// production CSS cascade (`pnpm build` output, served with --serve-dist) and
// are meaningful only when compared against themselves on the same rendering
// stack: Playwright's bundled Chromium inside the
// mcr.microsoft.com/playwright:v1.62.1-noble container CI runs this in (see
// .github/workflows/ci.yml). The Mac has neither — branded Chrome locally,
// no Docker — so `channel` is hard-coded to `undefined` (never the local
// 'chrome' channel other configs use) and this suite is never expected to
// produce a passing baseline comparison outside that container. A plain
// `pnpm test:e2e` never touches this config, so it never writes -darwin
// snapshots here by accident.
const port = process.env.INVENTORY_VISUAL_PORT ?? '4575'
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.ts',
  outputDir: process.env.CI ? 'test-results/visual' : '/tmp/inventory-flow-qa/visual',
  // Isolated in-memory ledger per run — the default e2e suite POSTs transfers
  // and adds a Date.now()-named member, so the visual spec (read-only) never
  // shares an invocation with it.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    // Zero counted pixels. No maxDiffPixelRatio: at Playwright's 0.2 default
    // threshold, pixelmatch treats a hairline shift (#e5e7eb -> #d1d5db) as
    // unchanged, and any nonzero ratio historically let real regressions
    // through (see AGENTS.md history / M07 plan notes). A screenshot that
    // needs slack for measured jitter gets a per-call maxDiffPixels with the
    // reason written beside it — never a global ratio.
    toHaveScreenshot: { maxDiffPixels: 0, threshold: 0.05 },
  },
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'America/Detroit',
    locale: 'en-US',
    channel: undefined,
    browserName: 'chromium',
  },
  // Single server: --serve-dist makes the Node demo server answer both the
  // API and the built static app on one port, so the gate sees the exact
  // cascade `pnpm build` produces (CI runs `pnpm build` before this suite).
  webServer: {
    command: 'node scripts/start-synthetic-demo.mjs --serve-dist',
    // NODE_ENV here only selects the synthetic-demo identity resolver (the
    // Node server refuses to run at all as 'production' — that's the
    // Cloudflare Worker's job). --serve-dist is what makes it answer with
    // the actual `pnpm build` output, which is the production CSS cascade
    // this gate exists to pin.
    env: { INVENTORY_OPS_PORT: port, NODE_ENV: 'development' },
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'visual-390x844',
      use: {
        // No device descriptor: devices['iPhone 13'] captures 390x664, not
        // the 390x844 canonical viewport AGENTS.md names.
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: 'visual-1024x768', use: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 } },
    { name: 'visual-1320x820', use: { viewport: { width: 1320, height: 820 }, deviceScaleFactor: 1 } },
    { name: 'visual-1440x900', use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  ],
})
