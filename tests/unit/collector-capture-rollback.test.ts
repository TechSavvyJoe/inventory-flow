// @ts-nocheck -- exercises private Node ESM recovery with synthetic owned children.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { cloudBundleSha256 } from '../../scripts/publish-cloud-release.mjs'
import { acquirePublicationLock, receiptSourceHashes, releasePublicationLock, writeReceipt } from '../../scripts/sync-cloud-release.mjs'

const originalRoot = process.env.BOB_MAXEY_WORKSPACE_ROOT
const originalInventoryRoot = process.env.INVENTORY_WORKSPACE_ROOT
const originalOwner = process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID
let dispose
afterEach(() => {
  dispose?.(); dispose = undefined
  for (const [name, value] of [['BOB_MAXEY_WORKSPACE_ROOT', originalRoot], ['INVENTORY_WORKSPACE_ROOT', originalInventoryRoot], ['INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID', originalOwner]]) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  vi.useRealTimers()
})
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const writeJson = (file, value) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + '\n') }

async function fixture() {
  const local = createSyntheticWorkspace(), root = local.workspaceRoot, date = local.reportDate
  dispose = local.cleanup
  mkdirSync(path.join(root, 'outputs'), { recursive: true })
  vi.useFakeTimers({ toFake: ['Date'] })
  const now = new Date(`${date}T16:00:00.000Z`)
  vi.setSystemTime(now)
  process.env.BOB_MAXEY_WORKSPACE_ROOT = root
  process.env.INVENTORY_WORKSPACE_ROOT = root
  delete process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID
  vi.resetModules()
  const { internals } = await import('../../scripts/run-inventory-flow-daily.mjs')
  const paths = internals.collectorCaptureBaselinePaths(date)
  mkdirSync(path.dirname(paths.receipt), { recursive: true })
  const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'))
  const publicPath = path.join(root, 'work/inventory-history/snapshots', `${date}-public.json`)
  copyFileSync(path.resolve(root, manifest.public_snapshot_path), publicPath)
  writeJson(paths.dealerMail5, buildSyntheticCloudBundle().release.dealerMailSnapshot)
  writeJson(paths.manifest, { ...manifest, public_snapshot_path: publicPath, public_snapshot_sha256: hash(publicPath), dealermail_snapshot_path: paths.dealerMail5, dealermail_snapshot_sha256: hash(paths.dealerMail5) })
  const built = internals.buildAndWriteReleaseBundle(date, paths.release, paths.manifest, { workspaceRoot: root, now })
  const baseline = JSON.parse(readFileSync(paths.release, 'utf8')), bundleSha256 = cloudBundleSha256(baseline)
  writeReceipt(path.dirname(paths.receipt), { schemaVersion: 1, reportDate: date, complete: true, status: 'published_and_verified', publication: 'published', bundleSha256, verifiedAt: now.toISOString(), counts: built.validation, sourceHashes: receiptSourceHashes(baseline.release) })
  const originals = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, existsSync(file) ? readFileSync(file) : null]))
  expect(internals.inspectCollectorBaseline(date).receipt.bundleSha256).toBe(bundleSha256)
  return { root, date, now, internals, paths, originals, bundleSha256, journalPath: path.join(root, 'work/collector-attempts/capture-rollback.json') }
}

function assertOriginals(f) {
  for (const [key, file] of Object.entries(f.paths)) {
    if (f.originals[key] === null) expect(existsSync(file)).toBe(false)
    else expect(readFileSync(file)).toEqual(f.originals[key])
  }
}

function interruptedCapture(f, mode = 'overwrite') {
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const NativeDate = Date, instant = ${JSON.stringify(f.now.toISOString())};
    globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new NativeDate(instant).getTime(); } };
    const mode = ${JSON.stringify(mode)}, paths = ${JSON.stringify(f.paths)}, journalPath = ${JSON.stringify(f.journalPath)};
    const { acquirePublicationLock } = await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/sync-cloud-release.mjs')).href)});
    const lock = acquirePublicationLock(${JSON.stringify(path.join(f.root, 'work/app-feed-status/.publication.lock'))});
    process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID = JSON.parse(lock.content).ownerId;
    if (mode === 'partial-journal') {
      const sync = fs.fsyncSync;
      fs.fsyncSync = descriptor => { sync(descriptor); if (fs.existsSync(journalPath + '.tmp')) process.exit(85); };
      syncBuiltinESMExports();
    }
    const { internals } = await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/run-inventory-flow-daily.mjs')).href)});
    await internals.stageIntradayHoldRefreshCandidate({ reportDate: ${JSON.stringify(f.date)}, attemptId: 'synthetic-interrupted-capture', baselineBundleSha256: ${JSON.stringify(f.bundleSha256)}, captureDealerMail: async () => {
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      if (journal.baselineBundleSha256 !== ${JSON.stringify(f.bundleSha256)} || journal.files.receipt.bytes !== fs.readFileSync(paths.receipt).toString('base64')) process.exit(90);
      if (mode === 'before-write') process.exit(84);
      for (const [key, file] of Object.entries(paths)) if (key !== 'receipt') fs.writeFileSync(file, '{synthetic interrupted capture');
      process.exit(86);
    }});
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 15_000, encoding: 'utf8', env: { ...process.env, BOB_MAXEY_WORKSPACE_ROOT: f.root, INVENTORY_WORKSPACE_ROOT: f.root, INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID: '' } })
  expect(child.error).toBeUndefined()
  expect(child.stderr).toBe('')
  return child.status
}

function guardedCaptureHost(f, mode = 'admitted') {
  const readyPath = path.join(f.root, 'outputs/owned-child-ready.json'), gatePath = path.join(f.root, 'outputs/owned-child-go'), donePath = path.join(f.root, 'outputs/owned-child-done')
  const capturePath = path.join(f.root, 'apps/inventory-ops/scripts/capture-dealermail.mjs')
  const builderPath = path.join(f.root, 'work/build_v2_snapshot.mjs'), finalizerPath = path.join(f.root, 'work/finalize_cloud_snapshot.mjs')
  const script = `import fs from 'node:fs';\nimport { fileURLToPath } from 'node:url';\nconst ORIGIN = 'https://www.dealermail.com'\nif (fs.realpathSync(process.argv[1]) !== fileURLToPath(import.meta.url)) process.exit(92);\nfs.writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(1) }));\n${mode === 'normal' ? `const file = ${JSON.stringify(f.paths.dealerMail5)}, snapshot = JSON.parse(fs.readFileSync(file, 'utf8')); snapshot.extractedAtUtc = ${JSON.stringify(new Date(f.now.getTime() + 1000).toISOString())}; snapshot.completeDealerMailUsedInventory.extractedAtUtc = snapshot.extractedAtUtc; fs.writeFileSync(file, JSON.stringify(snapshot));` : `const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(gatePath)})) { clearInterval(timer); fs.writeFileSync(${JSON.stringify(f.paths.manifest)}, '{synthetic orphan overwrite'); fs.writeFileSync(${JSON.stringify(donePath)}, 'done'); process.exit(0); } }, 20);\nsetTimeout(() => process.exit(0), 8000).unref();`}\n`
  mkdirSync(path.dirname(capturePath), { recursive: true })
  writeFileSync(capturePath, script)
  writeFileSync(builderPath, '// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS\n')
  writeFileSync(finalizerPath, '// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS\n')
  const profile = { workspaceRoot: f.root, dependencyHashes: { dealermailCapture: hash(capturePath), snapshotBuilder: hash(builderPath), snapshotFinalizer: hash(finalizerPath) } }
  const source = `
    import fs from 'node:fs';
    import { spawn } from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const NativeDate = Date, instant = ${JSON.stringify(f.now.toISOString())};
    globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new NativeDate(instant).getTime(); } };
    const { acquirePublicationLock } = await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/sync-cloud-release.mjs')).href)});
    const lock = acquirePublicationLock(${JSON.stringify(path.join(f.root, 'work/app-feed-status/.publication.lock'))});
    process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID = JSON.parse(lock.content).ownerId;
    const { internals } = await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/run-inventory-flow-daily.mjs')).href)});
    const { makeDealerMailCapture } = await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/lib/dealermail-hold-refresh-adapter.mjs')).href)});
    const mode = ${JSON.stringify(mode)};
    if (mode === 'registration-failure') {
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => { if (to === ${JSON.stringify(f.journalPath)} && JSON.parse(fs.readFileSync(from, 'utf8')).child?.phase === 'active') throw new Error('Synthetic registration disk failure'); return rename(from, to); };
      syncBuiltinESMExports();
    }
    const spawnImpl = mode === 'ipc-failure' ? (...args) => { const child = spawn(...args); child.send = (_message, callback) => callback(new Error('Synthetic IPC failure')); return child; } : mode === 'spawn-failure' ? () => { throw new Error('Synthetic spawn failure'); } : spawn;
    const capture = makeDealerMailCapture(${JSON.stringify(profile)}, { spawnImpl, fetchImpl: async () => ({ ok: true, json: async () => [{ url: 'https://www.dealermail.com/' }] }) });
    const staging = internals.stageIntradayHoldRefreshCandidate({ reportDate: ${JSON.stringify(f.date)}, attemptId: 'synthetic-guarded-capture', baselineBundleSha256: ${JSON.stringify(f.bundleSha256)}, captureDealerMail: args => capture(mode === 'before-register' ? { ...args, childGuard: { ...args.childGuard, register: () => process.exit(84) } } : args) });
    staging.catch(() => process.exit(89));
    if (mode === 'normal') { const result = await staging; fs.writeFileSync(${JSON.stringify(donePath)}, JSON.stringify(result)); process.exit(0); }
    for (let tries = 0; tries < 100; tries += 1) {
      if (fs.existsSync(${JSON.stringify(readyPath)})) process.exit(86);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    process.exit(90);
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 15_000, encoding: 'utf8', env: { ...process.env, BOB_MAXEY_WORKSPACE_ROOT: f.root, INVENTORY_WORKSPACE_ROOT: f.root, INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID: '' } })
  expect(child.error).toBeUndefined()
  expect(child.stderr).toBe('')
  return { hostStatus: child.status, readyPath, gatePath, donePath }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

describe('collector durable capture rollback', () => {
  it('restores normal capture after all three admitted children close and retains the new candidate', async () => {
    const f = await fixture(), child = guardedCaptureHost(f, 'normal')
    expect(child.hostStatus).toBe(0)
    assertOriginals(f)
    expect(existsSync(f.journalPath)).toBe(false)
    const candidate = JSON.parse(readFileSync(child.donePath, 'utf8'))
    expect(readFileSync(candidate.candidateDealerMailPath)).not.toEqual(f.originals.dealerMail5)
    expect(f.internals.inspectCollectorBaseline(f.date).receipt.bundleSha256).toBe(f.bundleSha256)
  })

  it.each(['registration-failure', 'ipc-failure', 'spawn-failure'])('admits no writer or hung child after %s', async mode => {
    const f = await fixture(), child = guardedCaptureHost(f, mode)
    expect(child.hostStatus).toBe(89)
    expect(existsSync(child.readyPath)).toBe(false)
    assertOriginals(f)
    if (mode === 'registration-failure') {
      expect(existsSync(`${f.journalPath}.tmp`)).toBe(true)
      const pending = readFileSync(f.journalPath), temporary = readFileSync(`${f.journalPath}.tmp`)
      expect(() => f.internals.recoverCollectorCaptureBaseline()).toThrow('RECONCILIATION_REQUIRED')
      expect(readFileSync(f.journalPath)).toEqual(pending)
      expect(readFileSync(`${f.journalPath}.tmp`)).toEqual(temporary)
    } else if (mode === 'spawn-failure') {
      expect(JSON.parse(readFileSync(f.journalPath, 'utf8')).child.phase).toBe('launch_pending')
      expect(f.internals.recoverCollectorCaptureBaseline()).toBe(true)
    } else expect(existsSync(f.journalPath)).toBe(false)
  })

  it('keeps the backup fenced until an admitted orphan capture child has definitely exited', async () => {
    const f = await fixture(), child = guardedCaptureHost(f)
    expect(child.hostStatus).toBe(86)
    const before = readFileSync(f.journalPath), journal = JSON.parse(before)
    const ready = JSON.parse(readFileSync(child.readyPath, 'utf8'))
    expect(journal.child).toMatchObject({ phase: 'active', pid: ready.pid })
    expect(ready.argv.slice(1)).toEqual(['run', f.date, '--budget-ms', '900000'])
    expect(() => f.internals.recoverCollectorCaptureBaseline()).toThrow('RECONCILIATION_REQUIRED')
    expect(readFileSync(f.journalPath)).toEqual(before)
    assertOriginals(f)
    writeFileSync(child.gatePath, 'go')
    for (let tries = 0; tries < 100 && !existsSync(child.donePath); tries += 1) await pause(20)
    expect(existsSync(child.donePath)).toBe(true)
    expect(readFileSync(f.paths.manifest)).not.toEqual(f.originals.manifest)
    let exited = false
    for (let tries = 0; tries < 100; tries += 1) {
      try { process.kill(ready.pid, 0) } catch (error) { if (error.code === 'ESRCH') { exited = true; break } }
      await pause(20)
    }
    expect(exited).toBe(true)
    expect(f.internals.inspectCollectorBaseline(f.date).receipt.bundleSha256).toBe(f.bundleSha256)
    assertOriginals(f)
    expect(existsSync(f.journalPath)).toBe(false)
  })

  it('admits no vendor writer if the host dies in the spawn-to-registration window', async () => {
    const f = await fixture(), child = guardedCaptureHost(f, 'before-register')
    expect(child.hostStatus).toBe(84)
    expect(JSON.parse(readFileSync(f.journalPath, 'utf8')).child).toMatchObject({ phase: 'launch_pending', pid: null })
    expect(f.internals.recoverCollectorCaptureBaseline()).toBe(true)
    await pause(200)
    expect(existsSync(child.readyPath)).toBe(false)
    expect(existsSync(child.donePath)).toBe(false)
    assertOriginals(f)
  })

  it.each(['live-child', 'unknown-child', 'live-launch-owner', 'invalid-owner', 'legacy-journal'])('preserves the journal and baseline when %s cannot establish child quiescence', async mode => {
    const f = await fixture()
    expect(interruptedCapture(f, 'before-write')).toBe(84)
    const journal = JSON.parse(readFileSync(f.journalPath, 'utf8'))
    journal.child = { phase: 'active', pid: process.pid, parentPid: process.pid, nonce: '11111111-1111-4111-8111-111111111111', ownerId: '22222222-2222-4222-8222-222222222222' }
    if (mode === 'unknown-child') journal.child.pid = 2147483647
    if (mode === 'live-launch-owner') { journal.child.phase = 'launch_pending'; journal.child.pid = null }
    if (mode === 'invalid-owner') journal.child.ownerId = 'unknown'
    if (mode === 'legacy-journal') { journal.schemaVersion = 1; delete journal.child }
    writeJson(f.journalPath, journal)
    const before = readFileSync(f.journalPath)
    const realKill = process.kill.bind(process)
    const spy = mode === 'unknown-child' ? vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === 2147483647) throw Object.assign(new Error('Synthetic unknown process identity'), { code: 'EPERM' })
      return realKill(pid, signal)
    }) : null
    try { expect(() => f.internals.recoverCollectorCaptureBaseline()).toThrow('RECONCILIATION_REQUIRED') }
    finally { spy?.mockRestore() }
    expect(readFileSync(f.journalPath)).toEqual(before)
    assertOriginals(f)
  })

  it.each(['nonce', 'pid', 'ownerId', 'parentPid'])('refuses a mismatched %s admission without importing the installed entrypoint', async field => {
    const f = await fixture()
    expect(interruptedCapture(f, 'before-write')).toBe(84)
    const lock = acquirePublicationLock(path.join(f.root, 'work/app-feed-status/.publication.lock'))
    const ownerId = JSON.parse(lock.content).ownerId, nonce = '11111111-1111-4111-8111-111111111111'
    const entrypoint = path.join(f.root, 'apps/inventory-ops/scripts/capture-dealermail.mjs'), marker = path.join(f.root, 'outputs/admission-should-not-run')
    mkdirSync(path.dirname(entrypoint), { recursive: true })
    writeFileSync(entrypoint, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected entrypoint admission');`)
    const child = spawn(process.execPath, [path.resolve('scripts/lib/collector-child-bootstrap.mjs'), f.journalPath, nonce, ownerId, entrypoint], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env } })
    const closed = new Promise(resolve => child.once('close', resolve))
    try {
      const journal = JSON.parse(readFileSync(f.journalPath, 'utf8'))
      journal.child = { phase: 'active', pid: child.pid, parentPid: process.pid, nonce, ownerId }
      journal.child[field] = field === 'pid' || field === 'parentPid' ? 2147483647 : '33333333-3333-4333-8333-333333333333'
      writeJson(f.journalPath, journal)
      child.send({ type: 'collector_start', nonce })
      expect(await closed).toBe(1)
      expect(existsSync(marker)).toBe(false)
      assertOriginals(f)
    } finally { releasePublicationLock(lock) }
  })

  it('restores exact prior bytes and absent files on the next baseline inspection after a host exits before finally', async () => {
    const f = await fixture()
    expect(interruptedCapture(f)).toBe(86)
    expect(readFileSync(f.paths.manifest)).not.toEqual(f.originals.manifest)
    const privateDirectory = path.dirname(f.journalPath)
    const candidate = path.join(privateDirectory, 'synthetic-unknown.release.json')
    const pending = path.join(privateDirectory, 'synthetic-unknown.state.json')
    const promotion = path.join(privateDirectory, 'synthetic-unknown.promotion-backup.json')
    for (const file of [candidate, pending, promotion]) writeFileSync(file, '{"marker":"unrelated synthetic recovery evidence"}')

    expect(f.internals.inspectCollectorBaseline(f.date).receipt.bundleSha256).toBe(f.bundleSha256)
    assertOriginals(f)
    expect(existsSync(f.journalPath)).toBe(false)
    expect(f.internals.recoverCollectorCaptureBaseline()).toBe(false)
    assertOriginals(f)
    for (const file of [candidate, pending, promotion]) expect(readFileSync(file, 'utf8')).toBe('{"marker":"unrelated synthetic recovery evidence"}')
  })

  it('persists a private complete journal before the first child write and safely recovers a pre-write interruption', async () => {
    const f = await fixture()
    expect(interruptedCapture(f, 'before-write')).toBe(84)
    assertOriginals(f)
    const journal = JSON.parse(readFileSync(f.journalPath, 'utf8'))
    for (const [key, bytes] of Object.entries(f.originals)) expect(journal.files[key]).toEqual(bytes === null ? null : { bytes: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') })
    if (process.platform !== 'win32') expect(statSync(f.journalPath).mode & 0o777).toBe(0o600)
    expect(f.internals.recoverCollectorCaptureBaseline()).toBe(true)
    assertOriginals(f)
  })

  it('fails closed on an interrupted temporary journal without starting capture or deleting the evidence', async () => {
    const f = await fixture()
    expect(interruptedCapture(f, 'partial-journal')).toBe(85)
    const temporary = `${f.journalPath}.tmp`, bytes = readFileSync(temporary)
    expect(() => f.internals.inspectCollectorBaseline(f.date)).toThrow('RECONCILIATION_REQUIRED')
    expect(readFileSync(temporary)).toEqual(bytes)
    assertOriginals(f)
  })

  it.each(['invalid-json', 'changed-hash', 'foreign-slot', 'changed-receipt'])('preserves canonical and recovery evidence when %s prevents trusted rollback', async mode => {
    const f = await fixture()
    expect(interruptedCapture(f)).toBe(86)
    const journal = JSON.parse(readFileSync(f.journalPath, 'utf8'))
    if (mode === 'invalid-json') writeFileSync(f.journalPath, '{partial journal')
    if (mode === 'changed-hash') { journal.files.release.sha256 = '0'.repeat(64); writeJson(f.journalPath, journal) }
    if (mode === 'foreign-slot') { journal.files.unrelated = journal.files.release; writeJson(f.journalPath, journal) }
    if (mode === 'changed-receipt') writeFileSync(f.paths.receipt, '{"marker":"a later synthetic receipt"}')
    const before = Object.fromEntries(Object.entries(f.paths).map(([key, file]) => [key, readFileSync(file)]))
    const journalBytes = readFileSync(f.journalPath)
    expect(() => f.internals.inspectCollectorBaseline(f.date)).toThrow('RECONCILIATION_REQUIRED')
    expect(readFileSync(f.journalPath)).toEqual(journalBytes)
    for (const [key, bytes] of Object.entries(before)) expect(readFileSync(f.paths[key])).toEqual(bytes)
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked rollback destination before restoring any canonical file', async () => {
    const f = await fixture()
    expect(interruptedCapture(f)).toBe(86)
    const unrelated = path.join(f.root, 'work/unrelated-synthetic-evidence.json')
    writeFileSync(unrelated, '{"marker":"unrelated synthetic bytes"}')
    unlinkSync(f.paths.release)
    symlinkSync(unrelated, f.paths.release)
    const manifest = readFileSync(f.paths.manifest), journal = readFileSync(f.journalPath)
    expect(() => f.internals.recoverCollectorCaptureBaseline()).toThrow('RECONCILIATION_REQUIRED')
    expect(readFileSync(f.paths.manifest)).toEqual(manifest)
    expect(readFileSync(f.journalPath)).toEqual(journal)
    expect(readFileSync(unrelated, 'utf8')).toBe('{"marker":"unrelated synthetic bytes"}')
  })

  it('retains the durable journal through a partial rollback and completes exact recovery on the next startup', async () => {
    const f = await fixture()
    expect(interruptedCapture(f)).toBe(86)
    const journal = readFileSync(f.journalPath)
    const source = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const { internals } = await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/run-inventory-flow-daily.mjs')).href)});
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => { if (to === ${JSON.stringify(f.paths.release)}) throw new Error('Synthetic recovery disk failure'); return rename(from, to); };
      syncBuiltinESMExports();
      try { internals.recoverCollectorCaptureBaseline(); }
      catch (error) { process.exit(error.message === 'RECONCILIATION_REQUIRED' ? 87 : 88); }
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 15_000, encoding: 'utf8', env: { ...process.env, INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID: '' } })
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(87)
    expect(child.stderr).toBe('')
    expect(readFileSync(f.journalPath)).toEqual(journal)
    expect(readFileSync(f.paths.manifest)).toEqual(f.originals.manifest)
    expect(readFileSync(f.paths.release)).not.toEqual(f.originals.release)
    expect(f.internals.inspectCollectorBaseline(f.date).receipt.bundleSha256).toBe(f.bundleSha256)
    assertOriginals(f)
    expect(existsSync(f.journalPath)).toBe(false)
  })

  it('restores a normal staged capture while retaining the exact new candidate for verified promotion', async () => {
    const f = await fixture()
    const lock = acquirePublicationLock(path.join(f.root, 'work/app-feed-status/.publication.lock'))
    process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID = JSON.parse(lock.content).ownerId
    let candidate
    try {
      candidate = await f.internals.stageIntradayHoldRefreshCandidate({ reportDate: f.date, attemptId: 'synthetic-normal-capture', baselineBundleSha256: f.bundleSha256, captureDealerMail: async () => {
        expect(existsSync(f.journalPath)).toBe(true)
        const snapshot = JSON.parse(readFileSync(f.paths.dealerMail5, 'utf8'))
        snapshot.extractedAtUtc = new Date(f.now.getTime() + 1000).toISOString()
        snapshot.completeDealerMailUsedInventory.extractedAtUtc = snapshot.extractedAtUtc
        writeJson(f.paths.dealerMail5, snapshot)
      } })
    } finally { releasePublicationLock(lock); delete process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID }
    assertOriginals(f)
    expect(existsSync(f.journalPath)).toBe(false)
    expect(readFileSync(candidate.candidateDealerMailPath)).not.toEqual(f.originals.dealerMail5)
    expect(hash(candidate.candidatePath)).toBeTruthy()
    expect(f.internals.inspectCollectorBaseline(f.date).receipt.bundleSha256).toBe(f.bundleSha256)
  })
})
