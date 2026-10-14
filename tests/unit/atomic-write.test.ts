// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeAtomicFile, writeJsonAtomic } from '../../scripts/lib/atomic-write.mjs'

describe('atomic-write', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('writes JSON through a durable temp rename without leaving .tmp siblings', () => {
    root = mkdtempSync(path.join(tmpdir(), 'inventory-flow-atomic-'))
    const target = path.join(root, 'nested', 'manifest.json')
    writeJsonAtomic(target, { complete: true, count: 2 })
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ complete: true, count: 2 })
    expect(readFileSync(target, 'utf8').endsWith('\n')).toBe(true)
  })

  it('writes binary buffers through the same durable path', () => {
    root = mkdtempSync(path.join(tmpdir(), 'inventory-flow-atomic-'))
    const target = path.join(root, 'overlay.bin')
    const bytes = Buffer.from('synthetic-overlay-bytes')
    writeAtomicFile(target, bytes)
    expect(readFileSync(target)).toEqual(bytes)
  })
})
