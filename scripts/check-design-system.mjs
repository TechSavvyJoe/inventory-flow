import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const baseline = JSON.parse(
  await readFile(resolve(projectRoot, 'scripts/design-system-baseline.json'), 'utf8'),
)
const reportRequested = process.argv.includes('--report')

async function collectCssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectCssFiles(absolutePath)))
    else if (entry.isFile() && entry.name.endsWith('.css')) files.push(absolutePath)
  }

  return files
}

function normalizedPath(absolutePath) {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/')
}

function measureCss(content, filePath) {
  const smallText = Array.from(
    content.matchAll(/font-size\s*:\s*(\d*\.?\d+)px/gi),
    (match) => Number(match[1]),
  ).filter((size) => size < 12).length
  const rawColors = filePath.endsWith('/tokens.css')
    ? 0
    : Array.from(content.matchAll(/#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi)).length

  return { smallText, rawColors }
}

const failures = []
const measurements = {}

for (const absolutePath of await collectCssFiles(resolve(projectRoot, 'src'))) {
  const filePath = normalizedPath(absolutePath)
  const measurement = measureCss(await readFile(absolutePath, 'utf8'), filePath)
  const allowance = baseline.files[filePath] ?? { smallText: 0, rawColors: 0 }
  measurements[filePath] = measurement

  for (const metric of ['smallText', 'rawColors']) {
    if (measurement[metric] > allowance[metric]) {
      failures.push(
        `${filePath}: ${metric} increased from ${allowance[metric]} to ${measurement[metric]}`,
      )
    }
  }
}

const mainSource = await readFile(resolve(projectRoot, 'src/main.tsx'), 'utf8')
const globalStyleImports = Array.from(
  mainSource.matchAll(/^import\s+['"](.+\.css)['"]/gm),
  (match) => match[1],
)
const unexpectedGlobalLayers = globalStyleImports.filter(
  (styleImport) => !baseline.globalStyleImports.includes(styleImport),
)

if (unexpectedGlobalLayers.length) {
  failures.push(`src/main.tsx adds unreviewed global CSS layers: ${unexpectedGlobalLayers.join(', ')}`)
}

const totals = Object.values(measurements).reduce(
  (sum, current) => ({
    smallText: sum.smallText + current.smallText,
    rawColors: sum.rawColors + current.rawColors,
  }),
  { smallText: 0, rawColors: 0 },
)

/* `--report` says where the remaining legacy debt actually lives, so a burn-down pass
   can start with the worst sheets instead of guessing. It only adds output: the checks,
   the totals and the exit code are unchanged. */
if (reportRequested) {
  const offenders = Object.entries(measurements)
    .map(([filePath, measurement]) => ({ filePath, ...measurement }))
    .filter((entry) => entry.rawColors > 0 || entry.smallText > 0)
    .sort((a, b) => b.rawColors - a.rawColors || b.smallText - a.smallText)

  console.log('Design-system debt by file \u00b7 raw colors, then sub-12px declarations:')
  for (const entry of offenders) {
    const allowance = baseline.files[entry.filePath] ?? { smallText: 0, rawColors: 0 }
    const colorDrift = entry.rawColors - allowance.rawColors
    const textDrift = entry.smallText - allowance.smallText
    const drift = colorDrift === 0 && textDrift === 0 ? '' : ` \u00b7 ${colorDrift} colors / ${textDrift} sub-12px vs baseline`
    console.log(`- ${entry.filePath}: ${entry.rawColors} raw colors \u00b7 ${entry.smallText} sub-12px${drift}`)
  }
}

if (failures.length) {
  console.error('Design-system regression check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `Design-system guard passed. Legacy debt did not increase (${totals.smallText} sub-12px declarations; ${totals.rawColors} raw colors outside token files).`,
  )
}
