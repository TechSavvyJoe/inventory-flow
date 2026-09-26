// @ts-nocheck -- portable ESM script module.
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { deployTag } from '../../scripts/deploy-worker.mjs'

const clean = { head: 'abc1234', shortHead: 'abc1234', originMain: 'abc1234', dirty: false, allowBranch: false }

describe('deploy tag', () => {
  it('tags a clean tree on origin/main with the short commit sha', () => {
    expect(deployTag(clean)).toBe('abc1234')
  })

  it('refuses a dirty tree unless the operator opts in, then marks the tag', () => {
    const dirty = { ...clean, dirty: true }
    expect(() => deployTag(dirty)).toThrow(/WORKING_TREE_DIRTY/)
    expect(deployTag({ ...dirty, allowBranch: true })).toBe('abc1234-branch')
  })

  it('refuses a HEAD that is not origin/main unless the operator opts in, then marks the tag', () => {
    const offMain = { ...clean, head: 'abc1234', originMain: 'def5678' }
    expect(() => deployTag(offMain)).toThrow(/NOT_ON_ORIGIN_MAIN/)
    expect(deployTag({ ...offMain, allowBranch: true })).toBe('abc1234-branch')
  })

  it('refuses unresolved or inconsistent commit identifiers even with the override', () => {
    expect(() => deployTag({ ...clean, head: '', allowBranch: true })).toThrow(/COMMIT_SHA_UNRESOLVED/)
    expect(() => deployTag({ ...clean, shortHead: 'def5678' })).toThrow(/COMMIT_SHA_UNRESOLVED/)
  })

  it('keeps the deploy entry points free of POSIX command substitution', () => {
    // The previous POSIX substitution (e.g. $(git rev-parse)) caused problems on Windows,
    // so we shifted the tag logic to Node. This asserts we don't accidentally regress.
    const scripts = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts
    expect(scripts['cloud:release']).toBe('node scripts/deploy-worker.mjs')
    expect(scripts['cloud:deploy']).toBe('node scripts/deploy-worker.mjs')
    expect(scripts['integrations:deploy']).toBe('node scripts/deploy-worker.mjs')
    expect(scripts['cloud:d1:migrate']).toBe('node scripts/block-generic-d1-migrate.mjs')
    const entryPoints = `${scripts['cloud:release']}${scripts['cloud:deploy']}${scripts['integrations:deploy']}${scripts['cloud:d1:migrate']}`
    expect(entryPoints).not.toContain('$(')
    expect(entryPoints).not.toMatch(/\$\(.*\)/)
  })
})
