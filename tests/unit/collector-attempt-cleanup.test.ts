// @ts-nocheck -- fault injection exercises the plain Node ESM adapter in an owned child.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanupVerifiedAttempt, findPendingPublication, privateAttemptArtifacts, saveAttemptState } from '../../scripts/lib/dealermail-hold-refresh-adapter.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'inventory-collector-cleanup-'))
  roots.push(root)
  const artifacts = privateAttemptArtifacts(root, 'synthetic-settled-attempt')
  mkdirSync(artifacts.directory, { recursive: true })
  for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'promotionBackupPath', 'envelopePath']) {
    writeFileSync(artifacts[key], JSON.stringify({ reportDate: '2026-10-09', marker: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS' }))
  }
  saveAttemptState(artifacts.statePath, { attemptId: 'synthetic-settled-attempt', publicationPending: true, reconciliationRequired: true })
  const original = Object.fromEntries(Object.entries(artifacts).filter(([key]) => key !== 'directory').map(([key, filePath]) => [key, readFileSync(filePath)]))
  return { root, artifacts, original }
}

function injectedCleanup(artifacts, mode) {
  // Faults and process interruption are isolated to a newly spawned Node child;
  // the test runner and any employee/browser processes are never patched or killed.
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const artifacts = ${JSON.stringify(artifacts)};
    const mode = ${JSON.stringify(mode)};
    const rename = fs.renameSync, unlink = fs.unlinkSync, sync = fs.fsyncSync;
    fs.renameSync = (from, to) => {
      if (mode === 'marker-failure' && from === artifacts.statePath) throw Object.assign(new Error('Synthetic failure'), { code: 'EPERM' });
      return rename(from, to);
    };
    fs.fsyncSync = descriptor => {
      if (mode === 'sync-failure') throw new Error('Synthetic directory sync failure');
      return sync(descriptor);
    };
    fs.unlinkSync = filePath => {
      if (mode === 'artifact-failure' && filePath === artifacts.manifestPath) throw Object.assign(new Error('Synthetic failure'), { code: 'EBUSY' });
      unlink(filePath);
      if (mode === 'interrupted' && filePath === artifacts.candidatePath) process.exit(86);
    };
    syncBuiltinESMExports();
    const { cleanupVerifiedAttempt } = await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/lib/dealermail-hold-refresh-adapter.mjs')).href)});
    try { cleanupVerifiedAttempt(artifacts); }
    catch (error) { process.exit(error.message === 'RECONCILIATION_REQUIRED' ? 87 : 88); }
  `
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 10_000, encoding: 'utf8' })
}

describe('settled collector attempt cleanup', () => {
  it('discovers a complete all-false primary state instead of treating its exact candidate as an orphan', () => {
    const { root, artifacts } = fixture()
    const state = saveAttemptState(artifacts.statePath, { attemptId: 'synthetic-settled-attempt' })
    expect(state).toMatchObject({ captureReceiptSent: false, captureReceiptPending: false, publicationPending: false, reconciliationRequired: false })
    expect(findPendingPublication(root)).toMatchObject({
      artifacts, state: JSON.parse(JSON.stringify(state)),
      candidate: { marker: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS' },
      envelope: { marker: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS' },
    })
  })

  it.each(['missing-flags', 'missing-one-flag', 'false-like-flag', 'array-state'])('fails closed on an unproven all-false boundary with %s', mode => {
    const { root, artifacts } = fixture()
    const state = saveAttemptState(artifacts.statePath, { attemptId: 'synthetic-settled-attempt' })
    if (mode === 'missing-flags') for (const key of ['captureReceiptSent', 'captureReceiptPending', 'publicationPending', 'reconciliationRequired']) delete state[key]
    if (mode === 'missing-one-flag') delete state.publicationPending
    if (mode === 'false-like-flag') state.publicationPending = 'false'
    writeFileSync(artifacts.statePath, JSON.stringify(mode === 'array-state' ? [] : state))
    const before = readFileSync(artifacts.statePath)
    expect(() => findPendingPublication(root)).toThrow('RECONCILIATION_REQUIRED')
    expect(readFileSync(artifacts.statePath)).toEqual(before)
  })

  it('preserves discovery of an older explicitly pending state without inferring missing progress flags', () => {
    const { root, artifacts } = fixture()
    const state = { attemptId: 'synthetic-settled-attempt', publicationPending: true, reconciliationRequired: true }
    writeFileSync(artifacts.statePath, JSON.stringify(state))
    expect(findPendingPublication(root)).toMatchObject({ state })
  })

  it.each(['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath'])('fails closed without %s for an all-false primary marker', key => {
    const { root, artifacts } = fixture()
    saveAttemptState(artifacts.statePath, { attemptId: 'synthetic-settled-attempt' })
    unlinkSync(artifacts[key])
    const stateBytes = readFileSync(artifacts.statePath)
    expect(() => findPendingPublication(root)).toThrow()
    expect(readFileSync(artifacts.statePath)).toEqual(stateBytes)
  })

  it.each(['statePath', 'candidatePath', 'envelopePath'])('fails closed with malformed %s for an all-false primary marker', key => {
    const { root, artifacts } = fixture()
    saveAttemptState(artifacts.statePath, { attemptId: 'synthetic-settled-attempt' })
    writeFileSync(artifacts[key], '{"synthetic-truncated": ')
    const before = readFileSync(artifacts[key])
    expect(() => findPendingPublication(root)).toThrow()
    expect(readFileSync(artifacts[key])).toEqual(before)
  })

  it.each(['statePath', 'candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath'])('refuses a symlinked %s under an all-false primary marker', key => {
    const { root, artifacts } = fixture()
    saveAttemptState(artifacts.statePath, { attemptId: 'synthetic-settled-attempt' })
    const target = path.join(root, 'synthetic-outside-attempt.json'), before = readFileSync(artifacts[key])
    writeFileSync(target, before)
    unlinkSync(artifacts[key])
    symlinkSync(target, artifacts[key])
    expect(() => findPendingPublication(root)).toThrow('RECONCILIATION_REQUIRED')
    expect(readFileSync(target)).toEqual(before)
  })

  it.each([false, true])('fails closed on multiple primary markers including all-false state (other marked pending: %s)', otherPending => {
    const { root, artifacts } = fixture()
    saveAttemptState(artifacts.statePath, { attemptId: 'synthetic-settled-attempt' })
    const other = privateAttemptArtifacts(root, 'synthetic-unrelated-attempt')
    for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath']) writeFileSync(other[key], readFileSync(artifacts[key]))
    saveAttemptState(other.statePath, { attemptId: 'synthetic-unrelated-attempt', publicationPending: otherPending })
    const before = [readFileSync(artifacts.statePath), readFileSync(other.statePath)]
    expect(() => findPendingPublication(root)).toThrow('RECONCILIATION_REQUIRED')
    expect(readFileSync(artifacts.statePath)).toEqual(before[0])
    expect(readFileSync(other.statePath)).toEqual(before[1])
  })

  it('cleans only the settled attempt and is idempotent without clearing another pending attempt', () => {
    const { root, artifacts } = fixture()
    const other = privateAttemptArtifacts(root, 'synthetic-unrelated-attempt')
    for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath']) writeFileSync(other[key], '{"marker":"unrelated synthetic evidence"}')
    saveAttemptState(other.statePath, { attemptId: 'synthetic-unrelated-attempt', publicationPending: true })
    const otherBefore = readFileSync(other.statePath)
    const claimPath = path.join(artifacts.directory, 'pending-claim.json')
    writeFileSync(claimPath, '{"marker":"unrelated synthetic claim"}')

    cleanupVerifiedAttempt(artifacts)
    cleanupVerifiedAttempt(artifacts)

    for (const [key, filePath] of Object.entries(artifacts)) if (key !== 'directory') expect(existsSync(filePath)).toBe(false)
    expect(existsSync(`${artifacts.statePath}.settled`)).toBe(false)
    expect(readFileSync(other.statePath)).toEqual(otherBefore)
    expect(existsSync(claimPath)).toBe(true)
    expect(findPendingPublication(root).state.attemptId).toBe('synthetic-unrelated-attempt')
  })

  it('does not rediscover a settled attempt when its owned host stops after the first artifact is removed', () => {
    const { root, artifacts } = fixture()
    const child = injectedCleanup(artifacts, 'interrupted')
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(86)
    expect(existsSync(artifacts.statePath)).toBe(false)
    expect(existsSync(artifacts.candidatePath)).toBe(false)
    expect(existsSync(artifacts.manifestPath)).toBe(true)
    expect(existsSync(`${artifacts.statePath}.settled`)).toBe(true)
    expect(findPendingPublication(root)).toBe(null)
  })

  it.each(['marker-failure', ...(process.platform === 'win32' ? [] : ['sync-failure'])])('keeps the complete pending candidate discoverable on %s before evidence deletion', mode => {
    const { root, artifacts, original } = fixture()
    const child = injectedCleanup(artifacts, mode)
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(87)
    expect(child.stdout).toBe('')
    expect(child.stderr).toBe('')
    for (const [key, bytes] of Object.entries(original)) expect(readFileSync(artifacts[key])).toEqual(bytes)
    expect(findPendingPublication(root).state.attemptId).toBe('synthetic-settled-attempt')
  })

  it('does not throw or recreate a pending marker if an orphan artifact cannot be deleted', () => {
    const { root, artifacts, original } = fixture()
    const child = injectedCleanup(artifacts, 'artifact-failure')
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(0)
    expect(readFileSync(artifacts.manifestPath)).toEqual(original.manifestPath)
    expect(existsSync(artifacts.statePath)).toBe(false)
    expect(existsSync(artifacts.candidatePath)).toBe(false)
    expect(existsSync(artifacts.envelopePath)).toBe(false)
    expect(findPendingPublication(root)).toBe(null)
  })
})
