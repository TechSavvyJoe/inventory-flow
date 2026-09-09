import { mergeConfig } from 'vite'
import appConfig from '../../../vite.config.ts'

export default mergeConfig(appConfig, {
  server: {
    port: 4273,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4274' },
  },
})
