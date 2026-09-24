
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('deploy tag', () => {
  it('keeps the deploy entry points free of POSIX command substitution', () => {
    // The previous POSIX substitution (e.g. $(git rev-parse)) caused problems on Windows,
    // so we shifted the tag logic to Node. This asserts we don't accidentally regress.
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts
    expect(scripts['cloud:deploy']).toBe('node scripts/deploy-worker.mjs')
    expect(scripts['integrations:deploy']).toBe('node scripts/deploy-worker.mjs')
    expect(`${scripts['cloud:deploy']}${scripts['integrations:deploy']}`).not.toMatch(/\$\(.*\)/)
  })
})
