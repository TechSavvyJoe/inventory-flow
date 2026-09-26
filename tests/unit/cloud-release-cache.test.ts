// @ts-nocheck -- Worker ESM uses the nodejs_compat Buffer implementation.
// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { describe, it, expect, beforeEach } from 'vitest'
import { readReleaseWithIdentity, resetReleaseCache } from '../../cloudflare/src/worker.mjs'
import { encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'

// A fake D1 + R2 pair whose current-release row and stored envelope can be
// swapped between calls, so tests can simulate a new publish mid-test.
function fakeEnv(key) {
  let row = null
  let envelope = null
  let getCalls = 0
  return {
    env: {
      INVENTORY_DB: { prepare: () => ({ first: async () => row }) },
      RELEASE_SNAPSHOTS: {
        get: async () => {
          getCalls++
          return { size: JSON.stringify(envelope).length, text: async () => JSON.stringify(envelope) }
        },
      },
      RELEASE_ENCRYPTION_KEY_BASE64: key.toString('base64'),
    },
    publish(objectKey, nextEnvelope) {
      row = { object_key: objectKey, bundle_sha256: nextEnvelope.bundleSha256, release_id: objectKey }
      envelope = nextEnvelope
    },
    getCalls: () => getCalls,
  }
}

describe('release cache key', () => {
  beforeEach(() => {
    resetReleaseCache()
  })

  it('reuses the cache for the same object key and bundle hash', async () => {
    const key = randomBytes(32)
    const envelope = encryptBundle(buildSyntheticCloudBundle(), key)
    const harness = fakeEnv(key)
    harness.publish('release/2026-09-02/a', envelope)

    const first = await readReleaseWithIdentity(harness.env)
    expect(harness.getCalls()).toBe(1)

    const second = await readReleaseWithIdentity(harness.env)
    expect(harness.getCalls()).toBe(1) // no R2 re-read: served from the isolate cache
    expect(second.bundleSha256).toBe(envelope.bundleSha256)
    expect(second.release).toBe(first.release) // same cached object, not re-decrypted
  })

  it('refreshes when the object key changes even if the bundle hash does not', async () => {
    const key = randomBytes(32)
    const envelope = encryptBundle(buildSyntheticCloudBundle(), key)
    const harness = fakeEnv(key)
    harness.publish('release/2026-09-02/a', envelope)
    await readReleaseWithIdentity(harness.env)
    expect(harness.getCalls()).toBe(1)

    // A rollback or re-upload can point at the same bytes under a new key.
    harness.publish('release/2026-09-02/b', envelope)
    const second = await readReleaseWithIdentity(harness.env)
    expect(harness.getCalls()).toBe(2)
    expect(second.bundleSha256).toBe(envelope.bundleSha256)
  })

  it('refreshes when the bundle hash changes even if the object key does not', async () => {
    const key = randomBytes(32)
    const bundleA = buildSyntheticCloudBundle()
    const envelopeA = encryptBundle(bundleA, key)
    const harness = fakeEnv(key)
    harness.publish('release/2026-09-02/a', envelopeA)

    const first = await readReleaseWithIdentity(harness.env)
    expect(harness.getCalls()).toBe(1)
    expect(first.bundleSha256).toBe(envelopeA.bundleSha256)

    // Same object key, but the underlying bytes were republished (in place)
    // with new content, so the hash changes and must not be served stale.
    const bundleB = structuredClone(bundleA)
    bundleB.release.warnings = [...(bundleB.release.warnings ?? []), 'SYNTHETIC_CACHE_TEST_MARKER']
    const envelopeB = encryptBundle(bundleB, key)
    expect(envelopeB.bundleSha256).not.toBe(envelopeA.bundleSha256)
    harness.publish('release/2026-09-02/a', envelopeB)

    const second = await readReleaseWithIdentity(harness.env)
    expect(harness.getCalls()).toBe(2)
    expect(second.bundleSha256).toBe(envelopeB.bundleSha256)
    expect(second.bundleSha256).not.toBe(first.bundleSha256)
    expect(second.release.warnings).toContain('SYNTHETIC_CACHE_TEST_MARKER')
  })
})
