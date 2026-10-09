// @ts-nocheck -- cryptographically signed fabricated Access identities only.
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import worker from '../../cloudflare/src/platform-worker.mjs'
import { createSyntheticCollector } from '../../fixtures/synthetic-collector.mjs'
const issuer='https://synthetic-collector-security.cloudflareaccess.com',host='owner.example.invalid'
let fixture,privateKey
beforeAll(async()=>{
 fixture=await createSyntheticCollector();const pair=await generateKeyPair('RS256');privateKey=pair.privateKey
 const jwk=await exportJWK(pair.publicKey);jwk.kid='synthetic-collector-auth-key'
 vi.stubGlobal('fetch',vi.fn(async url=>{expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`);return Response.json({keys:[jwk]})}))
 Object.assign(fixture.env,{PRIVATE_HOSTNAME:host,ACCESS_ISSUER:issuer,ACCESS_AUDIENCE:'owner-audience'})
})
afterAll(()=>{fixture.close();vi.unstubAllGlobals()})
const token=async(extra={})=>{const now=Math.floor(Date.now()/1000);return new SignJWT({iss:issuer,aud:'synthetic-collector-aud',sub:'synthetic-service',common_name:fixture.machine.common_name,iat:now,exp:now+300,...extra}).setProtectedHeader({alg:'RS256',kid:'synthetic-collector-auth-key'}).sign(privateKey)}
const request=(path,jwt,input={profileSha256:'a'.repeat(64),adapterVersion:'1'})=>new Request(`https://${host}${path}`,{method:'POST',headers:{'content-type':'application/json','cf-access-jwt-assertion':jwt,'idempotency-key':'synthetic-auth'},body:JSON.stringify(input)})
describe('Separate collector Access authentication',()=>{
 it('accepts only the enrolled service common_name under the separate collector audience',async()=>{
  const response=await worker.fetch(request('/api/collector/contact',await token()),fixture.env)
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({collectorId:fixture.collectorId,connected:true})
 })
 it.each([{aud:'owner-audience',common_name:undefined,email:'owner@example.invalid'},{aud:'wrong-audience'},{common_name:'unenrolled.access'},{email:'owner@example.invalid'},{exp:1},{iss:'https://other.cloudflareaccess.com'}])('rejects substituted machine/owner claims %j',async override=>{
  const response=await worker.fetch(request('/api/collector/contact',await token(override)),fixture.env)
  expect([401,403]).toContain(response.status)
 })
 it('refuses collector signatures on owner administration and same-audience configuration',async()=>{
  expect((await worker.fetch(request('/api/platform/groups',await token(),{}),fixture.env)).status).toBe(401)
  expect((await worker.fetch(request('/api/collector/contact',await token()),{...fixture.env,ACCESS_COLLECTOR_AUDIENCE:'owner-audience'})).status).toBe(503)
 })
 it('rejects revoked machine identity before malformed body parsing or candidate lookup',async()=>{
  fixture.sqlite.prepare("UPDATE platform_collectors SET revoked_at='2026-08-30T15:00:00Z',enabled=0,generation=generation+1 WHERE id=?").run(fixture.collectorId)
  const request=new Request(`https://${host}/api/collector/publication`,{method:'POST',headers:{'cf-access-jwt-assertion':await token()},body:'SYNTHETIC_PRIVATE_BODY'})
  const response=await worker.fetch(request,fixture.env);expect(response.status).toBe(403);expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE_BODY')
 })
})
