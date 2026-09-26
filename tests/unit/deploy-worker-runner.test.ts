// @ts-nocheck -- portable ESM release script; every external command is mocked.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertMigrationLedger, deploymentVersion, resolvePnpmEntry, runRelease } from '../../scripts/deploy-worker.mjs'

const roots = []
const commit = 'a'.repeat(40)
const appVersion = '11111111-1111-4111-8111-111111111111'
const integrationVersion = '22222222-2222-4222-8222-222222222222'
const migrationNames = ['0001_initial.sql', '0002_app_access.sql']
const ledger = names => JSON.stringify([{ success: true, results: names.map(name => ({ name })) }])

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(path.join(tmpdir(), 'inventory-release-test-'))) throw new Error('Unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

function harness(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'inventory-release-test-'))
  roots.push(root)
  for (const dir of ['docs', 'cloudflare/migrations']) mkdirSync(path.join(root, dir), { recursive: true })
  writeFileSync(path.join(root, 'docs/SHARED_DATA_DEPLOYMENT.md'), 'SYNTHETIC release log\n')
  for (const file of migrationNames) writeFileSync(path.join(root, 'cloudflare/migrations', file), '-- SYNTHETIC\n')
  const pnpm = path.join(root, 'pnpm.cjs')
  const wrangler = path.join(root, 'wrangler.js')
  writeFileSync(pnpm, '')
  writeFileSync(wrangler, '')
  const state = { head: commit, status: '', ...overrides }
  const spawn = vi.fn((command, args, options) => {
    if (command === 'git') {
      const stdout = args[0] === 'status' ? state.status : args.join(' ') === 'rev-parse HEAD' ? state.head
        : args.join(' ') === 'rev-parse origin/main' ? commit : args.includes('--short') ? state.head.slice(0, 7) : ''
      return { status: 0, stdout }
    }
    if (args[0] === pnpm) {
      if (args[1] === state.failCheck) return { status: 1 }
      if (args[1] === 'check') mkdirSync(path.join(root, 'dist'), { recursive: true })
      if (args[1] === 'cloud:validate' && state.changeHead) state.head = 'b'.repeat(40)
      return { status: 0 }
    }
    if (args[1] === 'd1') return { status: state.ledgerFailure ? 1 : 0, stdout: state.ledgerOutput ?? ledger(migrationNames) }
    if (args[1] === 'deploy') {
      const isApp = args.includes('cloudflare/wrangler.jsonc')
      const target = isApp ? 'app' : 'integrations'
      if (state.omitReceipt !== target) {
        writeFileSync(options.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({ type: 'wrangler-session', version: 1 }) + '\n' + JSON.stringify({
          type: 'deploy', worker_name: isApp ? 'inventory-ops-production' : 'inventory-flow-integrations',
          version_id: isApp ? appVersion : integrationVersion,
        }) + '\n')
      }
      return { status: state.failDeploy === target ? 1 : 0 }
    }
    throw new Error('Unexpected mocked command')
  })
  const log = vi.fn()
  return { root, pnpm, spawn, log, run: args => runRelease(args, { root, spawn, env: { npm_execpath: pnpm }, wranglerEntry: wrangler, log }),
    receipt: () => JSON.parse(readFileSync(path.join(root, 'test-results', readdirSync(path.join(root, 'test-results'))[0], 'release.json'), 'utf8')) }
}

describe('release runner boundaries', () => {
  it.each([['--dry-run'], ['app'], ['--allow-dirty'], ['--allow-branch', '--dry-run'], ['--allow-branch', '--allow-branch']])('rejects unsupported arguments before any command: %j', (...args) => {
    const h = harness()
    expect(() => h.run(args)).toThrow(/UNSUPPORTED_RELEASE_ARGUMENT/)
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('executes both checks through Node and uses read-only exact-ledger verification before paired deploys', () => {
    const h = harness()
    const result = h.run([])
    const commands = h.spawn.mock.calls.filter(([command]) => command !== 'git')
    expect(commands.map(([, args]) => args[1])).toEqual(['check', 'cloud:validate', 'd1', 'deploy', 'deploy'])
    expect(commands.every(([command, , options]) => command === process.execPath && options.shell === false && options.windowsHide)).toBe(true)
    expect(commands[0][1]).toEqual([h.pnpm, 'check'])
    expect(commands[2][1].slice(1)).toEqual(['d1', 'execute', 'INVENTORY_DB', '--remote', '--config', 'cloudflare/wrangler.jsonc', '--command', 'SELECT name FROM d1_migrations ORDER BY name', '--json'])
    expect(commands.some(([, args]) => args.includes('migrations') || args.includes('apply'))).toBe(false)
    expect(result.workers.app.versionId).toBe(appVersion)
    expect(result.workers.integrations.versionId).toBe(integrationVersion)
    expect(h.receipt().status).toBe('deployed')
    expect(JSON.parse(readFileSync(path.join(h.root, 'dist/build.json'), 'utf8'))).toEqual({ commit, tag: 'aaaaaaa', dirty: false })
    expect(readFileSync(path.join(h.root, 'docs/SHARED_DATA_DEPLOYMENT.md'), 'utf8')).toContain(appVersion)
  })

  it.each(['check', 'cloud:validate'])('stops before remote commands if %s fails', failCheck => {
    const h = harness({ failCheck })
    expect(() => h.run([])).toThrow(/RELEASE_COMMAND_FAILED/)
    expect(h.spawn.mock.calls.some(([, args]) => args.includes('--remote') || args[1] === 'deploy')).toBe(false)
  })

  it('refuses a checkout changed during validation before remote commands', () => {
    const h = harness({ changeHead: true })
    expect(() => h.run([])).toThrow(/RELEASE_CHECKOUT_CHANGED/)
    expect(h.spawn.mock.calls.some(([, args]) => args.includes('--remote'))).toBe(false)
  })

  it.each([{ ledgerFailure: true }, { ledgerOutput: ledger([]) }, { ledgerOutput: 'Migrations to be applied:\n0002_app_access.sql' }])('never deploys after an unverified ledger: %j', failure => {
    const h = harness(failure)
    expect(() => h.run([])).toThrow(/RELEASE_COMMAND_FAILED|MIGRATION_LEDGER/)
    expect(h.spawn.mock.calls.some(([, args]) => args[1] === 'deploy')).toBe(false)
  })

  it('stops after a deploy without a receipt and does not claim that production is unchanged', () => {
    const h = harness({ omitReceipt: 'app' })
    expect(() => h.run([])).toThrow(/Production may have changed/)
    expect(h.spawn.mock.calls.filter(([, args]) => args[1] === 'deploy')).toHaveLength(1)
    expect(h.receipt().workers.app).toEqual({ status: 'unverified', versionId: null })
    expect(readFileSync(path.join(h.root, 'docs/SHARED_DATA_DEPLOYMENT.md'), 'utf8')).not.toContain(appVersion)
  })

  it('preserves the first version and a later reported version when the second command fails, without retry or rollback', () => {
    const h = harness({ failDeploy: 'integrations' })
    expect(() => h.run([])).toThrow(new RegExp(`Verified prior versions: app=${appVersion}`))
    expect(h.receipt()).toMatchObject({ status: 'stopped', workers: {
      app: { status: 'deployed', versionId: appVersion }, integrations: { status: 'unverified', versionId: integrationVersion },
    } })
    expect(h.spawn.mock.calls.filter(([, args]) => args[1] === 'deploy')).toHaveLength(2)
    expect(h.spawn.mock.calls.some(([, args]) => args.includes('rollback'))).toBe(false)
    expect(h.log.mock.calls.flat().some(line => line.startsWith('Both Workers deployed'))).toBe(false)
  })
})

describe('migration ledger and deploy receipt parsing', () => {
  it('requires every exact local filename, including new migrations, without accepting invented names', () => {
    expect(() => assertMigrationLedger(ledger(migrationNames), migrationNames)).not.toThrow()
    expect(() => assertMigrationLedger(ledger(migrationNames), [...migrationNames, '0010_integration_audit_operations.sql'])).toThrow(/1 missing/)
    expect(() => assertMigrationLedger(ledger(['0001_initial.sql', '0002_location_confidence.sql']), migrationNames)).toThrow(/1 missing, 1 unexpected/)
    expect(() => assertMigrationLedger(ledger([...migrationNames, migrationNames[0]]), migrationNames)).toThrow(/UNVERIFIED/)
    expect(() => assertMigrationLedger('[{"success":false,"results":[]}]', migrationNames)).toThrow(/UNVERIFIED/)
  })

  it('takes only the matching command receipt version_id, not UUIDs from a deployment listing', () => {
    expect(deploymentVersion(JSON.stringify({ type: 'deploy', worker_name: 'synthetic-worker', version_id: appVersion }), 'synthetic-worker')).toBe(appVersion)
    expect(() => deploymentVersion(`Old version: ${appVersion}`, 'synthetic-worker')).toThrow(/UNVERIFIED/)
    expect(() => deploymentVersion(JSON.stringify({ type: 'deploy', worker_name: 'other-worker', version_id: appVersion }), 'synthetic-worker')).toThrow(/UNVERIFIED/)
    expect(() => deploymentVersion(JSON.stringify({ type: 'deploy', worker_name: 'synthetic-worker', version_id: 'unknown' }), 'synthetic-worker')).toThrow(/UNVERIFIED/)
  })

  it('resolves the package-manager JS entry and refuses .cmd launchers', () => {
    const h = harness()
    expect(resolvePnpmEntry({ npm_execpath: h.pnpm })).toBe(h.pnpm)
    expect(() => resolvePnpmEntry({ npm_execpath: h.pnpm.replace('.cjs', '.cmd') })).toThrow(/PNPM_NODE_ENTRY_REQUIRED/)
    expect(() => resolvePnpmEntry({})).toThrow(/PNPM_NODE_ENTRY_REQUIRED/)
  })
})

describe('cases carried over from the retired single-target wrapper, plus refusal wiring', () => {
  it.each([['all'], ['integrations'], ['app', '--allow-dirty'], ['--env', 'staging'], ['--env=staging'], ['--config', 'other.jsonc'], ['--tag', 'forged'], ['--name', 'other-worker']])('rejects %j before any command', (...args) => {
    const h = harness()
    expect(() => h.run(args)).toThrow(/UNSUPPORTED_RELEASE_ARGUMENT/)
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it.each([['check', 'pnpm check'], ['cloud:validate', 'pnpm cloud:validate']])('names the failed step when %s fails', (failCheck, step) => {
    const h = harness({ failCheck })
    expect(() => h.run([])).toThrow(`RELEASE_COMMAND_FAILED: ${step}`)
    expect(h.spawn.mock.calls.some(([, args]) => args.includes('--remote') || args[1] === 'deploy')).toBe(false)
  })

  const withLedgerProbe = (h, probeResults) => {
    const normal = h.spawn.getMockImplementation()
    h.spawn.mockImplementation((command, args, options) => {
      if (args?.[1] === 'd1') {
        const sql = args[args.indexOf('--command') + 1]
        if (sql.includes('sqlite_master')) return { status: 0, stdout: JSON.stringify([{ success: true, results: probeResults }]) }
        return { status: 1 }
      }
      return normal(command, args, options)
    })
  }

  it('reports an absent ledger with a fail-closed verdict after exactly one read-only probe', () => {
    const h = harness()
    withLedgerProbe(h, [])
    expect(() => h.run([])).toThrow(/D1_MIGRATION_LEDGER_ABSENT/)
    const d1 = h.spawn.mock.calls.filter(([, args]) => args[1] === 'd1').map(([, args]) => args[args.indexOf('--command') + 1])
    expect(d1).toEqual(['SELECT name FROM d1_migrations ORDER BY name', "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'"])
    expect(h.spawn.mock.calls.some(([, args]) => args[1] === 'deploy' || args.includes('migrations') || args.includes('apply'))).toBe(false)
  })

  it('distinguishes a present but unreadable ledger from an absent one', () => {
    const h = harness()
    withLedgerProbe(h, [{ name: 'd1_migrations' }])
    let failure
    try { h.run([]) } catch (error) { failure = error }
    expect(failure?.message).toContain('RELEASE_COMMAND_FAILED: read-only D1 ledger query')
    expect(failure?.message).not.toMatch(/ABSENT/)
    expect(h.spawn.mock.calls.some(([, args]) => args[1] === 'deploy')).toBe(false)
  })

  it('stops on a pending local migration, naming only the local file, after one ledger read', () => {
    const h = harness({ ledgerOutput: ledger(['0001_initial.sql']) })
    expect(() => h.run([])).toThrow('MIGRATION_LEDGER_MISMATCH: 1 missing, 0 unexpected. Missing local migrations: 0002_app_access.sql')
    expect(h.spawn.mock.calls.filter(([, args]) => args[1] === 'd1')).toHaveLength(1)
    expect(h.spawn.mock.calls.some(([, args]) => args[1] === 'deploy')).toBe(false)
  })

  it('refuses a dirty tree through the full runner, spawning only git, unless --allow-branch marks the tag', () => {
    const dirty = harness({ status: ' M src/synthetic.ts' })
    expect(() => dirty.run([])).toThrow(/WORKING_TREE_DIRTY/)
    expect(dirty.spawn.mock.calls.every(([command]) => command === 'git')).toBe(true)
    const allowed = harness({ status: ' M src/synthetic.ts' })
    allowed.run(['--allow-branch'])
    expect(JSON.parse(readFileSync(path.join(allowed.root, 'dist/build.json'), 'utf8'))).toEqual({ commit, tag: 'aaaaaaa-branch', dirty: true })
  })

  it('refuses a HEAD that is not origin/main through the full runner, spawning only git, unless --allow-branch marks the tag', () => {
    const off = harness({ head: 'b'.repeat(40) })
    expect(() => off.run([])).toThrow(/NOT_ON_ORIGIN_MAIN/)
    expect(off.spawn.mock.calls.every(([command]) => command === 'git')).toBe(true)
    const allowed = harness({ head: 'b'.repeat(40) })
    allowed.run(['--allow-branch'])
    expect(JSON.parse(readFileSync(path.join(allowed.root, 'dist/build.json'), 'utf8'))).toEqual({ commit: 'b'.repeat(40), tag: 'bbbbbbb-branch', dirty: false })
  })

  it('refuses a ledger whose only fault is an unexpected extra migration', () => {
    expect(() => assertMigrationLedger(ledger([...migrationNames, '0099_synthetic_extra.sql']), migrationNames)).toThrow(/0 missing, 1 unexpected/)
  })
})
