import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

const require = createRequire(import.meta.url)
// All recognition assets come from pinned packages and our own origin. No photo
// or identifier is uploaded to an OCR provider; these are engine files only.
export function scannerAssets(): Plugin {
  const core = dirname(require.resolve('tesseract.js-core/package.json'))
  const files = new Map([
    ['worker.min.js', require.resolve('tesseract.js/dist/worker.min.js')],
    ['eng.traineddata.gz', require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')],
    ...readdirSync(core).filter(name => /^tesseract-core(?:-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(name)).map(name => [name, join(core, name)] as [string, string]),
  ])
  return {
    name: 'local-vehicle-recognition-assets',
    configureServer(server) {
      server.middlewares.use('/scanner-assets', (request, response) => {
        const name = (request.url ?? '').split('?')[0].replace(/^\//, '')
        const file = files.get(name)
        if (!file) { response.statusCode = 404; response.end(); return }
        response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        response.end(readFileSync(file))
      })
    },
    generateBundle() {
      for (const [name, file] of files) this.emitFile({ type: 'asset', fileName: `scanner-assets/${name}`, source: readFileSync(file) })
    },
  }
}
