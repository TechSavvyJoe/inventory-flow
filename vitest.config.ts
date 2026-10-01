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
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
    ],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // PDF/font and DOM suites can exhaust memory when Vitest forks for every
    // reported CPU. Bound concurrency without changing assertions or timeouts.
    maxWorkers: 2,
  },
})
