// @ts-nocheck -- publisher seams use synthetic files and injected network only.
// @vitest-environment node
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquirePublicationLock, main, publicationFailureMessage, reconcilePendingPublication, releasePublicationLock } from '../../scripts/sync-cloud-release.mjs'

const roots = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'inventory-capture-gate-'))
  roots.push(root)
  const files = ['work/releases/2026-08-30/inventory-flow-release.json', 'work/run-status/2026-08-30.json',
    'work/dealermail-history/snapshots/2026-08-30-complete-used-inventory-deep-cloud-ready.json',
    'work/app-feed-status/2026-08-30.json', 'work/app-feed-status/publication-reconciliation.json',
    'work/app-feed-status/publication-reconciliation.envelope.json']
  const originals = files.map((file, index) => {
    const target = path.join(root, file), bytes = Buffer.from(`synthetic unchanged canonical evidence ${index}\n`)
    mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes)
    return [target, bytes]
  })
  return { root, originals, lockPath: path.join(root, 'work/app-feed-status/.publication.lock') }
}
function markerIdentity(marker) {
  const stat = lstatSync(marker)
  return stat.isSymbolicLink() ? { link: readlinkSync(marker) }
    : stat.isDirectory() ? { directory: true } : stat.size > 4096 ? { size: stat.size } : { bytes: readFileSync(marker).toString('hex') }
}
const operations = [['publish', main], ['reconcile', reconcilePendingPublication]]
const markerKinds = [
  ['complete', '{"schemaVersion":2,"child":null}\n'],
  ['partial', '{"schemaVersion":'],
  ['unknown', '{"schemaVersion":999,"unexpected":true}'],
  ['empty', ''],
  ['dangling-symlink', null],
  ['directory', null],
  ['oversize', null],
]
describe('canonical publisher pending collector capture admission', () => {
  for (const [name, operation] of operations) {
    for (const suffix of ['', '.tmp']) {
      for (const location of ['canonical', 'canonical-with-custom-root', 'custom-root']) {
        it.each(markerKinds)(`${name} blocks ${location} capture-rollback.json${suffix} %s after reclaiming an exited writer`, async (kind, bytes) => {
          const { root, originals, lockPath } = fixture()
          const customRoot = path.join(root, 'custom-work')
          const environment = location === 'canonical' ? {} : { WORK_ROOT: customRoot }
          const workRoot = location === 'custom-root' ? customRoot : path.join(root, 'work')
          const marker = path.join(workRoot, `collector-attempts/capture-rollback.json${suffix}`)
          mkdirSync(path.dirname(marker), { recursive: true })
          if (kind === 'dangling-symlink') symlinkSync(path.join(root, 'missing-synthetic-journal'), marker)
          else if (kind === 'directory') mkdirSync(marker)
          else if (kind === 'oversize') { writeFileSync(marker, ''); truncateSync(marker, 128 * 1024 * 1024 + 1) }
          else writeFileSync(marker, bytes)
          const before = markerIdentity(marker)
          writeFileSync(lockPath, JSON.stringify({ pid: 1999999999, startedAt: '2026-08-30T00:00:00Z' }))
          const probe = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('Synthetic exited writer'), { code: 'ESRCH' }) })
          const loadRelease = vi.fn(() => { throw new Error('canonical loader must not run') })
          const fetchImpl = vi.fn(() => { throw new Error('network must not run') })
          const writeReconciliation = vi.fn(() => { throw new Error('marker writer must not run') })
          await expect(operation({ workspaceRoot: root, environment, loadRelease, fetchImpl, writeReconciliation }))
            .rejects.toThrow('COLLECTOR_CAPTURE_RECOVERY_REQUIRED')
          expect(probe).toHaveBeenCalledWith(1999999999, 0)
          expect(loadRelease).not.toHaveBeenCalled()
          expect(fetchImpl).not.toHaveBeenCalled()
          expect(writeReconciliation).not.toHaveBeenCalled()
          expect(markerIdentity(marker)).toEqual(before)
          for (const [file, content] of originals) expect(readFileSync(file).equals(content)).toBe(true)
        })
      }
    }
    it(`${name} blocks unknown filesystem state instead of treating it as an absent marker`, async () => {
      const { root, originals } = fixture()
      const directory = path.join(root, 'work/collector-attempts')
      writeFileSync(directory, 'synthetic invalid marker parent')
      const loadRelease = vi.fn(), fetchImpl = vi.fn()
      await expect(operation({ workspaceRoot: root, environment: {}, loadRelease, fetchImpl }))
        .rejects.toThrow('COLLECTOR_CAPTURE_RECOVERY_REQUIRED')
      expect(loadRelease).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled()
      expect(readFileSync(directory, 'utf8')).toBe('synthetic invalid marker parent')
      for (const [file, bytes] of originals) expect(readFileSync(file).equals(bytes)).toBe(true)
    })
    it(`${name} preserves the inherited lock while blocking capture recovery`, async () => {
      const { root, originals, lockPath } = fixture()
      const lock = acquirePublicationLock(lockPath)
      const marker = path.join(root, 'work/collector-attempts/capture-rollback.json')
      mkdirSync(path.dirname(marker), { recursive: true }); writeFileSync(marker, '{')
      const loadRelease = vi.fn(), fetchImpl = vi.fn()
      try {
        await expect(operation({ workspaceRoot: root, environment: { INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID: JSON.parse(lock.content).ownerId }, loadRelease, fetchImpl }))
          .rejects.toThrow('COLLECTOR_CAPTURE_RECOVERY_REQUIRED')
        expect(loadRelease).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled()
        expect(readFileSync(lockPath, 'utf8')).toBe(lock.content)
        expect(readFileSync(marker, 'utf8')).toBe('{')
        for (const [file, bytes] of originals) expect(readFileSync(file).equals(bytes)).toBe(true)
      } finally { releasePublicationLock(lock) }
    })
  }
  it('directs pending capture recovery to its sole owner', () => {
    expect(publicationFailureMessage(new Error('COLLECTOR_CAPTURE_RECOVERY_REQUIRED')))
      .toContain("daily runner's guarded capture recovery")
  })
})
