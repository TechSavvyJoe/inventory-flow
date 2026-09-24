// Assembles a local-demo copy of the companion for Chrome's "Load unpacked":
//   pnpm dev:demo          (in another terminal)
//   pnpm extension:dev  -> dist/extension-dev/
// The shipped manifest (extension/manifest.json) grants only the production
// origin. The dev-only manifest overrides in scripts/extension-dev-manifest.json
// add the loopback demo origins so Settings can offer the synthetic workspace.
// Never publish or distribute this copy; `pnpm build` packages extension/ as is.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { isMainModule } from './lib/is-main.mjs'

const root = path.resolve(import.meta.dirname, '..')
const LOOPBACK_DEMO_PERMISSIONS = Object.freeze(['http://127.0.0.1:4173/*', 'http://localhost:4173/*'])

export function devManifest(base, overrides) {
  const extra = overrides.host_permissions.filter((permission) => !base.host_permissions.includes(permission))
  if (extra.some((permission) => !LOOPBACK_DEMO_PERMISSIONS.includes(permission))) {
    throw new Error('The dev-only manifest may add only the loopback demo origins')
  }
  return { ...base, ...overrides, host_permissions: [...base.host_permissions, ...extra] }
}

export function buildExtensionDev({ outDir = path.join(root, 'dist', 'extension-dev') } = {}) {
  const names = execFileSync('git', ['ls-files', '-z', '--', 'extension/'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).sort()
  rmSync(outDir, { recursive: true, force: true })
  for (const name of names) {
    if (!/^extension\/(?:[\w.-]+\/)*[\w.-]+$/.test(name)) throw new Error('Unexpected extension path')
    const target = path.join(outDir, name.slice('extension/'.length))
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(path.join(root, name)))
  }
  const base = JSON.parse(readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'))
  const overrides = JSON.parse(readFileSync(path.join(root, 'scripts', 'extension-dev-manifest.json'), 'utf8'))
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(devManifest(base, overrides), null, 2)}\n`)
  return { outDir, files: names.length }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const { outDir, files } = buildExtensionDev()
  console.log(`Dev-only companion (local demo origins): ${files} files in ${path.relative(root, outDir)} — load unpacked; never publish.`)
}
