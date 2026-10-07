// @ts-nocheck -- signed JWTs, isolated D1 adapters and a real Worker request.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import platformWorker from '../../cloudflare/src/platform-worker.mjs'
import tenantWorker from '../../cloudflare/src/worker.mjs'
import { createSyntheticPlatformAdmin } from '../../fixtures/synthetic-platform-admin.mjs'

const issuer='https://synthetic-platform.cloudflareaccess.com', audience='synthetic-owner-audience'
let signing,otherSigning
const resources=[]
beforeAll(async()=>{
  signing=await generateKeyPair('RS256');otherSigning=await generateKeyPair('RS256')
  const jwk=await exportJWK(signing.publicKey);jwk.kid='synthetic-platform-key'
  vi.stubGlobal('fetch',vi.fn(async url=>{expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`);return Response.json({keys:[jwk]})}))
})
afterEach(()=>{for(const resource of resources.splice(0))resource.close()})
afterAll(()=>vi.unstubAllGlobals())
async function token(extra={},key=signing.privateKey){const now=Math.floor(Date.now()/1000);return new SignJWT({iss:issuer,aud:audience,sub:'synthetic-owner-sub',email:'owner@example.invalid',iat:now,exp:now+3600,...extra}).setProtectedHeader({alg:'RS256',kid:'synthetic-platform-key'}).sign(key)}
function setup(){const fixture=createSyntheticPlatformAdmin();resources.push(fixture);const assets=vi.fn(async()=>new Response('<html>synthetic owner assets</html>',{headers:{'content-type':'text/html'}}));return {...fixture,env:{...fixture.env,PRIVATE_HOSTNAME:'owner.example.invalid',ACCESS_ISSUER:issuer,ACCESS_AUDIENCE:audience,ASSETS:{fetch:assets}},assets}}
const request=(jwt,path='/api/platform',extra={})=>new Request(`https://owner.example.invalid${path}`,{headers:{'cf-access-jwt-assertion':jwt,'x-inventory-authenticated-role':'software_owner','x-inventory-authenticated-user':'Spoofed Owner',...extra}})

describe('Owner Worker authorization boundary',()=>{
  it.each([{aud:'employee-audience'},{exp:1},{iss:'https://wrong.cloudflareaccess.com'}, {email:'manager@example.invalid',role:'software_owner'}, {email:'owner@example.invalid',common_name:'publisher'}])('rejects wrong audience, expiry, issuer, employee or machine claims: %j',async extra=>{
    const {env,assets}=setup()
    const response=await platformWorker.fetch(request(await token(extra),'/platform'),env)
    expect([401,403]).toContain(response.status)
    expect(assets).not.toHaveBeenCalled()
  })
  it('rejects absent and forged signatures before accessing assets or tenant records',async()=>{
    const {env,assets}=setup()
    for(const jwt of ['',await token({},otherSigning.privateKey)]) expect((await platformWorker.fetch(request(jwt),env)).status).toBe(401)
    expect(assets).not.toHaveBeenCalled()
  })
  it('serves the enabled server-owned owner and revokes the next read without caching authority',async()=>{
    const {env,sqlite}=setup(),jwt=await token()
    const initial=await platformWorker.fetch(request(jwt),env)
    expect(initial.status).toBe(200)
    expect((await initial.json()).owner.name).toBe('Demo software owner')
    sqlite.prepare('INSERT INTO platform_owners VALUES(?,?,?,1)').run('synthetic-backup','backup@example.invalid','Synthetic Backup')
    sqlite.prepare("UPDATE platform_owners SET enabled=0 WHERE id='synthetic-owner'").run()
    expect((await platformWorker.fetch(request(jwt),env)).status).toBe(403)
  })
  it('serves an owner-only installation with no groups, dealership bindings or tenant databases',async()=>{
    const {env,sqlite}=setup(),jwt=await token()
    sqlite.prepare('DELETE FROM platform_dealerships').run()
    sqlite.prepare('DELETE FROM platform_groups').run()
    env.PLATFORM_TENANT_BINDINGS='{}'
    delete env.TENANT_NORTH_DB

    const response=await platformWorker.fetch(request(jwt),env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({owner:{id:'synthetic-owner'},groups:[],owners:[{id:'synthetic-owner'}],audit:[]})
  })
  it('denies owner static assets after the server-owned owner is disabled',async()=>{
    const {env,sqlite,assets}=setup(),jwt=await token()
    sqlite.prepare('INSERT INTO platform_owners VALUES(?,?,?,1)').run('synthetic-backup','backup@example.invalid','Synthetic Backup')
    sqlite.prepare("UPDATE platform_owners SET enabled=0 WHERE id='synthetic-owner'").run()

    const response=await platformWorker.fetch(request(jwt,'/platform'),env)
    expect(response.status).toBe(403)
    expect(assets).not.toHaveBeenCalled()
  })
  it('does not expose employee bootstrap, inventory, publisher or source-write routes even to an owner',async()=>{
    const {env}=setup(),jwt=await token()
    for(const path of ['/api/bootstrap','/api/vehicles','/internal/releases','/inventory','/api/platform/dealermail/holds']) expect((await platformWorker.fetch(request(jwt,path),env)).status).toBe(404)
  })
  it('blocks a noncanonical hostname and refuses a missing control-plane binding',async()=>{
    const {env}=setup(),jwt=await token()
    expect((await platformWorker.fetch(new Request('https://different.example.invalid/api/platform',{headers:{'cf-access-jwt-assertion':jwt}}),env)).status).toBe(403)
    expect((await platformWorker.fetch(request(jwt),{...env,PLATFORM_DB:undefined})).status).toBe(503)
  })
  it('checks the opt-in tenant gate before the tenant inventory API and does not add owner routes there',async()=>{
    const {env,sqlite}=setup(),jwt=await token()
    const tenantEnv={PRIVATE_HOSTNAME:env.PRIVATE_HOSTNAME,ACCESS_ISSUER:issuer,ACCESS_AUDIENCE:audience,INVENTORY_DB:env.TENANT_NORTH_DB,PLATFORM_CONTROL_DB:env.PLATFORM_DB,PLATFORM_TENANT_ID:'synthetic-north'}
    sqlite.prepare("UPDATE platform_groups SET status='suspended' WHERE id='synthetic-north'").run()
    const response=await tenantWorker.fetch(request(jwt,'/api/bootstrap'),tenantEnv)
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('TENANT_ACCESS_SUSPENDED')
    expect((await tenantWorker.fetch(request('', '/api/bootstrap'),tenantEnv)).status).toBe(401)
    expect((await tenantWorker.fetch(request(jwt),{...tenantEnv,PLATFORM_TENANT_ID:'wrong'})).status).toBe(503)
  })
})
