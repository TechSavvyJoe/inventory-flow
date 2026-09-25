// Cross-platform `wrangler deploy` wrapper that tags every version with the
// commit it was built from. The deployment host runs PowerShell, where the
// POSIX `--tag $(git rev-parse --short HEAD)` these scripts used to carry is
// not command substitution and would have been passed through as a literal.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isMainModule } from './lib/is-main.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

const CONFIGS = {
  app: 'cloudflare/wrangler.jsonc',
  integrations: 'cloudflare/integrations.wrangler.jsonc',
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') throw new Error(`GIT_COMMAND_FAILED: git ${args.join(' ')}`)
  return result.stdout
}

/** Wrangler tags are limited to alphanumerics, dashes and underscores. */
export function deployTag({ sha, dirty, allowDirty }) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('COMMIT_SHA_UNRESOLVED')
  if (!dirty) return sha
  // A tag that claims a commit the deployed bundle does not match is worse
  // than no tag at all, so a dirty tree stops the deploy unless the operator
  // says in the command that they know the version is not that commit.
  if (!allowDirty) throw new Error('WORKING_TREE_DIRTY: commit or stash your changes, or pass --allow-dirty to tag this deploy <sha>-dirty.')
  return `${sha}-dirty`
}

export function resolveTag({ allowDirty }) {
  return deployTag({ sha: git(['rev-parse', '--short', 'HEAD']).trim(), dirty: git(['status', '--porcelain']).trim().length > 0, allowDirty })
}

function pnpmEntry() {
  const entry = process.env.npm_execpath || require.resolve('pnpm/bin/pnpm.cjs')
  if (!existsSync(entry)) throw new Error('PNPM_NOT_INSTALLED')
  return entry
}

function d1Rows(output) {
  let parsed
  try { parsed = JSON.parse(output) } catch { throw new Error('D1_MIGRATION_RESPONSE_INVALID') }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0]?.success !== true || !Array.isArray(parsed[0].results)) {
    throw new Error('D1_MIGRATION_RESPONSE_INVALID')
  }
  return parsed[0].results
}

// Inject the process runner and file list so the whole release sequence can
// be verified without executing a deployment or contacting a remote database.
export function runDeployment(argv, {
  run = spawnSync,
  tagFor = resolveTag,
  wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js'),
  pnpm = pnpmEntry(),
  migrations = readdirSync(path.join(root, 'cloudflare/migrations')).filter((name) => name.endsWith('.sql')).sort(),
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const target = argv[0]
  const targets = target === 'all' ? Object.keys(CONFIGS) : CONFIGS[target] ? [target] : []
  if (!targets.length) throw new Error(`DEPLOY_TARGET_REQUIRED: expected one of ${Object.keys(CONFIGS).join(', ')}, all`)
  const extra = argv.slice(1).filter(argument => argument !== '--allow-dirty')
  if (extra.length) throw new Error(`DEPLOY_ARGUMENT_UNSUPPORTED: ${extra.join(', ')}; only --allow-dirty is accepted.`)
  const tag = tagFor({ allowDirty: argv.includes('--allow-dirty') })
  function command(args, { capture = false, failure } = {}) {
    const result = run(process.execPath, args, { cwd: root, shell: false, windowsHide: true,
      ...(capture ? { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 60000 } : { stdio: 'inherit' }) })
    if (result.error || result.status !== 0) throw new Error(failure)
    return result.stdout
  }
  command([pnpm, 'check'], { failure: 'LOCAL_CHECK_FAILED' })
  command([pnpm, 'cloud:validate'], { failure: 'CLOUD_VALIDATE_FAILED' })
  const query = (sql) => d1Rows(command([wrangler, 'd1', 'execute', 'INVENTORY_DB', '--remote', '--config', CONFIGS.app, '--json', '--command', sql], { capture: true, failure: 'D1_MIGRATION_CHECK_FAILED' }))
  const ledger = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'")
  if (ledger.length !== 1 || ledger[0]?.name !== 'd1_migrations') throw new Error('D1_MIGRATION_LEDGER_ABSENT: deployment stopped; Joe must verify the migration ledger.')
  const applied = query('SELECT name FROM d1_migrations')
  if (applied.some((row) => typeof row?.name !== 'string' || !row.name.endsWith('.sql'))) throw new Error('D1_MIGRATION_RESPONSE_INVALID')
  const appliedNames = new Set(applied.map((row) => row.name))
  const pending = migrations.filter((name) => !appliedNames.has(name))
  if (pending.length) throw new Error(`PENDING_D1_MIGRATIONS: ${pending.join(', ')}`)
  for (const worker of targets) {
    log(`Deploying ${worker} Worker from ${CONFIGS[worker]} tagged ${tag}`)
    command([wrangler, 'deploy', '--config', CONFIGS[worker], '--tag', tag], { failure: `WRANGLER_DEPLOY_FAILED: ${worker}` })
  }
  return { targets, tag }
}

if (isMainModule(import.meta.url)) {
  try { runDeployment(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
