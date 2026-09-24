import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isMainModule } from './lib/is-main.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const states = ['inventory-list', 'inventory-filters-open', 'vehicle-workspace-overview', 'vehicle-workspace-holds', 'moves-list', 'moves-tracker', 'service', 'admin']
const viewports = ['390x844', '1024x768', '1320x820', '1440x900']
export const expectedSnapshots = states.flatMap(state => viewports.map(viewport => `${state}-visual-${viewport}-linux.png`))

export function validatePin(pin, installedVersion, platform, containerImage) {
  if (!/^[a-f0-9]{40}$/.test(pin?.sourceCommit ?? '')) throw new Error('Visual baseline must pin a full commit SHA, never a moving branch.')
  if (!/^\d+\.\d+\.\d+$/.test(pin?.playwrightVersion ?? '') || installedVersion !== pin.playwrightVersion) {
    throw new Error('Visual baseline Playwright version mismatch; review the rendering runtime and source pin together.')
  }
  if (platform !== 'linux' || pin.containerImage !== `mcr.microsoft.com/playwright:v${pin.playwrightVersion}-noble` || containerImage !== pin.containerImage) {
    throw new Error('Visual baselines must be prepared inside the pinned Linux Playwright container.')
  }
  return pin
}

export function validateSnapshotSet(names) {
  if (names.length !== expectedSnapshots.length || new Set(names).size !== names.length || expectedSnapshots.some(name => !names.includes(name))) {
    throw new Error('Incomplete visual baseline: require all 32 named states/viewports, with no extra snapshots.')
  }
}

function run(command, args, cwd = root, env = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}).`)
}

function installedPlaywright(directory) {
  return JSON.parse(readFileSync(path.join(directory, 'node_modules/@playwright/test/package.json'), 'utf8')).version
}

export function prepareVisualBaselines() {
  const pin = validatePin(JSON.parse(readFileSync(path.join(root, 'tests/visual/baseline-source.json'), 'utf8')),
    installedPlaywright(root), process.platform, process.env.INVENTORY_VISUAL_CONTAINER)
  // Both directories are generated here, outside any operational data folder.
  const temporary = mkdtempSync(path.join(tmpdir(), 'inventory-visual-baseline-'))
  const baseline = path.join(temporary, 'source')
  const destination = path.join(root, 'test-results/visual-baselines')
  let worktreeAdded = false
  try {
    run('git', ['fetch', '--no-tags', '--depth=1', 'origin', pin.sourceCommit])
    run('git', ['worktree', 'add', '--detach', baseline, pin.sourceCommit])
    worktreeAdded = true
    run('pnpm', ['install', '--frozen-lockfile'], baseline)
    validatePin(pin, installedPlaywright(baseline), process.platform, process.env.INVENTORY_VISUAL_CONTAINER)
    run('pnpm', ['build'], baseline)
    run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.visual.config.ts', '--update-snapshots=all'], baseline,
      { INVENTORY_VISUAL_BASELINE_CAPTURE: '1' })
    // The initial pin predates the ignored snapshot path. A later reviewed pin
    // uses that path; neither location is ever added to the Git index.
    const generated = [path.join(baseline, 'test-results/visual-baselines'), path.join(baseline, 'tests/visual/app.visual.spec.ts-snapshots')]
      .find(directory => existsSync(directory))
    if (!generated) throw new Error('Pinned source produced no visual baselines.')
    const snapshots = readdirSync(generated)
    validateSnapshotSet(snapshots)
    for (const name of snapshots) {
      const bytes = readFileSync(path.join(generated, name))
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Invalid baseline PNG: ${name}`)
    }
    rmSync(destination, { recursive: true, force: true })
    mkdirSync(destination, { recursive: true })
    for (const name of snapshots) copyFileSync(path.join(generated, name), path.join(destination, name))
    console.log(`Prepared ${snapshots.length} visual baselines from ${pin.sourceCommit}.`)
  } finally {
    if (worktreeAdded) run('git', ['worktree', 'remove', '--force', baseline])
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (isMainModule(import.meta.url)) prepareVisualBaselines()
