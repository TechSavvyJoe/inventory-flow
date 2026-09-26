// Owner-operated paired release (`pnpm cloud:release`; `cloud:deploy` and
// `integrations:deploy` are aliases for the same pair). Importing this module
// performs no commands.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, writeFileSync, readFileSync, appendFileSync, readdirSync, mkdirSync, mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isMainModule } from './lib/is-main.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const CONFIGS = {
  app: { file: 'cloudflare/wrangler.jsonc', name: 'inventory-ops-production' },
  integrations: { file: 'cloudflare/integrations.wrangler.jsonc', name: 'inventory-flow-integrations' },
}
const SHA = /^[0-9a-f]{7,40}$/
const VERSION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

export function parseReleaseArguments(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv
  if (args.some(argument => argument !== '--allow-branch') || args.length > 1) {
    throw new Error('UNSUPPORTED_RELEASE_ARGUMENT: use pnpm cloud:release [--allow-branch]. Dry-run, --allow-dirty, deploy overrides and individual Worker targets are not supported; no commands were run.')
  }
  return { allowBranch: args.includes('--allow-branch') }
}

export function deployTag({ head, shortHead, originMain, dirty, allowBranch }) {
  if (![head, shortHead, originMain].every(value => typeof value === 'string' && SHA.test(value)) || !head.startsWith(shortHead)) throw new Error('COMMIT_SHA_UNRESOLVED')
  if (dirty && !allowBranch) throw new Error('WORKING_TREE_DIRTY: commit or set aside changes before releasing.')
  if (head !== originMain && !allowBranch) throw new Error('NOT_ON_ORIGIN_MAIN: HEAD does not match origin/main. An intentional hotfix requires --allow-branch.')
  return allowBranch ? `${shortHead}-branch` : shortHead
}

export function resolvePnpmEntry(env = process.env) {
  // pnpm supplies its JS entry to package scripts. Run it with Node because
  // Windows .cmd files cannot be spawned with shell:false.
  const entry = env.npm_execpath
  if (typeof entry === 'string' && /(?:^|[\\/])pnpm\.(?:cjs|mjs|js)$/i.test(entry) && existsSync(entry)) return entry
  throw new Error('PNPM_NODE_ENTRY_REQUIRED: invoke this release through pnpm cloud:release.')
}

export function assertMigrationLedger(output, expected) {
  let responses
  try { responses = JSON.parse(output) } catch { throw new Error('MIGRATION_LEDGER_UNVERIFIED: D1 did not return valid JSON.') }
  if (!Array.isArray(responses) || responses.length !== 1 || responses[0]?.success !== true || !Array.isArray(responses[0].results)) throw new Error('MIGRATION_LEDGER_UNVERIFIED: the read-only ledger query did not succeed.')
  const names = responses[0].results.map(row => row?.name)
  if (!expected.length || names.some(name => typeof name !== 'string') || new Set(names).size !== names.length) throw new Error('MIGRATION_LEDGER_UNVERIFIED: the migration names are missing or malformed.')
  const missing = expected.filter(name => !names.includes(name))
  const unexpected = names.filter(name => !expected.includes(name))
  if (missing.length || unexpected.length) {
    // Only local filenames are printed; unexpected remote values are not echoed.
    throw new Error(`MIGRATION_LEDGER_MISMATCH: ${missing.length} missing, ${unexpected.length} unexpected. Missing local migrations: ${missing.join(', ') || 'none'}. Joe must verify the schema and ledger before release.`)
  }
}

export function deploymentVersion(output, workerName) {
  let records
  try { records = output.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)) } catch { throw new Error('DEPLOYMENT_UNVERIFIED: Wrangler output is not valid JSON lines.') }
  const deployments = records.filter(record => record?.type === 'deploy')
  if (deployments.length !== 1 || deployments[0].worker_name !== workerName || !VERSION_ID.test(deployments[0].version_id ?? '')) throw new Error('DEPLOYMENT_UNVERIFIED: expected one matching Worker deploy receipt with a version_id.')
  return deployments[0].version_id
}

export function runRelease(argv, options = {}) {
  // Refuse unsupported arguments before resolving tools, fetching, or writing.
  const { allowBranch } = parseReleaseArguments(argv)
  const cwd = options.root ?? root
  const env = options.env ?? process.env
  const node = options.node ?? process.execPath
  const spawn = options.spawn ?? spawnSync
  const log = options.log ?? (message => process.stdout.write(`${message}\n`))
  const pnpm = options.pnpmEntry ?? resolvePnpmEntry(env)
  const wrangler = options.wranglerEntry ?? path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js')
  if (!existsSync(pnpm) || !existsSync(wrangler)) throw new Error('RELEASE_TOOL_NOT_INSTALLED')
  const run = (command, args, { capture = false, commandEnv = env, timeout = 20 * 60 * 1000, step = 'command' } = {}) => {
    const result = spawn(command, args, { cwd, env: commandEnv, shell: false, windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024,
      ...(capture ? { encoding: 'utf8' } : { stdio: 'inherit' }) })
    if (result.error || result.status !== 0 || (capture && typeof result.stdout !== 'string')) throw new Error(`RELEASE_COMMAND_FAILED: ${step}`)
    return capture ? result.stdout.trim() : undefined
  }
  const git = args => run('git', args, { capture: true, timeout: 30000, step: `git ${args[0]}` })
  const state = () => ({ head: git(['rev-parse', 'HEAD']), originMain: git(['rev-parse', 'origin/main']),
    shortHead: git(['rev-parse', '--short', 'HEAD']), status: git(['status', '--porcelain']) })
  git(['fetch', 'origin'])
  const initial = state()
  const tag = deployTag({ ...initial, dirty: Boolean(initial.status), allowBranch })
  const assertUnchanged = () => {
    const current = state()
    if (current.head !== initial.head || current.originMain !== initial.originMain || current.status !== initial.status) throw new Error('RELEASE_CHECKOUT_CHANGED: the checkout changed during release; stop and review it.')
  }
  const deployLog = path.join(cwd, 'docs', 'SHARED_DATA_DEPLOYMENT.md')
  if (!existsSync(deployLog)) throw new Error('DEPLOY_LOG_MISSING')

  log('Running pnpm check...')
  run(node, [pnpm, 'check'], { step: 'pnpm check' })
  log('Running pnpm cloud:validate...')
  run(node, [pnpm, 'cloud:validate'], { step: 'pnpm cloud:validate' })
  assertUnchanged()
  const buildInfo = { commit: initial.head, tag, dirty: Boolean(initial.status) }
  const buildPath = path.join(cwd, 'dist', 'build.json')
  writeFileSync(buildPath, JSON.stringify(buildInfo, null, 2))
  if (JSON.stringify(JSON.parse(readFileSync(buildPath, 'utf8'))) !== JSON.stringify(buildInfo)) throw new Error('BUILD_COMMIT_MISMATCH')

  const migrationNames = readdirSync(path.join(cwd, 'cloudflare', 'migrations')).filter(name => name.endsWith('.sql')).sort()
  if (migrationNames.some(name => !/^\d{4}_[a-z0-9_-]+\.sql$/.test(name))) throw new Error('MIGRATION_FILENAMES_INVALID')
  log('Verifying the existing D1 migration ledger with a read-only query...')
  const d1 = sql => run(node, [wrangler, 'd1', 'execute', 'INVENTORY_DB', '--remote', '--config', CONFIGS.app.file,
    '--command', sql, '--json'], { capture: true, step: 'read-only D1 ledger query' })
  try {
    assertMigrationLedger(d1('SELECT name FROM d1_migrations ORDER BY name'), migrationNames)
  } catch (error) {
    // A name mismatch proves the ledger exists. Any other failure gets one more
    // read-only probe so an absent ledger is reported as such (fail closed).
    if (error.message.startsWith('MIGRATION_LEDGER_MISMATCH')) throw error
    let tables
    try { tables = JSON.parse(d1("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'")) } catch { throw error }
    if (Array.isArray(tables) && tables.length === 1 && tables[0]?.success === true && Array.isArray(tables[0].results) && tables[0].results.length === 0) {
      throw new Error('D1_MIGRATION_LEDGER_ABSENT: deployment stopped; Joe must verify the schema and complete the reviewed ledger backfill.')
    }
    throw error
  }
  assertUnchanged()

  const resultsRoot = path.join(cwd, 'test-results')
  mkdirSync(resultsRoot, { recursive: true })
  const receiptDirectory = mkdtempSync(path.join(resultsRoot, 'release-'))
  const receiptPath = path.join(receiptDirectory, 'release.json')
  const receipt = { ...buildInfo, startedAt: new Date().toISOString(), status: 'started', workers: {} }
  const saveReceipt = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  saveReceipt()
  for (const [target, config] of Object.entries(CONFIGS)) {
    const outputPath = path.join(receiptDirectory, `${target}.jsonl`)
    receipt.workers[target] = { status: 'started', versionId: null }
    saveReceipt()
    try {
      assertUnchanged()
      log(`Deploying ${target} Worker tagged ${tag}...`)
      run(node, [wrangler, 'deploy', '--config', config.file, '--tag', tag], { commandEnv: { ...env, WRANGLER_OUTPUT_FILE_PATH: outputPath }, step: `wrangler deploy ${target}` })
      receipt.workers[target] = { status: 'deployed', versionId: deploymentVersion(readFileSync(outputPath, 'utf8'), config.name) }
      saveReceipt()
    } catch (error) {
      // A failed command may already have changed production. Preserve reported
      // versions, stop the pair, and never roll back or retry automatically.
      let reportedVersion = null
      try { reportedVersion = deploymentVersion(readFileSync(outputPath, 'utf8'), config.name) } catch { /* receipt may not exist */ }
      receipt.workers[target] = { status: 'unverified', versionId: reportedVersion }
      receipt.status = 'stopped'
      saveReceipt()
      const verified = Object.entries(receipt.workers).filter(([, result]) => result.status === 'deployed').map(([name, result]) => `${name}=${result.versionId}`).join(', ') || 'none'
      throw new Error(`RELEASE_STOPPED: ${target} did not complete verification (${error.message}). Verified prior versions: ${verified}. Production may have changed; inspect ${receiptPath} and current Worker versions before retrying. No automatic rollback was attempted.`)
    }
  }
  receipt.status = 'deployed'
  saveReceipt()
  const versions = Object.fromEntries(Object.entries(receipt.workers).map(([target, result]) => [target, result.versionId]))
  try {
    appendFileSync(deployLog, `\n- ${receipt.startedAt} | Tag: ${tag} | App Version: ${versions.app} | Integrations Version: ${versions.integrations}\n`)
  } catch {
    receipt.status = 'deployed-log-pending'
    saveReceipt()
    throw new Error(`DEPLOY_LOG_WRITE_FAILED: both Workers deployed. Do not redeploy to fix the log; use ${receiptPath}.`)
  }
  log(`Both Workers deployed. App version: ${versions.app}; integrations version: ${versions.integrations}. Receipt: ${receiptPath}`)
  return receipt
}

if (isMainModule(import.meta.url)) {
  try { runRelease(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
