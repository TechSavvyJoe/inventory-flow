// @vitest-environment node
// @ts-nocheck -- Exercises the JavaScript release command with no subprocesses.
import { describe, expect, it, vi } from 'vitest'
import { runDeployment } from '../../scripts/deploy-worker.mjs'

const json = (results) => JSON.stringify([{ success: true, results }])
function harness(overrides = {}) {
  const calls = []
  const run = vi.fn((executable, args, options) => {
    calls.push({ executable, args, options })
    if (args.includes('sqlite_master')) throw new Error('Unexpected split SQL')
    if (args.at(-1)?.includes('sqlite_master')) return { status: 0, stdout: json([{ name: 'd1_migrations' }]) }
    if (args.at(-1) === 'SELECT name FROM d1_migrations') return { status: 0, stdout: json([{ name: '0001_initial.sql' }, { name: '0002_roles.sql' }]) }
    return { status: 0, stdout: '' }
  })
  const options = { run, tagFor: () => 'abc1234', wrangler: '/synthetic/wrangler.js', pnpm: '/synthetic/pnpm.cjs', migrations: ['0001_initial.sql', '0002_roles.sql'], log: vi.fn(), ...overrides }
  return { calls, run, options }
}

describe('Worker release preflight', () => {
  it('checks locally, reads the named remote migration ledger, then deploys both Workers', () => {
    const { calls, options } = harness()
    expect(runDeployment(['all'], options)).toEqual({ targets: ['app', 'integrations'], tag: 'abc1234' })
    expect(calls.map(({ args }) => args)).toEqual([
      ['/synthetic/pnpm.cjs', 'check'],
      ['/synthetic/pnpm.cjs', 'cloud:validate'],
      ['/synthetic/wrangler.js', 'd1', 'execute', 'INVENTORY_DB', '--remote', '--config', 'cloudflare/wrangler.jsonc', '--json', '--command', "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'"],
      ['/synthetic/wrangler.js', 'd1', 'execute', 'INVENTORY_DB', '--remote', '--config', 'cloudflare/wrangler.jsonc', '--json', '--command', 'SELECT name FROM d1_migrations'],
      ['/synthetic/wrangler.js', 'deploy', '--config', 'cloudflare/wrangler.jsonc', '--tag', 'abc1234'],
      ['/synthetic/wrangler.js', 'deploy', '--config', 'cloudflare/integrations.wrangler.jsonc', '--tag', 'abc1234'],
    ])
    expect(calls.every(({ executable, options }) => executable === process.execPath && options.shell === false)).toBe(true)
  })

  it.each([['--env', 'staging'], ['--env=staging'], ['--config', 'other.jsonc'], ['--tag', 'forged'], ['--name', 'other-worker'], ['--dry-run']])('rejects deploy overrides before any command: %s', (...args) => {
    const tagFor = vi.fn()
    const { run, options } = harness({ tagFor })
    expect(() => runDeployment(['all', ...args], options)).toThrow('DEPLOY_ARGUMENT_UNSUPPORTED')
    expect(run).not.toHaveBeenCalled()
    expect(tagFor).not.toHaveBeenCalled()
  })

  it.each(['app', 'integrations'])('preserves the %s entrypoint and explicit dirty tags', (target) => {
    const tagFor = vi.fn(() => 'abc1234-dirty')
    const { calls, options } = harness({ tagFor })
    runDeployment([target, '--allow-dirty'], options)
    expect(tagFor).toHaveBeenCalledWith({ allowDirty: true })
    const deploys = calls.filter(({ args }) => args[1] === 'deploy')
    expect(deploys).toHaveLength(1)
    expect(deploys[0].args.at(-1)).toBe('abc1234-dirty')
    expect(deploys[0].args).not.toContain('--allow-dirty')
  })

  it.each([
    [0, { status: 1 }, 'LOCAL_CHECK_FAILED'],
    [1, { error: new Error('spawn failed'), status: null }, 'CLOUD_VALIDATE_FAILED'],
    [2, { status: 1 }, 'D1_MIGRATION_CHECK_FAILED'],
    [2, { status: 0, stdout: json([]) }, 'D1_MIGRATION_LEDGER_ABSENT'],
    [2, { status: 0, stdout: 'not json' }, 'D1_MIGRATION_RESPONSE_INVALID'],
    [2, { status: 0, stdout: JSON.stringify([{ success: false, results: [] }]) }, 'D1_MIGRATION_RESPONSE_INVALID'],
    [3, { status: 0, stdout: json([{ name: '0001_initial.sql' }]) }, 'PENDING_D1_MIGRATIONS: 0002_roles.sql'],
    [3, { status: 0, stdout: json([{ wrong: 'shape' }]) }, 'D1_MIGRATION_RESPONSE_INVALID'],
  ])('stops before deployment on preflight failure %s', (failureIndex, result, message) => {
    const { run, options } = harness()
    const normal = run.getMockImplementation()
    let count = 0
    run.mockImplementation((...args) => count++ === failureIndex ? result : normal(...args))
    expect(() => runDeployment(['all'], options)).toThrow(message)
    expect(run.mock.calls).toHaveLength(failureIndex + 1)
    expect(run.mock.calls.some(([, args]) => args[1] === 'deploy')).toBe(false)
  })

  it('reports a second Worker failure without claiming success or rerunning the first deploy', () => {
    const { run, options } = harness()
    const normal = run.getMockImplementation()
    run.mockImplementation((...args) => args[1][1] === 'deploy' && args[1].includes('cloudflare/integrations.wrangler.jsonc') ? { status: 1 } : normal(...args))
    expect(() => runDeployment(['all'], options)).toThrow('WRANGLER_DEPLOY_FAILED: integrations')
    expect(run.mock.calls.filter(([, args]) => args[1] === 'deploy')).toHaveLength(2)
  })
})
