import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { zipSync, unzipSync } from 'fflate'

// Ship exactly the reviewed, tracked extension source. Runtime inventories,
// local screenshots, and untracked files can never enter this download.
const root = path.resolve(import.meta.dirname, '..')
const names = execFileSync('git', ['ls-files', '-z', '--', 'extension/'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean).sort()
const entries = Object.fromEntries(names.map(name => {
  if (!/^extension\/(?:[\w.-]+\/)*[\w.-]+$/.test(name)) throw new Error('Unexpected extension package path')
  return [name.slice('extension/'.length), readFileSync(path.join(root, name))]
}))
const manifest = JSON.parse(entries['manifest.json'].toString())
const app = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
if (manifest.version !== app.version) throw new Error('App and companion release versions must match')
const archive = zipSync(entries, { level: 6, mtime: new Date('2026-01-01T00:00:00') })
const unpacked = unzipSync(archive)
if (Object.keys(unpacked).length !== names.length || names.some(name => {
  const key = name.slice('extension/'.length)
  return !Buffer.from(unpacked[key]).equals(entries[key])
})) throw new Error('Extension archive verification failed')
const downloads = path.join(root, 'dist', 'downloads')
mkdirSync(downloads, { recursive: true })
writeFileSync(path.join(downloads, 'inventory-flow-deal-desk.zip'), archive)
console.log(`Companion ${manifest.version}: ${names.length} reviewed files, ${(archive.length / 1024).toFixed(0)} KB, archive verified`)
