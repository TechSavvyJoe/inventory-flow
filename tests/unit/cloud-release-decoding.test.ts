// @ts-nocheck -- Worker ESM uses the nodejs_compat Buffer implementation.
// @vitest-environment node
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptEnvelope, validatedReleaseCounts } from '../../cloudflare/src/worker.mjs'
import { datasetFromRelease } from '../../cloudflare/src/repository.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { resourceProvenanceSha256 } from '../../server/resource-validation.mjs'

const format='inventory-flow-private-ledger-v1'
const releaseFormat='inventory-flow-private-release-v1'
function encryptedPayload(payload,key,version) {
  const iv=randomBytes(12), plaintext=Buffer.from(JSON.stringify(payload))
  const bundleSha256=createHash('sha256').update(plaintext).digest('hex')
  const cipher=createCipheriv('aes-256-gcm',key,iv)
  cipher.setAAD(Buffer.from(`${version}:${payload.reportDate}:${bundleSha256}`))
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()])
  return {env:{RELEASE_ENCRYPTION_KEY_BASE64:key.toString('base64')},envelope:{version,reportDate:payload.reportDate,bundleSha256,iv:iv.toString('base64url'),ciphertext:ciphertext.toString('base64url')}}
}
function fixture(length=32) {
  const key=randomBytes(32)
  const payload={schemaVersion:format,reportDate:'2026-09-02',fixtureMarker:'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS',data:'x'.repeat(length)}
  return {payload,...encryptedPayload(payload,key,format)}
}

describe('bounded-memory release decoding',()=>{
  it('returns only private cached counts from a validated release and refuses caller-supplied or lost caches',async()=>{
    const bundle=buildSyntheticCloudBundle(),{env,envelope}=encryptedPayload(bundle,randomBytes(32),releaseFormat)
    const decoded=await decryptEnvelope(envelope,env)
    expect(validatedReleaseCounts(decoded)).toMatchObject({publicRowCount:8,dealerMailRowCount:8,activeInventoryCount:8})
    for(const unvalidated of [bundle,structuredClone(decoded),{counts:{publicRowCount:8}},null])expect(()=>validatedReleaseCounts(unvalidated)).toThrow(expect.objectContaining({code:'INVALID_OR_INCOMPLETE_RELEASE'}))
    const ledger=fixture()
    expect(()=>validatedReleaseCounts(ledger.payload)).toThrow(expect.objectContaining({code:'INVALID_OR_INCOMPLETE_RELEASE'}))
  })
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
  it.each([undefined,false,true])('preserves OASIS action capture flag %s through encrypted release validation',async(openActionsCaptured)=>{
    const bundle=buildSyntheticCloudBundle()
    const vehicle=bundle.release.vehicles.find((record)=>record.resourceRecord)
    vehicle.resourceRecord.fordOasis={dataState:'current',capturedAt:'2026-08-30T14:00:00Z',openFieldServiceActions:[],...(openActionsCaptured===undefined?{}:{openActionsCaptured})}
    const run=bundle.release.sourceRuns.resources
    run.metadata.fordOasisCount=1
    run.provenanceSha256=resourceProvenanceSha256(run,bundle.release.vehicles)
    const {env,envelope}=encryptedPayload(bundle,randomBytes(32),releaseFormat)
    const result=await decryptEnvelope(envelope,env)
    const oasis=result.release.vehicles.find((record)=>record.vin===vehicle.vin).resourceRecord.fordOasis
    expect(oasis.openActionsCaptured).toBe(openActionsCaptured)
    expect(oasis.openFieldServiceActions).toEqual([])
  })
  it('keeps an older release readable by dropping only unsafe new Ford channels with warnings',async()=>{
    const bundle=buildSyntheticCloudBundle()
    const vehicle=bundle.release.vehicles.find((record)=>record.resourceRecord)
    vehicle.resourceRecord.fordOasis={
      dataState:'current',capturedAt:'2026-08-30T14:00:00Z',sourceLabel:'Ford OASIS',
      vehicleDescription:'2023 Synthetic SUV',warrantyStartDate:'01-Jan-2023',openFieldServiceActions:[],
      warrantyCoverages:[{type:'PremiumCARE',description:'8 years / 100,000 Miles'}],extendedCoverageExpirations:[],
    }
    vehicle.resourceRecord.warrantyCheck={
      dataState:'current',capturedAt:'2026-08-30T14:00:00Z',sourceLabel:'UNVERIFIED - Ford OASIS was unavailable. DO NOT QUOTE.',mileageEntered:1000,
      fordOasis:{warrantyStartDate:'01-Jan-2023',monthsInService:12,coverages:[{
        type:'Powertrain',termText:'5 years / 60,000 Miles (whichever occurs first)',termMonths:60,termMiles:60000,
        remainingMiles:59000,remainingMonths:48,remainingMilesText:'59,000 miles left',remainingTimeText:'48 months',status:'ACTIVE',
      }]},
    }
    const run=bundle.release.sourceRuns.resources
    run.metadata.fordOasisCount=1
    run.metadata.warrantyCheckCount=1
    run.provenanceSha256=resourceProvenanceSha256(run,bundle.release.vehicles)
    const {env,envelope}=encryptedPayload(bundle,randomBytes(32),releaseFormat)
    const result=await decryptEnvelope(envelope,env)
    const sanitized=result.release.vehicles.find((record)=>record.vin===vehicle.vin).resourceRecord
    expect(sanitized.factoryEquipment).toBeTruthy()
    expect(sanitized).not.toHaveProperty('fordOasis')
    expect(sanitized).not.toHaveProperty('warrantyCheck')
    expect(result.release.warnings.filter((warning)=>warning.includes(vehicle.vin) && warning.includes('dropped unsafe'))).toHaveLength(2)
    expect(JSON.parse(datasetFromRelease(result.release).state.current_release_warnings_json).filter((warning)=>warning.includes(vehicle.vin) && warning.includes('dropped unsafe'))).toHaveLength(2)
  })
})
