const RELEASE_FORMAT = 'inventory-flow-private-release-v1'
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function jsonResponse(status, value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      'Content-Type': 'application/json; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  })
}

function errorResponse(status, code, requestId) {
  return jsonResponse(status, { error: code, requestId })
}

function requestId() {
  return crypto.randomUUID()
}

function constantTimeEquals(left, right) {
  const a = textEncoder.encode(String(left ?? ''))
  const b = textEncoder.encode(String(right ?? ''))
  let mismatch = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return mismatch === 0
}

function base64ToBytes(value) {
  const normalized = String(value ?? '').trim().replace(/-/g, '+').replace(/_/g, '/')
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error('Invalid base64 value')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sha256Hex(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isPrivateHost(url, env) {
  return Boolean(env.PRIVATE_HOSTNAME) && url.hostname === env.PRIVATE_HOSTNAME
}

function hasAccessAssertion(request) {
  // Cloudflare Access validates this JWT before the request reaches a protected
  // route. Requiring the assertion here is defense in depth and keeps an
  // accidental public route from returning a private release.
  return Boolean(request.headers.get('CF-Access-Jwt-Assertion'))
}

function requirePrivateReader(request, url, env, id) {
  if (!isPrivateHost(url, env)) return errorResponse(403, 'PRIVATE_HOST_REQUIRED', id)
  if (!hasAccessAssertion(request)) return errorResponse(401, 'ACCESS_AUTHENTICATION_REQUIRED', id)
  return null
}

function requirePublisher(request, url, env, id) {
  const readerFailure = requirePrivateReader(request, url, env, id)
  if (readerFailure) return readerFailure
  const configuredToken = env.RELEASE_PUBLISHER_TOKEN
  const authorization = request.headers.get('Authorization') ?? ''
  const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!configuredToken || !suppliedToken || !constantTimeEquals(configuredToken, suppliedToken)) {
    return errorResponse(403, 'PUBLISHER_AUTHENTICATION_REQUIRED', id)
  }
  return null
}

function encryptionKey(env) {
  const bytes = base64ToBytes(env.RELEASE_ENCRYPTION_KEY_BASE64)
  if (bytes.byteLength !== 32) throw new Error('Release encryption key must be 32 bytes')
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt'])
}

function validateEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Release body must be an object')
  if (value.version !== RELEASE_FORMAT) throw new Error('Unsupported release format')
  if (!DATE_PATTERN.test(String(value.reportDate ?? ''))) throw new Error('Invalid report date')
  if (!HASH_PATTERN.test(String(value.bundleSha256 ?? ''))) throw new Error('Invalid release checksum')
  if (typeof value.iv !== 'string' || typeof value.ciphertext !== 'string') throw new Error('Missing encrypted release content')
  return value
}

async function decryptAndValidate(envelope, env) {
  const iv = base64ToBytes(envelope.iv)
  const ciphertext = base64ToBytes(envelope.ciphertext)
  if (iv.byteLength !== 12 || ciphertext.byteLength < 17) throw new Error('Invalid encrypted release content')
  const aad = textEncoder.encode(`${RELEASE_FORMAT}:${envelope.reportDate}:${envelope.bundleSha256}`)
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      await encryptionKey(env),
      ciphertext,
    ),
  )
  if ((await sha256Hex(plaintext)) !== envelope.bundleSha256) throw new Error('Release checksum mismatch')

  let bundle
  try {
    bundle = JSON.parse(textDecoder.decode(plaintext))
  } catch {
    throw new Error('Encrypted content is not valid JSON')
  }
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('Invalid release bundle')
  if (bundle.schemaVersion !== RELEASE_FORMAT || bundle.complete !== true) throw new Error('Release is not complete')
  if (bundle.reportDate !== envelope.reportDate || bundle.release?.reportDate !== envelope.reportDate) {
    throw new Error('Release date does not match encrypted content')
  }
  const publicRun = bundle.release?.sourceRuns?.public
  const dealerMailRun = bundle.release?.sourceRuns?.dealerMail
  if (publicRun?.status !== 'current' || dealerMailRun?.status !== 'current') {
    throw new Error('Release sources are not current')
  }
  if (!HASH_PATTERN.test(String(publicRun.sha256 ?? '')) || !HASH_PATTERN.test(String(dealerMailRun.sha256 ?? ''))) {
    throw new Error('Release source checksums are invalid')
  }
  return { bundle, plaintext }
}

function metadataFor(bundle) {
  const publicRun = bundle.release.sourceRuns.public
  const dealerMailRun = bundle.release.sourceRuns.dealerMail
  return {
    publicSourceSha256: publicRun.sha256,
    dealerMailSourceSha256: dealerMailRun.sha256,
    publicRowCount: Number(publicRun.rowCount ?? 0),
    dealerMailRowCount: Number(dealerMailRun.rowCount ?? 0),
    metadataJson: JSON.stringify({
      schemaVersion: bundle.schemaVersion,
      completedAt: bundle.release.completedAt ?? null,
      timezone: bundle.release.timezone ?? null,
      warningCount: Array.isArray(bundle.release.warnings) ? bundle.release.warnings.length : 0,
      resourceStatus: bundle.release.sourceRuns.resources?.status ?? null,
    }),
  }
}

async function currentRelease(env) {
  return env.INVENTORY_DB.prepare(
    `SELECT version.*
     FROM cloud_release_state AS state
     JOIN cloud_release_versions AS version ON version.release_id = state.value
     WHERE state.key = 'current_release_id' AND version.status = 'current'`,
  ).first()
}

async function handleHealth(env, id) {
  const release = await currentRelease(env)
  return jsonResponse(200, {
    service: 'inventory-ops-private-release-api',
    environment: env.APP_ENV ?? 'unknown',
    releaseReady: Boolean(release),
    requestId: id,
  })
}

async function handlePublish(request, url, env, id) {
  const authorizationFailure = requirePublisher(request, url, env, id)
  if (authorizationFailure) return authorizationFailure
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return errorResponse(413, 'RELEASE_BODY_TOO_LARGE', id)
  }

  let body
  try {
    const text = await request.text()
    if (textEncoder.encode(text).byteLength > MAX_UPLOAD_BYTES) return errorResponse(413, 'RELEASE_BODY_TOO_LARGE', id)
    body = validateEnvelope(JSON.parse(text))
  } catch {
    return errorResponse(400, 'INVALID_RELEASE_ENVELOPE', id)
  }

  let decrypted
  try {
    decrypted = await decryptAndValidate(body, env)
  } catch {
    return errorResponse(400, 'INVALID_OR_INCOMPLETE_RELEASE', id)
  }

  const existing = await env.INVENTORY_DB.prepare(
    'SELECT release_id, object_key, status FROM cloud_release_versions WHERE report_date = ? AND bundle_sha256 = ?',
  )
    .bind(body.reportDate, body.bundleSha256)
    .first()
  if (existing) {
    return jsonResponse(200, { status: 'already_published', reportDate: body.reportDate, requestId: id })
  }

  const current = await currentRelease(env)
  if (current?.report_date && current.report_date > body.reportDate) {
    return errorResponse(409, 'RELEASE_DATE_WOULD_ROLL_BACK', id)
  }

  const releaseId = `release:${body.reportDate}:${body.bundleSha256.slice(0, 20)}`
  const objectKey = `releases/${body.reportDate}/${body.bundleSha256}.json.enc`
  const createdAt = new Date().toISOString()
  const serializedEnvelope = JSON.stringify(body)
  const metadata = metadataFor(decrypted.bundle)

  // Store the verified ciphertext before advancing any D1 pointer. If a later
  // D1 write fails, the object is an unreferenced encrypted artifact; no client
  // can observe it as the current release.
  await env.RELEASE_SNAPSHOTS.put(objectKey, serializedEnvelope, {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { format: RELEASE_FORMAT, reportDate: body.reportDate, bundleSha256: body.bundleSha256 },
  })

  const statements = []
  if (current?.release_id) {
    statements.push(env.INVENTORY_DB.prepare("UPDATE cloud_release_versions SET status = 'superseded' WHERE release_id = ?").bind(current.release_id))
  }
  statements.push(
    env.INVENTORY_DB
      .prepare(
        `INSERT INTO cloud_release_versions (
          release_id, report_date, bundle_sha256, object_key, object_bytes,
          public_source_sha256, dealermail_source_sha256, public_row_count,
          dealermail_row_count, status, published_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?)`,
      )
      .bind(
        releaseId,
        body.reportDate,
        body.bundleSha256,
        objectKey,
        textEncoder.encode(serializedEnvelope).byteLength,
        metadata.publicSourceSha256,
        metadata.dealerMailSourceSha256,
        metadata.publicRowCount,
        metadata.dealerMailRowCount,
        createdAt,
        metadata.metadataJson,
      ),
  )
  statements.push(
    env.INVENTORY_DB
      .prepare(
        `INSERT INTO cloud_release_state (key, value, updated_at) VALUES ('current_release_id', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(releaseId, createdAt),
  )
  await env.INVENTORY_DB.batch(statements)

  return jsonResponse(201, { status: 'published', reportDate: body.reportDate, requestId: id })
}

async function handleCurrentRelease(request, url, env, id) {
  const authorizationFailure = requirePrivateReader(request, url, env, id)
  if (authorizationFailure) return authorizationFailure
  const release = await currentRelease(env)
  if (!release) return errorResponse(404, 'NO_CURRENT_RELEASE', id)
  const object = await env.RELEASE_SNAPSHOTS.get(release.object_key)
  if (!object) return errorResponse(503, 'CURRENT_RELEASE_ARTIFACT_MISSING', id)
  try {
    const envelope = validateEnvelope(JSON.parse(await object.text()))
    const { bundle } = await decryptAndValidate(envelope, env)
    return jsonResponse(200, bundle.release, { ETag: `\"${envelope.bundleSha256}\"` })
  } catch {
    return errorResponse(503, 'CURRENT_RELEASE_UNAVAILABLE', id)
  }
}

export default {
  async fetch(request, env) {
    const id = requestId()
    const url = new URL(request.url)
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return handleHealth(env, id)
      if (request.method === 'POST' && url.pathname === '/internal/releases') return handlePublish(request, url, env, id)
      if (request.method === 'GET' && url.pathname === '/api/releases/current') return handleCurrentRelease(request, url, env, id)
      return errorResponse(404, 'NOT_FOUND', id)
    } catch {
      // Do not reflect database, key, R2, or authentication failures to a
      // browser or publisher. The request ID is enough to correlate a private
      // Cloudflare log without exposing operational information.
      return errorResponse(500, 'INTERNAL_ERROR', id)
    }
  },
}
