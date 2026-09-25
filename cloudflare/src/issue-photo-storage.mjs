import { Buffer } from 'node:buffer'
import { WorkflowError } from '../../server/workflow.mjs'

const encoder = new TextEncoder()
const objectKey = (vin, id) => `vehicle-issues/${vin}/${id}.enc`
async function keyFor(env) {
  const bytes = Buffer.from(env.RELEASE_ENCRYPTION_KEY_BASE64 ?? '', 'base64')
  if (bytes.length !== 32) throw new WorkflowError('Photo storage is unavailable. Try again later.', { status: 503, code: 'PHOTO_STORAGE_UNAVAILABLE' })
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function storeIssuePhotos(env, vin, photos) {
  if (!photos.length) return
  const key = await keyFor(env)
  for (const photo of photos) {
    const path = objectKey(vin, photo.metadata.id)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(path) }, key, photo.bytes)
    const payload = new Uint8Array(iv.length + encrypted.byteLength)
    payload.set(iv); payload.set(new Uint8Array(encrypted), iv.length)
    // Content-addressed objects can safely survive a lost response or a D1
    // conflict. A failed commit never exposes an unreferenced photo via API.
    await env.RELEASE_SNAPSHOTS.put(path, payload, { httpMetadata: { contentType: 'application/octet-stream' } })
  }
}

export async function readIssuePhoto(env, vin, photo) {
  const path = objectKey(vin, photo.id)
  const object = await env.RELEASE_SNAPSHOTS.get(path)
  if (!object) throw new WorkflowError('This photo is temporarily unavailable. Try again.', { status: 503, code: 'PHOTO_UNAVAILABLE' })
  try {
    const payload = new Uint8Array(await object.arrayBuffer())
    const key = await keyFor(env)
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(0, 12), additionalData: encoder.encode(path) }, key, payload.subarray(12))
    if (bytes.byteLength !== photo.bytes) throw new Error('Size mismatch')
    return bytes
  } catch {
    throw new WorkflowError('This photo could not be loaded. Try again.', { status: 503, code: 'PHOTO_UNAVAILABLE' })
  }
}
