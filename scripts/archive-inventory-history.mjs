import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATE_IN_NAME = /^(\d{4}-\d{2}-\d{2})/
const ARCHIVE_SCHEMA = 1

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function relativeOrThrow(root, filePath) {
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('ARCHIVE_PATH_OUTSIDE_WORKSPACE')
  return relative
}

function filesRecursively(directory) {
  if (!existsSync(directory)) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...filesRecursively(child))
    else if (entry.isFile()) files.push(child)
  }
  return files
}

function datedFiles(root, relativeDirectory, reportDate, { extensions, datedDirectory = false } = {}) {
  const directory = path.join(root, 'work', relativeDirectory)
  return filesRecursively(directory).filter(filePath => {
    const relative = path.relative(directory, filePath)
    const first = relative.split(path.sep)[0]
    const matchesDate = datedDirectory ? first === reportDate : path.basename(filePath).startsWith(reportDate)
    return matchesDate && (!extensions || extensions.includes(path.extname(filePath).toLowerCase()))
  })
}

function reportDates(root) {
  const dates = new Set()
  const roots = [
    'inventory-history/snapshots', 'dealermail-history/snapshots', 'service-history',
    'oasis-history', 'warranty-history', 'vauto-history', 'invoice-history',
    'run-status', 'releases', 'app-feed-status',
  ]
  for (const relativeDirectory of roots) {
    const directory = path.join(root, 'work', relativeDirectory)
    for (const filePath of filesRecursively(directory)) {
      const relative = path.relative(directory, filePath)
      const candidate = relative.split(path.sep).find(part => DATE.test(part)) ?? DATE_IN_NAME.exec(path.basename(filePath))?.[1]
      if (candidate && DATE.test(candidate)) dates.add(candidate)
    }
  }
  return [...dates].sort()
}

function sourcesFor(root, reportDate) {
  const sources = [
    ['public-inventory', datedFiles(root, 'inventory-history/snapshots', reportDate, { extensions: ['.json'] })],
    ['dealermail', datedFiles(root, 'dealermail-history/snapshots', reportDate, { extensions: ['.json'] })],
    ['ford-service-history', datedFiles(root, 'service-history', reportDate, { extensions: ['.json'] })],
    ['oasis', datedFiles(root, 'oasis-history', reportDate, { extensions: ['.json'] })],
    ['warranty', datedFiles(root, 'warranty-history', reportDate, { extensions: ['.json'] })],
    ['vauto-autocheck', datedFiles(root, 'vauto-history', reportDate, { extensions: ['.json'] })],
    // The original invoice PDFs remain in the controlled invoice store. Archive
    // parsed metadata/text for trend reporting without duplicating documents.
    ['invoice-metadata', datedFiles(root, 'invoice-history', reportDate, { extensions: ['.json', '.txt'], datedDirectory: true })],
    ['run-manifest', datedFiles(root, 'run-status', reportDate, { extensions: ['.json'] })],
    ['release-bundle', datedFiles(root, 'releases', reportDate, { extensions: ['.json'], datedDirectory: true })],
    ['publication-receipt', datedFiles(root, 'app-feed-status', reportDate, { extensions: ['.json'] })],
  ]
  return sources.flatMap(([source, files]) => files.map(filePath => ({ source, filePath })))
}

function archiveEntry({ workspaceRoot, archiveDirectory, source, filePath }) {
  const sourceRelativePath = relativeOrThrow(workspaceRoot, filePath)
  const destination = path.join(archiveDirectory, source, sourceRelativePath.replace(/^work[\\/]/, ''))
  mkdirSync(path.dirname(destination), { recursive: true })
  const digest = sha256(filePath)
  if (existsSync(destination)) {
    if (sha256(destination) !== digest) throw new Error('ARCHIVE_INTEGRITY_MISMATCH')
  } else {
    copyFileSync(filePath, destination, 0)
    if (sha256(destination) !== digest) throw new Error('ARCHIVE_COPY_VERIFICATION_FAILED')
  }
  return {
    source,
    sourcePath: sourceRelativePath.replaceAll('\\', '/'),
    archivePath: relativeOrThrow(workspaceRoot, destination).replaceAll('\\', '/'),
    bytes: statSync(filePath).size,
    sha256: digest,
  }
}

function writeAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, filePath)
}

export function archiveReport({ workspaceRoot, reportDate }) {
  if (!DATE.test(reportDate)) throw new Error('ARCHIVE_REPORT_DATE_INVALID')
  const archiveDirectory = path.join(workspaceRoot, 'work', 'historical-archive', reportDate)
  const manifestPath = path.join(archiveDirectory, 'manifest.json')
  if (existsSync(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (existing.schemaVersion !== ARCHIVE_SCHEMA || existing.reportDate !== reportDate || !Array.isArray(existing.entries)) throw new Error('ARCHIVE_MANIFEST_INVALID')
    for (const entry of existing.entries) {
      const archived = path.join(workspaceRoot, entry.archivePath)
      if (!existsSync(archived) || sha256(archived) !== entry.sha256) throw new Error('ARCHIVE_INTEGRITY_MISMATCH')
    }
    return { reportDate, status: 'already_archived', entries: existing.entries.length, bytes: existing.entries.reduce((sum, entry) => sum + entry.bytes, 0) }
  }

  const candidates = sourcesFor(workspaceRoot, reportDate)
  if (!candidates.length) return { reportDate, status: 'no_dated_sources', entries: 0, bytes: 0 }
  mkdirSync(archiveDirectory, { recursive: true, mode: 0o700 })
  const entries = candidates.map(candidate => archiveEntry({ workspaceRoot, archiveDirectory, ...candidate }))
  const manifest = {
    schemaVersion: ARCHIVE_SCHEMA,
    reportDate,
    archivedAt: new Date().toISOString(),
    purpose: 'immutable local reporting archive',
    entries,
    exclusions: [{ source: 'invoice-pdf', reason: 'Original documents remain in the protected invoice-history store; report-ready parsed metadata and text are archived.' }],
  }
  writeAtomic(manifestPath, manifest)
  return { reportDate, status: 'archived', entries: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) }
}

function writeIndex(workspaceRoot, results) {
  const root = path.join(workspaceRoot, 'work', 'historical-archive')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const reports = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && DATE.test(entry.name) && existsSync(path.join(root, entry.name, 'manifest.json')))
    .map(entry => {
      const manifest = JSON.parse(readFileSync(path.join(root, entry.name, 'manifest.json'), 'utf8'))
      return { reportDate: manifest.reportDate, archivedAt: manifest.archivedAt, entries: manifest.entries.length, bytes: manifest.entries.reduce((sum, item) => sum + item.bytes, 0) }
    })
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate))
  writeAtomic(path.join(root, 'index.json'), { schemaVersion: ARCHIVE_SCHEMA, generatedAt: new Date().toISOString(), reports, totalEntries: reports.reduce((sum, report) => sum + report.entries, 0), totalBytes: reports.reduce((sum, report) => sum + report.bytes, 0) })
  return { ...results, archivedReports: reports.length }
}

function main(argv) {
  const workspaceRoot = resolveWorkspaceRoot(import.meta.url)
  const all = argv.includes('--all')
  const reportDate = argv.find(argument => DATE.test(argument))
  if (!all && !reportDate) throw new Error('ARCHIVE_USAGE: archive-inventory-history.mjs YYYY-MM-DD | --all')
  const dates = all ? reportDates(workspaceRoot) : [reportDate]
  const results = dates.map(date => archiveReport({ workspaceRoot, reportDate: date }))
  process.stdout.write(`${JSON.stringify(writeIndex(workspaceRoot, { results }), null, 2)}\n`)
}

if (process.argv[1] && path.basename(process.argv[1]) === 'archive-inventory-history.mjs') {
  try { main(process.argv.slice(2)) } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
