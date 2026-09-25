import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { scannerAssets } from './scripts/scanner-assets.ts'

export default defineConfig({
  plugins: [react(), scannerAssets()],
  server: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4174',
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
})
