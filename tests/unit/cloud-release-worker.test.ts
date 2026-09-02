// @ts-nocheck -- exercises plain ESM Worker with real cryptographic signatures.
// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import worker, { readJson } from '../../cloudflare/src/worker.mjs'
import { verifyAccess } from '../../cloudflare/src/access.mjs'

const host='inventory-ops.joegallant.me', issuer='https://synthetic-inventory.cloudflareaccess.com'
let privateKey
const member={user_id:'SYNTHETIC-user',name:'Synthetic Sales',role:'sales',home_store:'Howell'}
const env={PRIVATE_HOSTNAME:host,ACCESS_ISSUER:issuer,ACCESS_AUDIENCE:'synthetic-employee-aud',ACCESS_PUBLISHER_AUDIENCE:'synthetic-publisher-aud',PUBLISHER_CLIENT_ID:'synthetic-client.access',RELEASE_PUBLISHER_TOKEN:'synthetic-publisher',INVENTORY_DB:{prepare(sql){return {bind(){return this},async first(){return sql.includes('cloud_memberships')?member:null}}}}}
beforeAll(async()=>{
  const pair=await generateKeyPair('RS256'); privateKey=pair.privateKey
  const jwk=await exportJWK(pair.publicKey);jwk.kid='synthetic-key'
  vi.stubGlobal('fetch',vi.fn(async url=>{
    expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`)
    return new Response(JSON.stringify({keys:[jwk]}),{headers:{'content-type':'application/json'}})
  }))
})
afterAll(()=>vi.unstubAllGlobals())
async function token(overrides={}) {
  const now=Math.floor(Date.now()/1000)
  return new SignJWT({iss:issuer,aud:env.ACCESS_AUDIENCE,sub:'synthetic-sub',email:'synthetic@example.invalid',iat:now,exp:now+3600,...overrides}).setProtectedHeader({alg:'RS256',kid:'synthetic-key'}).sign(privateKey)
}
function request(path='/api/health',jwt,options={}) {return new Request(`https://${host}${path}`,{...options,headers:{...(jwt?{'cf-access-jwt-assertion':jwt}:{}),...options.headers}})}
describe('Cloud Worker authentication boundary',()=>{
  it('rejects alternate hosts before data access',async()=>expect((await worker.fetch(new Request('https://other.example/api/health'),env)).status).toBe(403))
  it('requires sign in',async()=>expect((await worker.fetch(request(),env)).status).toBe(401))
  it('rejects a forged header',async()=>expect((await worker.fetch(request('/api/health','forged'),env)).status).toBe(401))
  it.each([{aud:'wrong'}, {iss:'https://wrong.cloudflareaccess.com'}, {exp:1}, {nbf:9999999999}])('rejects invalid signed claims %j',async claims=>expect((await worker.fetch(request('/api/health',await token(claims)),env)).status).toBe(401))
  it('accepts valid employee signatures and registered membership',async()=>expect((await worker.fetch(request('/api/health',await token()),env)).status).toBe(200))
  it('fails closed for unregistered employees',async()=>{
    const denied={...env,INVENTORY_DB:{prepare(){return {bind(){return this},first:async()=>null}}}}
    expect((await worker.fetch(request('/api/health',await token()),denied)).status).toBe(403)
  })
  it('does not expose the raw release download',async()=>expect((await worker.fetch(request('/api/releases/current',await token()),env)).status).toBe(404))
  it('separates the machine uploader from employee access',async()=>{
    const jwt=await token({aud:env.ACCESS_PUBLISHER_AUDIENCE,sub:'',email:undefined,common_name:env.PUBLISHER_CLIENT_ID})
    expect((await verifyAccess(request('/internal/status',jwt),env,env.ACCESS_PUBLISHER_AUDIENCE)).common_name).toBe(env.PUBLISHER_CLIENT_ID)
    expect((await worker.fetch(request('/api/health',jwt),env)).status).toBe(401)
    expect((await worker.fetch(request('/internal/status',jwt,{headers:{Authorization:`Bearer ${env.RELEASE_PUBLISHER_TOKEN}`}}),env)).status).toBe(200)
  })
  it('denies employee tokens on upload paths',async()=>expect((await worker.fetch(request('/internal/status',await token()),env)).status).toBe(401))
  it('catches async database failures without reflecting private values',async()=>{
    const failed={...env,INVENTORY_DB:{prepare(){throw new Error('SYNTHETIC-PRIVATE-NOTE')}}}
    const response=await worker.fetch(request('/api/health',await token()),failed)
    expect(response.status).toBe(500);expect(await response.text()).not.toContain('SYNTHETIC-PRIVATE-NOTE')
  })
  it('rejects cross-origin writes before body or data access',async()=>expect((await worker.fetch(request('/api/transfers',await token(),{method:'POST',headers:{Origin:'https://wrong.example'}}),env)).status).toBe(403))
  it('bounds streamed input even without Content-Length',async()=>{
    const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(101));controller.close()}})
    await expect(readJson(new Request('https://synthetic.invalid',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}),100)).rejects.toMatchObject({status:413})
  })
})
