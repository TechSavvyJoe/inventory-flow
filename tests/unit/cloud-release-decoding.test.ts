// @ts-nocheck -- Worker ESM uses the nodejs_compat Buffer implementation.
// @vitest-environment node
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptEnvelope } from '../../cloudflare/src/worker.mjs'

const format='inventory-flow-private-ledger-v1'
function fixture(length=32) {
  const key=randomBytes(32), iv=randomBytes(12)
  const payload={schemaVersion:format,reportDate:'2026-09-02',fixtureMarker:'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS',data:'x'.repeat(length)}
  const plaintext=Buffer.from(JSON.stringify(payload)), bundleSha256=createHash('sha256').update(plaintext).digest('hex')
  const cipher=createCipheriv('aes-256-gcm',key,iv)
  cipher.setAAD(Buffer.from(`${format}:${payload.reportDate}:${bundleSha256}`))
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()])
  return {payload,env:{RELEASE_ENCRYPTION_KEY_BASE64:key.toString('base64')},envelope:{version:format,reportDate:payload.reportDate,bundleSha256,iv:iv.toString('base64url'),ciphertext:ciphertext.toString('base64url')}}
}

describe('bounded-memory release decoding',()=>{
  it('decrypts a full-size synthetic release without string-iterator byte expansion',async()=>{
    const {payload,env,envelope}=fixture(5_800_000)
    const result=await decryptEnvelope(envelope,env,format)
    expect(result.data.length).toBe(payload.data.length)
    expect(result.fixtureMarker).toBe(payload.fixtureMarker)
  })
  it('accepts canonical padded standard base64 and unpadded URL-safe base64',async()=>{
    const {payload,env,envelope}=fixture()
    expect(await decryptEnvelope(envelope,env,format)).toEqual(payload)
    const padded={...envelope,ciphertext:Buffer.from(envelope.ciphertext,'base64url').toString('base64')}
    expect(await decryptEnvelope(padded,env,format)).toEqual(payload)
  })
  it.each(['!', 'A', 'AA=', 'AB', 'AAB', 'AA===', 'AA A', 'AA\n'])('rejects malformed or noncanonical encoded input %j',async invalid=>{
    const {env,envelope}=fixture()
    await expect(decryptEnvelope({...envelope,iv:invalid},env,format)).rejects.toMatchObject({code:'INVALID_ENCRYPTED_CONTENT'})
  })
  it('retains authenticated encryption and digest integrity checks',async()=>{
    const {env,envelope}=fixture()
    const tampered=Buffer.from(envelope.ciphertext,'base64url');tampered[0]^=1
    await expect(decryptEnvelope({...envelope,ciphertext:tampered.toString('base64url')},env,format)).rejects.toMatchObject({code:'INVALID_OR_INCOMPLETE_RELEASE'})
    await expect(decryptEnvelope({...envelope,bundleSha256:'0'.repeat(64)},env,format)).rejects.toMatchObject({code:'INVALID_OR_INCOMPLETE_RELEASE'})
  })
})
