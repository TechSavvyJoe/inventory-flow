// Soft size budgets for production Vite chunks and the packaged companion.
// Fail only on large regressions so everyday feature work is not blocked.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const assets = path.join(root, 'dist', 'assets')
const companion = path.join(root, 'dist', 'downloads', 'inventory-flow-deal-desk.zip')

/** Soft ceilings in bytes. Headroom sits above the Oct 2026 production build. */
const BUDGETS = {
  'index-*.js': 400 * 1024,
  'InventoryPage-*.js': 350 * 1024,
  'TransfersPage-*.js': 150 * 1024,
  'takehome-pdf-*.js': 1_600 * 1024,
  'esm-*.js': 550 * 1024,
  companionZip: 1_500 * 1024,
}

function matchBudget(fileName) {
  for (const [pattern, limit] of Object.entries(BUDGETS)) {
    if (pattern === 'companionZip') continue
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
    if (regex.test(fileName)) return limit
  }
  return null
}

const failures = []
for (const name of readdirSync(assets)) {
  if (!name.endsWith('.js')) continue
  const limit = matchBudget(name)
  if (limit == null) continue
  const size = statSync(path.join(assets, name)).size
  if (size > limit) failures.push(`${name}: ${(size / 1024).toFixed(0)} KB exceeds ${(limit / 1024).toFixed(0)} KB budget`)
}

const companionSize = statSync(companion).size
if (companionSize > BUDGETS.companionZip) {
  failures.push(`companion zip: ${(companionSize / 1024).toFixed(0)} KB exceeds ${(BUDGETS.companionZip / 1024).toFixed(0)} KB budget`)
}

if (failures.length) {
  console.error('Bundle budget check failed:\n' + failures.map((line) => `  - ${line}`).join('\n'))
  process.exitCode = 1
} else {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  console.log(`Bundle budget check passed for ${manifest.version} (companion ${(companionSize / 1024).toFixed(0)} KB).`)
}
