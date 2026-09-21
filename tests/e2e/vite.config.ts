import { mergeConfig } from 'vite'
import appConfig from '../../vite.config.ts'

export default mergeConfig(appConfig, {
  server: {
    port: 4473,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4474' },
  },
})
