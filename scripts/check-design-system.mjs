import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { countIdSelectors } from './lib/css-metrics.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const baselinePath = resolve(projectRoot, 'scripts/design-system-baseline.json')
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))

const args = process.argv.slice(2)
const reportRequested = args.includes('--report')
const accept = args.includes('--accept')

function normalizedPath(absolutePath) {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/')
}

async function collectFiles(directory, predicate, files = []) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) await collectFiles(absolutePath, predicate, files)
    else if (entry.isFile() && predicate(entry.name)) files.push(absolutePath)
  }
  return files
}

// ---------------------------------------------------------------------------
// 1. Reachability: walk the import graph from src/main.tsx (relative imports
// only — `import '...'`, `import x from '...'`, and dynamic `import('...')`,
// which covers React.lazy route loaders). Any src/**/*.css the walk never
// reaches is a dead stylesheet: every selector in it targets markup nothing
// renders.
// ---------------------------------------------------------------------------
const CODE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs']
const IMPORT_SPECIFIER_RE = /(?:from\s+|^\s*import\s+|import\s*\()\s*['"](\.[^'"]+)['"]/gm

function resolveSpecifier(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier)
  if (extname(base)) return existsSync(base) ? base : null
  for (const ext of CODE_EXTENSIONS) if (existsSync(base + ext)) return base + ext
  for (const ext of CODE_EXTENSIONS) if (existsSync(resolve(base, `index${ext}`))) return resolve(base, `index${ext}`)
  return null
}

async function walkReachable(entryFile) {
  const visited = new Set()
  const reachableCss = new Set()
  const queue = [resolve(projectRoot, entryFile)]

  while (queue.length) {
    const file = queue.pop()
    if (visited.has(file) || !existsSync(file)) continue
    visited.add(file)
    if (file.endsWith('.css')) { reachableCss.add(file); continue }
    if (!CODE_EXTENSIONS.includes(extname(file))) continue

    const content = await readFile(file, 'utf8')
    for (const match of content.matchAll(IMPORT_SPECIFIER_RE)) {
      const resolved = resolveSpecifier(file, match[1])
      if (resolved && !visited.has(resolved)) queue.push(resolved)
    }
  }

  return reachableCss
}

const reachableCssFiles = await walkReachable('src/main.tsx')
const allCssFiles = await collectFiles(resolve(projectRoot, 'src'), (name) => name.endsWith('.css'))
const failures = []

for (const absolutePath of allCssFiles) {
  if (!reachableCssFiles.has(absolutePath)) {
    failures.push(`${normalizedPath(absolutePath)}: unreachable from src/main.tsx (dead stylesheet — delete it or import it)`)
  }
}

// ---------------------------------------------------------------------------
// 2. Filename ratchet: no *-final, *-polish, *-hardening, *-refinement, -vN,
// .flow. or V2 filename may be added. This has no --accept escape — AGENTS.md
// is absolute ("no ... -vN, .flow or V2 filenames, ever"). Files that already
// carry one of these names are grandfathered in scripts/design-system-baseline.json
// until the moves that delete them land; that list only ever shrinks, as files
// it names are deleted, and can never grow.
// ---------------------------------------------------------------------------
const FORBIDDEN_FILENAME_PATTERNS = [
  { name: '-final', pattern: /-final(?=[.\-_]|$)/i },
  { name: '-polish', pattern: /-polish(?=[.\-_]|$)/i },
  { name: '-hardening', pattern: /-hardening(?=[.\-_]|$)/i },
  { name: '-refinement', pattern: /-refinement(?=[.\-_]|$)/i },
  { name: '-vN', pattern: /-v\d+(?=[.\-_]|$)/i },
  { name: '.flow', pattern: /\.flow\./i },
  { name: 'V2', pattern: /V2(?=[.\-_A-Z]|$)/ },
]

function forbiddenFilenameReason(basename) {
  const hit = FORBIDDEN_FILENAME_PATTERNS.find(({ pattern }) => pattern.test(basename))
  return hit?.name ?? null
}

const allSrcFiles = await collectFiles(resolve(projectRoot, 'src'), () => true)
const grandfatheredFilenames = (baseline.grandfatheredFilenames ?? [])
  .filter((path) => existsSync(resolve(projectRoot, path)) && forbiddenFilenameReason(path.split('/').pop()))

for (const absolutePath of allSrcFiles) {
  const filePath = normalizedPath(absolutePath)
  const reason = forbiddenFilenameReason(filePath.split('/').pop())
  if (reason && !grandfatheredFilenames.includes(filePath)) {
    failures.push(`${filePath}: new file matches the forbidden "${reason}" filename pattern (no *-final/-polish/-hardening/-refinement/-vN/.flow/V2 forks, ever)`)
  }
}

// ---------------------------------------------------------------------------
// 3. Global style-import ratchet: main.tsx may only import a CSS layer already
// on the allowlist, and the allowlist itself may only ever shrink to match
// what main.tsx actually imports — never grow except with --accept, so a
// removed global layer can't quietly be re-added later.
// ---------------------------------------------------------------------------
const mainSource = await readFile(resolve(projectRoot, 'src/main.tsx'), 'utf8')
const actualGlobalImports = Array.from(
  mainSource.matchAll(/^import\s+['"](.+\.css)['"]/gm),
  (match) => match[1],
)
const unexpectedGlobalLayers = actualGlobalImports.filter(
  (styleImport) => !baseline.globalStyleImports.includes(styleImport),
)
if (unexpectedGlobalLayers.length && !accept) {
  failures.push(`src/main.tsx adds unreviewed global CSS layers: ${unexpectedGlobalLayers.join(', ')} (rerun with --accept once reviewed)`)
}
const nextGlobalStyleImports = accept
  ? Array.from(new Set([...baseline.globalStyleImports, ...actualGlobalImports]))
  : baseline.globalStyleImports.filter((styleImport) => actualGlobalImports.includes(styleImport))

// ---------------------------------------------------------------------------
// 4. Per-file CSS debt: measured only on files the import graph actually
// reaches (dead files are caught above, not double-counted here). Every
// metric can only fall or hold. --accept can record reviewed token/style debt,
// but cannot waive the absolute bans on new !important or ID selectors.
// ---------------------------------------------------------------------------
function countMatches(content, pattern) {
  return Array.from(content.matchAll(pattern)).length
}

function measureCss(content, filePath) {
  const isTokenFile = filePath.endsWith('/tokens.css')
  const smallText = Array.from(
    content.matchAll(/font-size\s*:\s*(\d*\.?\d+)px/gi),
    (match) => Number(match[1]),
  ).filter((size) => size < 12).length
  const rawColors = isTokenFile ? 0 : countMatches(content, /#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi)
  const rgbHslColors = isTokenFile ? 0 : countMatches(content, /\b(?:rgba?|hsla?)\(/gi)
  const important = countMatches(content, /!important/gi)
  const idSelectors = countIdSelectors(content)
  return { smallText, rawColors, rgbHslColors, important, idSelectors }
}

const METRICS = ['smallText', 'rawColors', 'rgbHslColors', 'important', 'idSelectors']
const ABSOLUTE_METRICS = new Set(['important', 'idSelectors'])
const measurements = {}
const nextFiles = {}

for (const absolutePath of reachableCssFiles) {
  const filePath = normalizedPath(absolutePath)
  const measurement = measureCss(await readFile(absolutePath, 'utf8'), filePath)
  measurements[filePath] = measurement
  const allowance = baseline.files[filePath] ?? { smallText: 0, rawColors: 0, rgbHslColors: 0, important: 0, idSelectors: 0 }

  for (const metric of METRICS) {
    const actual = measurement[metric] ?? 0
    const allowed = allowance[metric] ?? 0
    if (actual > allowed && (!accept || ABSOLUTE_METRICS.has(metric))) {
      failures.push(`${filePath}: ${metric} increased from ${allowed} to ${actual}`)
    }
  }

  nextFiles[filePath] = accept
    ? measurement
    : { ...allowance, ...Object.fromEntries(METRICS.map((metric) => [metric, Math.min(allowance[metric] ?? 0, measurement[metric] ?? 0)])) }
}
// A file that dropped out of the reachable set (deleted, or now unreachable —
// caught above) drops out of the baseline too, instead of lingering forever.

const totals = Object.values(measurements).reduce(
  (sum, current) => ({
    smallText: sum.smallText + current.smallText,
    rawColors: sum.rawColors + current.rawColors,
    rgbHslColors: sum.rgbHslColors + current.rgbHslColors,
    important: sum.important + current.important,
    idSelectors: sum.idSelectors + current.idSelectors,
  }),
  { smallText: 0, rawColors: 0, rgbHslColors: 0, important: 0, idSelectors: 0 },
)

if (reportRequested) {
  const offenders = Object.entries(measurements)
    .map(([filePath, measurement]) => ({ filePath, ...measurement }))
    .filter((entry) => METRICS.some((metric) => entry[metric] > 0))
    .sort((a, b) => b.rawColors - a.rawColors || b.smallText - a.smallText)

  console.log('Design-system debt by file · raw colors, sub-12px, rgb/hsl, !important, ID selectors:')
  for (const entry of offenders) {
    console.log(`- ${entry.filePath}: ${entry.rawColors} raw colors · ${entry.smallText} sub-12px · ${entry.rgbHslColors} rgb/hsl · ${entry.important} !important · ${entry.idSelectors} ID selectors`)
  }
}

// ---------------------------------------------------------------------------
// Write back only on a clean pass: a failing run never mutates the baseline,
// so `git diff` on scripts/design-system-baseline.json only ever shows an
// intentional --accept (raises debt, reviewable in the PR) or an automatic
// tightening that rode in on the same change that earned it.
// ---------------------------------------------------------------------------
if (!failures.length) {
  const nextBaseline = {
    globalStyleImports: nextGlobalStyleImports,
    grandfatheredFilenames,
    files: nextFiles,
  }
  if (!isDeepStrictEqual(nextBaseline, baseline)) {
    await writeFile(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`, 'utf8')
    console.log(accept
      ? 'Design-system baseline updated with --accept (raised where the current change needed it).'
      : 'Design-system baseline tightened automatically (debt dropped since the last recorded baseline).')
  }
}

if (failures.length) {
  console.error('Design-system regression check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `Design-system guard passed. Legacy debt did not increase (${totals.smallText} sub-12px · ${totals.rawColors} raw colors · ${totals.rgbHslColors} rgb/hsl · ${totals.important} !important · ${totals.idSelectors} ID selectors, outside token files).`,
  )
}
