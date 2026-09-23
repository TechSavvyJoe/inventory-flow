// @ts-nocheck -- archive helper is plain Node ESM.
// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { archiveReport } from '../../scripts/archive-inventory-history.mjs'

const roots: string[] = []
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })

it('archives the dated VIN-to-PDF index and preserves later same-day revisions', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vauto-index-archive-'))
  roots.push(root)
  const folder = path.join(root, 'work', 'vauto-documents', 'snapshots')
  mkdirSync(folder, { recursive: true })
  const source = path.join(folder, '2026-09-23-index.json')
  writeFileSync(source, JSON.stringify({ schema: 'vauto-equipment-pdf-snapshot-v1', reportDate: '2026-09-23', byVin: {} }))

  expect(archiveReport({ workspaceRoot: root, reportDate: '2026-09-23' }).status).toBe('archived')
  const manifest = JSON.parse(readFileSync(path.join(root, 'work', 'historical-archive', '2026-09-23', 'manifest.json'), 'utf8'))
  expect(manifest.entries).toEqual([expect.objectContaining({ source: 'vauto-equipment-index' })])

  writeFileSync(source, JSON.stringify({ schema: 'vauto-equipment-pdf-snapshot-v1', reportDate: '2026-09-23', byVin: { TESTVIN: { sha256: 'a'.repeat(64) } } }))
  expect(archiveReport({ workspaceRoot: root, reportDate: '2026-09-23' })).toMatchObject({
    status: 'revisions_archived', revisionCount: 1,
  })
})
