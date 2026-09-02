import { describe, expect, it } from 'vitest'
// @ts-expect-error The Worker is deliberately plain ESM, validated separately
// by Wrangler rather than through the browser TypeScript project.
import worker from '../../cloudflare/src/worker.mjs'

const releaseFormat = 'inventory-flow-private-release-v1'

function bufferSource(bytes: Uint8Array): BufferSource {
  // TypeScript's newer typed-array generic is stricter than the runtime Web
  // Crypto contract. Every value here is a fresh Uint8Array, never shared.
  return bytes as unknown as BufferSource
}

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bufferSource(bytes)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function encryptedEnvelope(key: CryptoKey) {
  const bundle = {
    schemaVersion: releaseFormat,
    complete: true,
    reportDate: '2026-09-02',
    release: {
      reportDate: '2026-09-02',
      sourceRuns: {
        public: { status: 'current', sha256: 'a'.repeat(64), rowCount: 1 },
        dealerMail: { status: 'current', sha256: 'b'.repeat(64), rowCount: 1 },
      },
      warnings: [],
      vehicles: [],
    },
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle))
  const bundleSha256 = await sha256(plaintext)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aad = new TextEncoder().encode(`${releaseFormat}:2026-09-02:${bundleSha256}`)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bufferSource(iv), additionalData: bufferSource(aad), tagLength: 128 },
      key,
      bufferSource(plaintext),
    ),
  )
  return {
    version: releaseFormat,
    reportDate: '2026-09-02',
    bundleSha256,
    iv: base64url(iv),
    ciphertext: base64url(ciphertext),
  }
}

async function testEnvironment() {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', bufferSource(keyBytes), { name: 'AES-GCM' }, false, ['encrypt'])
  const envelope = await encryptedEnvelope(key)
  let current: Record<string, string> | null = null
  let stored: { objectKey: string; value: string } | null = null
  const database = {
    prepare(sql: string) {
      const statement = {
        first: async () => (sql.includes('FROM cloud_release_state') ? current : null),
      }
      return { ...statement, bind: () => statement }
    },
    batch: async () => {
      current = {
        release_id: `release:2026-09-02:${envelope.bundleSha256.slice(0, 20)}`,
        object_key: `releases/2026-09-02/${envelope.bundleSha256}.json.enc`,
        report_date: '2026-09-02',
        status: 'current',
      }
    },
  }
  return {
    envelope,
    environment: {
      APP_ENV: 'test',
      PRIVATE_HOSTNAME: 'inventory-ops.joegallant.me',
      RELEASE_PUBLISHER_TOKEN: 'publisher-test-token',
      RELEASE_ENCRYPTION_KEY_BASE64: base64url(keyBytes),
      INVENTORY_DB: database,
      RELEASE_SNAPSHOTS: {
        put: async (objectKey: string, value: string) => {
          stored = { objectKey, value }
        },
        get: async (objectKey: string) => {
          const object = stored
          return object?.objectKey === objectKey ? { text: async () => object.value } : null
        },
      },
    },
  }
}

describe('private Cloudflare release worker', () => {
  it('refuses protected data from a non-private host', async () => {
    const { environment } = await testEnvironment()
    const response = await worker.fetch(new Request('https://worker.example/api/releases/current'), environment)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'PRIVATE_HOST_REQUIRED' })
  })

  it('requires Access and publisher authentication before accepting a release', async () => {
    const { environment, envelope } = await testEnvironment()
    const response = await worker.fetch(
      new Request('https://inventory-ops.joegallant.me/internal/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      }),
      environment,
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'ACCESS_AUTHENTICATION_REQUIRED' })
  })

  it('round-trips a verified encrypted release only through the protected host', async () => {
    const { environment, envelope } = await testEnvironment()
    const publish = await worker.fetch(
      new Request('https://inventory-ops.joegallant.me/internal/releases', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer publisher-test-token',
          'CF-Access-Jwt-Assertion': 'test-access-assertion',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envelope),
      }),
      environment,
    )
    expect(publish.status).toBe(201)

    const current = await worker.fetch(
      new Request('https://inventory-ops.joegallant.me/api/releases/current', {
        headers: { 'CF-Access-Jwt-Assertion': 'test-access-assertion' },
      }),
      environment,
    )
    expect(current.status).toBe(200)
    await expect(current.json()).resolves.toMatchObject({ reportDate: '2026-09-02' })
  })
})
