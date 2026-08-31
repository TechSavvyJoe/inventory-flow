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
})
