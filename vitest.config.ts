import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: projectRoot,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [fileURLToPath(new URL('./tests/unit/setup.ts', import.meta.url))],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // The heavier React suites mount the full inventory and transfer shells and
    // drive them through user-event. That comfortably exceeds vitest's 5s
    // default whenever the machine is busy, so the suites fail on timing rather
    // than on behaviour. 15s is slack for a loaded machine, not a licence for
    // slow tests; a suite that needs more than this is doing too much per test.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
