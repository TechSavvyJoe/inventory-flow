// @vitest-environment node
// @ts-nocheck -- portable ESM script module.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { expectedSnapshots, validatePin, validateSnapshotSet } from '../../scripts/prepare-visual-baselines.mjs'

const pin = JSON.parse(readFileSync(new URL('../visual/baseline-source.json', import.meta.url), 'utf8'))

describe('pinned visual baseline source', () => {
  it('requires a full immutable source revision in the matching rendering runtime', () => {
    expect(validatePin(pin, '1.62.1', 'linux', pin.containerImage)).toEqual(pin)
    for (const sourceCommit of ['main', 'origin/main', '4cdf3b0', '--all', '../source']) {
      expect(() => validatePin({ ...pin, sourceCommit }, '1.62.1', 'linux', pin.containerImage)).toThrow(/full commit SHA/)
    }
    expect(() => validatePin(pin, '1.62.0', 'linux', pin.containerImage)).toThrow(/version mismatch/)
    expect(() => validatePin(pin, '1.62.1', 'win32', pin.containerImage)).toThrow(/pinned Linux/)
    expect(() => validatePin(pin, '1.62.1', 'linux', undefined)).toThrow(/pinned Linux/)
    expect(() => validatePin(pin, '1.62.1', 'linux', 'mcr.microsoft.com/playwright:latest')).toThrow(/pinned Linux/)
  })

  it('refuses incomplete, duplicated or unexpected baselines before comparison', () => {
    expect(() => validateSnapshotSet(expectedSnapshots)).not.toThrow()
    expect(() => validateSnapshotSet([])).toThrow(/all 32/)
    expect(() => validateSnapshotSet(expectedSnapshots.slice(1))).toThrow(/all 32/)
    expect(() => validateSnapshotSet([...expectedSnapshots.slice(1), expectedSnapshots[1]])).toThrow(/all 32/)
    expect(() => validateSnapshotSet([...expectedSnapshots, 'unreviewed.png'])).toThrow(/all 32/)
  })
})
