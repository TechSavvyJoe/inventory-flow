// @ts-nocheck -- repository safety helper intentionally uses Node ESM.
// @vitest-environment node

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectRepository } from '../../scripts/check-repo-safety.mjs'

const tempRoots: string[] = []
const projectIgnore = readFileSync(fileURLToPath(new URL('../../.gitignore', import.meta.url)), 'utf8')

afterEach(() => {
  while (tempRoots.length) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})

function temporaryRepository() {
  const root = mkdtempSync(path.join(tmpdir(), 'inventory-flow-repo-safety-'))
  tempRoots.push(root)
  writeFileSync(path.join(root, '.gitignore'), projectIgnore)
  mkdirSync(path.join(root, 'fixtures'), { recursive: true })
  writeFileSync(
    path.join(root, 'fixtures', 'safe.mjs'),
    "export const marker = 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS'\n",
  )
  return root
}

describe('repository safety gate', () => {
  it('accepts a marked synthetic fixture', () => {
    const result = inspectRepository(temporaryRepository())
    expect(result.findings).toEqual([])
  })

  it('rejects fixtures without the synthetic marker and literal credentials', () => {
    const root = temporaryRepository()
    const syntheticToken = `ghp_${'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd'}`
    writeFileSync(
      path.join(root, 'fixtures', 'unsafe.mjs'),
      `export const token = '${syntheticToken}'\n`,
    )
    const result = inspectRepository(root)
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'fixtures/unsafe.mjs', reason: expect.stringMatching(/synthetic-data marker/) }),
        expect.objectContaining({ file: 'fixtures/unsafe.mjs', reason: expect.stringMatching(/GitHub personal access token/) }),
      ]),
    )
  })

  it('flags a literal credential in a PowerShell script', () => {
    const root = temporaryRepository()
    const syntheticToken = `ghp_${'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd'}`
    writeFileSync(
      path.join(root, 'deploy.ps1'),
      `# example\n$token = '${syntheticToken}'\n`,
    )
    const result = inspectRepository(root)
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'deploy.ps1', reason: expect.stringMatching(/GitHub personal access token/) }),
      ]),
    )
  })

  it('flags backup script file names wherever the marker sits in the name', () => {
    const root = temporaryRepository()
    mkdirSync(path.join(root, 'scripts'), { recursive: true })
    const backupNames = [
      'scripts/publish.ps1.bak-20260912',
      'scripts/launcher.ps1.chrome-backup',
      'scripts/publish.bak.ps1',
      'scripts/publish.ps1.bak.txt',
      'scripts/publish.ps1.bak-2026-09-12',
      'config/settings.json.orig',
      'cloudflare/wrangler.jsonc.old',
    ]
    for (const name of backupNames) {
      mkdirSync(path.dirname(path.join(root, ...name.split('/'))), { recursive: true })
      writeFileSync(path.join(root, ...name.split('/')), '# old\n')
    }
    const result = inspectRepository(root)
    expect(result.findings).toEqual(
      expect.arrayContaining(
        backupNames.map((file) => expect.objectContaining({ file, reason: expect.stringMatching(/backup copies/) })),
      ),
    )
  })

  it('leaves ordinary names that merely contain a marker word alone', () => {
    const root = temporaryRepository()
    mkdirSync(path.join(root, 'scripts'), { recursive: true })
    // Documentation about backups and scripts that perform backups are not backup copies.
    for (const name of [
      'threshold.ts', 'gold.json', 'backup-plan.md', 'scripts/back-up-notes.md',
      'docs/cloud-backup-plan.md', 'docs/database_backup_strategy.md', 'scripts/db-backup.mjs', 'src/x.older.ts', 'src/x.saved.json',
    ]) {
      mkdirSync(path.dirname(path.join(root, ...name.split('/'))), { recursive: true })
      writeFileSync(path.join(root, ...name.split('/')), 'notes\n')
    }
    expect(inspectRepository(root).findings).toEqual([])
  })

  it('flags a host-specific Windows user-profile path but not %USERPROFILE%', () => {
    const root = temporaryRepository()
    // Built via concatenation so this file's own source text does not itself
    // contain the literal path and trip the gate when it scans this file.
    const hostSpecificPath = ['C:', '\\Users\\', 'Someone', '\\AppData\\Local\\app.log'].join('')
    writeFileSync(path.join(root, 'NOTES.md'), `Log lives at ${hostSpecificPath}\n`)
    // Forward and mixed separators still name the account and are caught too.
    writeFileSync(path.join(root, 'SLASHES.md'), `Log lives at ${['C:', '/Users/', 'Someone', '/AppData/Local/app.log'].join('')}\n`)
    writeFileSync(path.join(root, 'MIXED.md'), `Log lives at ${['C:', '\\Users/', 'Someone', '\\AppData'].join('')}\n`)
    writeFileSync(path.join(root, 'FIXTURE.md'), `Fixture path ${['C:', '/Users/', 'Synthetic', '/Documents/report.json'].join('')}\n`)
    writeFileSync(
      path.join(root, 'SAFE.md'),
      'Log lives at %USERPROFILE%\\AppData\\Local\\app.log\n',
    )
    const result = inspectRepository(root)
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'NOTES.md', reason: expect.stringMatching(/host-specific Windows user-profile path/) }),
        expect.objectContaining({ file: 'SLASHES.md', reason: expect.stringMatching(/host-specific Windows user-profile path/) }),
        expect.objectContaining({ file: 'MIXED.md', reason: expect.stringMatching(/host-specific Windows user-profile path/) }),
      ]),
    )
    for (const file of ['SAFE.md', 'FIXTURE.md']) {
      expect(result.findings).not.toEqual(expect.arrayContaining([expect.objectContaining({ file })]))
    }
  })

  it('flags unreviewed rasters outside the allowlisted prefixes but not inside them', () => {
    const root = temporaryRepository()
    const flaggedNames = ['root.png', 'docs/a.jpg', 'tests/c.webp', 'design/b.png', 'public/other.gif']
    const allowedNames = ['public/brand-kit/x.png', 'public/demo-vehicles/x.jpg', 'extension/icons/x.png']
    for (const name of [...flaggedNames, ...allowedNames]) {
      mkdirSync(path.dirname(path.join(root, ...name.split('/'))), { recursive: true })
      writeFileSync(path.join(root, ...name.split('/')), 'raster\n')
    }
    const result = inspectRepository(root)
    expect(result.findings).toEqual(
      expect.arrayContaining(
        flaggedNames.map((file) => expect.objectContaining({ file, reason: expect.stringMatching(/unreviewed raster/) })),
      ),
    )
    for (const file of allowedNames) {
      expect(result.findings).not.toEqual(expect.arrayContaining([expect.objectContaining({ file })]))
    }
  })

  it('flags npm and yarn lockfiles anywhere in the tree', () => {
    const root = temporaryRepository()
    mkdirSync(path.join(root, 'sub'), { recursive: true })
    writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
    writeFileSync(path.join(root, 'sub', 'yarn.lock'), '# yarn\n')
    const result = inspectRepository(root)
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'package-lock.json', reason: expect.stringMatching(/only pnpm-lock\.yaml/) }),
        expect.objectContaining({ file: 'sub/yarn.lock', reason: expect.stringMatching(/only pnpm-lock\.yaml/) }),
      ]),
    )
  })

  it('flags a .gitignore missing the required .agents/ ignore rule', () => {
    const root = temporaryRepository()
    writeFileSync(
      path.join(root, '.gitignore'),
      projectIgnore
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '.agents/')
        .join('\n'),
    )
    const result = inspectRepository(root)
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: '.gitignore', reason: 'missing required ignore rule: .agents/' }),
      ]),
    )
  })
})
