// @vitest-environment node
// @ts-nocheck -- portable ESM script module.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { deployTag } from '../../scripts/deploy-worker.mjs'

describe('deploy tag', () => {
  it('tags a clean tree with the source commit', () => {
    expect(deployTag({ sha: 'abc1234', dirty: false, allowDirty: false })).toBe('abc1234')
  })

  it('refuses a dirty tree unless the operator opts in, then marks the tag', () => {
    expect(() => deployTag({ sha: 'abc1234', dirty: true, allowDirty: false })).toThrow(/WORKING_TREE_DIRTY/)
    expect(deployTag({ sha: 'abc1234', dirty: true, allowDirty: true })).toBe('abc1234-dirty')
  })

  it('refuses a commit it could not resolve', () => {
    expect(() => deployTag({ sha: '', dirty: false, allowDirty: false })).toThrow(/COMMIT_SHA_UNRESOLVED/)
  })

  it('keeps the deploy entry points free of POSIX command substitution', () => {
    // The deployment host is Windows PowerShell, where $(...) is not command
    // substitution and would reach Wrangler as a literal tag.
    const scripts = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts
    expect(scripts['cloud:deploy']).toBe('node scripts/deploy-worker.mjs app')
    expect(scripts['integrations:deploy']).toBe('node scripts/deploy-worker.mjs integrations')
    expect(`${scripts['cloud:deploy']}${scripts['integrations:deploy']}`).not.toContain('$(')
  })
})
