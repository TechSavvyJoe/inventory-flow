import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDirectory, '..')

const REQUIRED_IGNORE_RULES = [
  'node_modules/',
  'dist/',
  'runtime/',
  'data/',
  'test-results/',
  'playwright-report/',
  '.env',
  '.env.*',
  '*.sqlite',
  '*.sqlite-shm',
  '*.sqlite-wal',
  '*.sqlite-journal',
  '*.log',
  '**/__pycache__/',
  'design/**/*.png',
]

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.vite',
  '.codex',
  'node_modules',
  'dist',
  'runtime',
  'data',
  'test-results',
  'playwright-report',
  '__pycache__',
])

const FORBIDDEN_PATHS = [
  { pattern: /(^|\/)runtime\//i, reason: 'runtime databases and logs are host-local state' },
  { pattern: /(^|\/)data\//i, reason: 'generated source caches can contain current inventory or CRM evidence' },
  { pattern: /(^|\/)(?:work|outputs|exports)\//i, reason: 'report artifacts and exports are not repository data' },
  { pattern: /(^|\/)__pycache__\//i, reason: 'Python bytecode is generated locally' },
  { pattern: /(^|\/)design\/.*\.(?:png|jpe?g|webp|heic)$/i, reason: 'unreviewed raster captures may contain live VIN or hold details' },
  { pattern: /(?:^|\/)\.env(?:\..+)?$/i, reason: 'environment files may contain secrets', allow: /^\.env\.example$/i },
  { pattern: /\.(?:sqlite(?:-shm|-wal|-journal)?|db|log|har|xlsx?|csv|jsonl|zip)$/i, reason: 'database, log, browser, report, or bulk-data artifact' },
  {
    // A backup marker counts wherever it lands in the name: before the extension
    // (publish-backup.ps1), between extensions (publish.bak.ps1), or trailing a
    // dated copy (publish.ps1.bak-2026-09-12). It must start its own token, so
    // ordinary words keep passing (threshold.ts, gold.json, back-up-notes.md).
    pattern: /(?:\.(?:bak|backup|orig|old|save)|[-_]backup)(?![A-Za-z0-9])[.\-_A-Za-z0-9]*$/i,
    reason: 'backup copies of scripts or configs are not repository files',
  },
]

const TEXT_FILE = /\.(?:c?js|mjs|ts|tsx|json|md|ya?ml|toml|txt|html|css|svg|example|ps1|psm1|psd1|sh|bash|zsh|bat|cmd|py)$/i
const SECRET_PATTERNS = [
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, reason: 'private key material' },
  { pattern: /\bghp_[A-Za-z0-9]{30,}\b/, reason: 'GitHub personal access token' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/, reason: 'GitHub fine-grained access token' },
  { pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/, reason: 'API secret token' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: 'AWS access key id' },
  {
    pattern: /\b(?:password|passwd|client_secret|access_token|api[_-]?key)\b\s*[:=]\s*["'][^"'\r\n]{8,}["']/i,
    reason: 'literal credential assignment',
  },
  {
    pattern: /C:\\{1,2}Users\\{1,2}[^\\%"'\r\n]+\\{1,2}/gi,
    reason: 'host-specific Windows user-profile path; use %USERPROFILE% or a placeholder',
    // "Synthetic" is the repo's reserved fixture user name (see tests/unit/cloud-release-publisher.test.ts); never widen this to a real account name.
    allow: /^C:\\{1,2}Users\\{1,2}Synthetic\\{1,2}$/i,
  },
]

function slash(value) {
  return value.split(path.sep).join('/')
}

function gitVisibleFiles(root) {
  const result = spawnSync(
    'git',
    ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) return null
  return result.stdout.split('\0').filter(Boolean).sort()
}

function repositoryCandidates(root) {
  const files = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(fullPath)
      else if (entry.isFile()) files.push(slash(path.relative(root, fullPath)))
    }
  }
  visit(root)
  return files.sort()
}

function validateIgnoreRules(root) {
  const ignorePath = path.join(root, '.gitignore')
  const content = readFileSync(ignorePath, 'utf8')
  return REQUIRED_IGNORE_RULES.filter((rule) => !content.split(/\r?\n/).some((line) => line.trim() === rule))
}

export function inspectRepository(root = defaultRoot) {
  const resolvedRoot = path.resolve(root)
  const gitFiles = gitVisibleFiles(resolvedRoot)
  const mode = gitFiles ? 'git-visible-files' : 'repository-candidates'
  const files = gitFiles ?? repositoryCandidates(resolvedRoot)
  const findings = []

  for (const missingRule of validateIgnoreRules(resolvedRoot)) {
    findings.push({ file: '.gitignore', reason: `missing required ignore rule: ${missingRule}` })
  }

  for (const relativePath of files) {
    const normalized = slash(relativePath)
    for (const rule of FORBIDDEN_PATHS) {
      if (rule.allow?.test(normalized)) continue
      if (rule.pattern.test(normalized)) findings.push({ file: normalized, reason: rule.reason })
    }

    if (!TEXT_FILE.test(normalized)) continue
    const fullPath = path.join(resolvedRoot, relativePath)
    let stats
    try {
      stats = statSync(fullPath)
    } catch {
      findings.push({ file: normalized, reason: 'tracked file is missing from the working tree' })
      continue
    }
    if (stats.size > 2_000_000) {
      findings.push({ file: normalized, reason: 'text-like file exceeds the 2 MB review limit' })
      continue
    }
    const content = readFileSync(fullPath, 'utf8')
    for (const rule of SECRET_PATTERNS) {
      const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`)
      const matches = [...content.matchAll(globalPattern)]
      const violates = rule.allow ? matches.some((match) => !rule.allow.test(match[0])) : matches.length > 0
      if (violates) findings.push({ file: normalized, reason: rule.reason })
    }
    if (normalized.startsWith('fixtures/') && !content.includes('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS')) {
      findings.push({ file: normalized, reason: 'fixture lacks the required synthetic-data marker' })
    }
  }

  return { root: resolvedRoot, mode, filesChecked: files.length, findings }
}

export function formatSafetyResult(result) {
  if (result.findings.length === 0) {
    return `Repository safety check passed (${result.filesChecked} ${result.mode === 'git-visible-files' ? 'tracked/unignored' : 'candidate'} files checked).`
  }
  const lines = result.findings.map((finding) => `- ${finding.file}: ${finding.reason}`)
  return `Repository safety check failed:\n${lines.join('\n')}`
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  const result = inspectRepository(process.argv[2] || defaultRoot)
  console[result.findings.length ? 'error' : 'log'](formatSafetyResult(result))
  if (result.findings.length) process.exitCode = 1
}
