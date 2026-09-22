// @ts-nocheck -- exercises the plain Node ESM entrypoint helper.
// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isMainModule } from '../../scripts/lib/is-main.mjs'

const roots: string[] = []
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('junction-aware direct entrypoints', () => {
  it('matches the same script reached through a directory link', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'inventory-flow-entrypoint-'))
    roots.push(root)
    const target = path.join(root, 'target')
    const linked = path.join(root, 'linked')
    mkdirSync(target)
    symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir')
    const targetScript = path.join(target, 'capture.mjs')
    writeFileSync(targetScript, '')

    expect(isMainModule(pathToFileURL(targetScript).href, path.join(linked, 'capture.mjs'))).toBe(true)
    expect(isMainModule(pathToFileURL(targetScript).href, path.join(linked, 'different.mjs'))).toBe(false)
  })
})
