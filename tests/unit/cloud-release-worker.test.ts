// PRODUCT-RULE TEST
// @ts-nocheck -- exercises plain ESM Worker with real cryptographic signatures.
// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import worker, { jsonRevalidated, prepareTransportAssignment, readJson, resolveTransportAssignment } from '../../cloudflare/src/worker.mjs'
import { memberContext, verifyAccess } from '../../cloudflare/src/access.mjs'
import { WorkflowError } from '../../server/workflow.mjs'

const host='inventory-ops.joegallant.me', issuer='https://synthetic-inventory.cloudflareaccess.com'
let privateKey
const member={user_id:'SYNTHETIC-user',name:'Synthetic Sales',role:'sales',home_store:'Howell',transport_name_matches:0}
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
  it('reports null version metadata without the binding, and the mapped fields when it is present',async()=>{
    const jwt=await token()
    const bare=await (await worker.fetch(request('/api/health',jwt),env)).json()
    expect(bare.version).toBeNull()
    const withVersion={...env,CF_VERSION_METADATA:{id:'v1',tag:'release-1',timestamp:'2026-09-19T00:00:00Z'}}
    const tagged=await (await worker.fetch(request('/api/health',jwt),withVersion)).json()
    expect(tagged.version).toEqual({versionId:'v1',versionTag:'release-1',versionTimestamp:'2026-09-19T00:00:00Z'})
  })
  it('fails closed for unregistered employees',async()=>{
    const denied={...env,INVENTORY_DB:{prepare(){return {bind(){return this},first:async()=>null}}}}
    expect((await worker.fetch(request('/api/health',await token()),denied)).status).toBe(403)
  })
  it('answers 405 for a write to a read-only route before touching the release or ledger',async()=>{
    const get=vi.fn(()=>{throw new Error('Release must not be read for a request that can never commit')})
    const guarded={...env,RELEASE_SNAPSHOTS:{get}}
    for (const path of ['/api/vehicles/TESTDATAHWELL0001','/api/vehicles/TESTDATAHWELL0001/invoice','/api/vehicles/TESTDATAHWELL0001/equipment-pdf','/api/attention/synthetic-id','/api/transfers/synthetic-id','/api/bootstrap']) {
      const response=await worker.fetch(request(path,await token(),{method:'POST',headers:{origin:`https://${host}`,'idempotency-key':'synthetic','content-type':'application/json'},body:'{}'}),guarded)
      expect(response.status,path).toBe(405)
    }
    expect(get).not.toHaveBeenCalled()
  })
  it('does not expose the raw release download',async()=>expect((await worker.fetch(request('/api/releases/current',await token()),env)).status).toBe(404))
  it('separates the machine uploader from employee access',async()=>{
    const jwt=await token({aud:env.ACCESS_PUBLISHER_AUDIENCE,sub:'',email:undefined,common_name:env.PUBLISHER_CLIENT_ID})
    expect((await verifyAccess(request('/internal/status',jwt),env,env.ACCESS_PUBLISHER_AUDIENCE)).common_name).toBe(env.PUBLISHER_CLIENT_ID)
    expect((await worker.fetch(request('/api/health',jwt),env)).status).toBe(401)
    expect((await worker.fetch(request('/internal/status',jwt,{headers:{Authorization:`Bearer ${env.RELEASE_PUBLISHER_TOKEN}`}}),env)).status).toBe(200)
  })
  it('denies employee tokens on upload paths',async()=>expect((await worker.fetch(request('/internal/status',await token()),env)).status).toBe(401))
  it('returns the active release hash only through the authenticated publisher status route',async()=>{
    const hash='e'.repeat(64)
    const active={...env,INVENTORY_DB:{prepare(){return {async first(){return {report_date:'2026-08-30',bundle_sha256:hash,metadata_json:'{}'}}}}}}
    const jwt=await token({aud:env.ACCESS_PUBLISHER_AUDIENCE,sub:'',email:undefined,common_name:env.PUBLISHER_CLIENT_ID})
    const result=await worker.fetch(request('/internal/status',jwt,{headers:{Authorization:`Bearer ${env.RELEASE_PUBLISHER_TOKEN}`}}),active)
    expect(await result.json()).toMatchObject({ready:true,reportDate:'2026-08-30',bundleSha256:hash})
  })
  it('reports the exact current bundle identity only to the authenticated publisher',async()=>{
    const current={report_date:'2026-09-09',bundle_sha256:'b'.repeat(64),metadata_json:JSON.stringify({publicRowCount:8})}
    const configured={...env,INVENTORY_DB:{prepare(){return {bind(){return this},first:async()=>current}}}}
    const jwt=await token({aud:env.ACCESS_PUBLISHER_AUDIENCE,sub:'',email:undefined,common_name:env.PUBLISHER_CLIENT_ID})
    const response=await worker.fetch(request('/internal/status',jwt,{headers:{Authorization:`Bearer ${env.RELEASE_PUBLISHER_TOKEN}`}}),configured)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ready:true,reportDate:'2026-09-09',bundleSha256:current.bundle_sha256,metadata:{publicRowCount:8}})
  })
  it('keeps readiness machine-only and rejects unauthenticated, employee and bearer-only requests',async()=>{
    const get=vi.fn(()=>{throw new Error('Readiness data must not be touched before authentication')})
    const guarded={...env,RELEASE_SNAPSHOTS:{get}}
    expect((await worker.fetch(request('/internal/readiness'),guarded)).status).toBe(401)
    expect((await worker.fetch(request('/internal/readiness',await token()),guarded)).status).toBe(401)
    expect((await worker.fetch(request('/internal/readiness','forged',{headers:{Authorization:`Bearer ${env.RELEASE_PUBLISHER_TOKEN}`}}),guarded)).status).toBe(401)
    const jwt=await token({aud:env.ACCESS_PUBLISHER_AUDIENCE,sub:'',email:undefined,common_name:env.PUBLISHER_CLIENT_ID})
    expect((await worker.fetch(request('/internal/readiness',jwt),guarded)).status).toBe(403)
    expect(get).not.toHaveBeenCalled()
  })
  it('reaches the readiness pipeline only after both publisher checks and reports no release safely',async()=>{
    const jwt=await token({aud:env.ACCESS_PUBLISHER_AUDIENCE,sub:'',email:undefined,common_name:env.PUBLISHER_CLIENT_ID})
    const response=await worker.fetch(request('/internal/readiness?role=group_manager&store=Lincoln',jwt,{headers:{Authorization:`Bearer ${env.RELEASE_PUBLISHER_TOKEN}`}}),env)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({code:'INVENTORY_NOT_IMPORTED'})
  })
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

  it('keeps distinct immutable IDs for Access members who share one display name',async()=>{
    const rows={
      'alex.one@example.invalid':{user_id:'driver-alex-1',name:'Alex Driver',role:'driver',home_store:'Howell',transport_name_matches:2},
      'alex.two@example.invalid':{user_id:'driver-alex-2',name:'Alex Driver',role:'driver',home_store:'Fowlerville',transport_name_matches:2},
    }
    const directory={INVENTORY_DB:{prepare(){let email;return {bind(value){email=value;return this},async first(){return rows[email]??null}}}}}
    const one=await memberContext({email:'alex.one@example.invalid'},directory)
    const two=await memberContext({email:'alex.two@example.invalid'},directory)
    expect(one).toMatchObject({user:'Alex Driver',userId:'driver-alex-1',allowLegacyTransportAssignmentByName:false})
    expect(two).toMatchObject({user:'Alex Driver',userId:'driver-alex-2',allowLegacyTransportAssignmentByName:false})
  })

  it('never enables legacy name authorization for non-ASCII or noncanonical membership labels',async()=>{
    const contextFor=async(row)=>memberContext({email:'driver@example.invalid'},{
      INVENTORY_DB:{prepare(){return {bind(){return this},async first(){return row}}}},
    })
    await expect(contextFor({
      user_id:'driver-emile-1',name:'Émile',role:'driver',home_store:'Howell',transport_name_matches:1,
    })).resolves.toMatchObject({userId:'driver-emile-1',allowLegacyTransportAssignmentByName:false})
    await expect(contextFor({
      user_id:'driver-space-1',name:' Alex Driver ',role:'driver',home_store:'Howell',transport_name_matches:1,
    })).rejects.toMatchObject({code:'EMPLOYEE_NOT_AUTHORIZED'})
  })

  it('resolves a transport display name to exactly one server-owned membership ID',async()=>{
    const prepare=vi.fn(()=>({bind(value){expect(value).toBe('alex driver');return this},async all(){return {results:[{user_id:'driver-alex-1',name:'Alex Driver',role:'driver'}]}}}))
    const result=await resolveTransportAssignment({type:'transport_assigned',assignee:'alex driver',dueAt:'2026-09-03T18:00:00Z'},{INVENTORY_DB:{prepare}})
    expect(result).toEqual({type:'transport_assigned',assignee:'Alex Driver',assigneeUserId:'driver-alex-1',dueAt:'2026-09-03T18:00:00Z'})
    expect(prepare).toHaveBeenCalledOnce()
  })

  it('fails closed for missing, ambiguous, or client-controlled transport identities',async()=>{
    const directory=(results)=>({INVENTORY_DB:{prepare(){return {bind(){return this},async all(){return {results}}}}}})
    await expect(resolveTransportAssignment({type:'return_assigned',assignee:'Nobody'},directory([]))).rejects.toMatchObject({code:'ASSIGNEE_NOT_AUTHORIZED'})
    await expect(resolveTransportAssignment({type:'transport_assigned',assignee:'Alex Driver'},directory([
      {user_id:'driver-alex-1',name:'Alex Driver',role:'driver'},
      {user_id:'driver-alex-2',name:'Alex Driver',role:'driver'},
    ]))).rejects.toMatchObject({code:'ASSIGNEE_NAME_AMBIGUOUS'})
    await expect(resolveTransportAssignment({type:'transport_assigned',assignee:'Alex Driver',assigneeUserId:'forged'},directory([]))).rejects.toMatchObject({code:'ASSIGNEE_IDENTITY_CLIENT_CONTROLLED'})
  })

  it('answers a malformed percent escape in a path as a bad request, not an internal error',async()=>{
    // A crawler, a copy-pasted link, or a probe can produce '%E0%A4%A'.
    // decodeURIComponent throws URIError on it, which is not one of the known
    // error classes, so the whole request was reported as a 500 INTERNAL_ERROR:
    // it looks like a server fault on the dashboard, drags the Worker's error
    // rate up, and tells the caller to retry something that can never succeed.
    const jwt=await token()
    for(const path of ['/api/vehicles/%E0%A4%A','/api/transfers/%','/api/attention/%zz']) {
      const result=await worker.fetch(request(path,jwt),env)
      expect({path,status:result.status}).toEqual({path,status:400})
      expect(await result.json()).toMatchObject({code:'INVALID_PATH'})
    }
  })

  it('reports a missing release encryption key as configuration, not as invalid upload content',async()=>{
    // The key is read through the same decoder as the payload, so an unset
    // binding failed as INVALID_ENCRYPTED_CONTENT with status 400 — blaming a
    // correct upload for the operator's missing secret and sending whoever is
    // on call to re-generate a bundle that was never the problem.
    const jwt=await token({aud:env.ACCESS_PUBLISHER_AUDIENCE,sub:'',email:undefined,common_name:env.PUBLISHER_CLIENT_ID})
    const {RELEASE_ENCRYPTION_KEY_BASE64:_omitted,...unconfigured}=({...env,RELEASE_ENCRYPTION_KEY_BASE64:'x'.repeat(43)+'='})
    const envelope={version:'inventory-flow-private-release-v1',reportDate:'2026-09-09',bundleSha256:'a'.repeat(64),iv:'A'.repeat(16),ciphertext:'B'.repeat(64)}
    const result=await worker.fetch(request('/internal/releases',jwt,{
      method:'POST',headers:{Authorization:`Bearer ${env.RELEASE_PUBLISHER_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(envelope),
    }),unconfigured)
    expect(result.status).toBe(503)
    expect(await result.json()).toMatchObject({code:'RELEASE_KEY_NOT_CONFIGURED'})
  })

  it('does not query or disclose the employee directory until transfer authorization succeeds',async()=>{
    const prepare=vi.fn(()=>{throw new Error('The directory must not be queried')})
    const env={INVENTORY_DB:{prepare}}
    const denied=new WorkflowError('That vehicle move was not found',{status:404,code:'TRANSFER_NOT_FOUND'})
    await expect(prepareTransportAssignment(
      {type:'transport_assigned',assignee:'Alex Driver',dueAt:'2026-09-03T18:00:00Z'},env,
      ()=>{throw denied},
    )).rejects.toBe(denied)
    expect(prepare).not.toHaveBeenCalled()

    const replay={created:false,record:{id:'synthetic-replay'}}
    await expect(prepareTransportAssignment(
      {type:'transport_assigned',assignee:'Alex Driver',dueAt:'2026-09-03T18:00:00Z'},env,()=>replay,
    )).resolves.toEqual({
      input:{type:'transport_assigned',assignee:'Alex Driver',dueAt:'2026-09-03T18:00:00Z'},
      replay,
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('mirrors the Node server: a matching validator gets a 304 with no body, and a changed document gets a new ETag',async()=>{
    const data={meta:{reportDate:'2026-09-22'},vehicles:[]}
    const first=await jsonRevalidated(new Request('https://synthetic.invalid'),data)
    expect(first.status).toBe(200)
    const etag=first.headers.get('ETag')
    expect(etag).toBeTruthy()
    expect(await first.text()).toBe(JSON.stringify(data))

    const revalidated=await jsonRevalidated(new Request('https://synthetic.invalid',{headers:{'if-none-match':etag}}),data)
    expect(revalidated.status).toBe(304)
    expect(await revalidated.text()).toBe('')
    expect(revalidated.headers.get('ETag')).toBe(etag)

    const changed={...data,vehicles:[{vin:'SYNTHETIC-VIN-1'}]}
    const afterChange=await jsonRevalidated(new Request('https://synthetic.invalid',{headers:{'if-none-match':etag}}),changed)
    expect(afterChange.status).toBe(200)
    const nextEtag=afterChange.headers.get('ETag')
    expect(nextEtag).toBeTruthy()
    expect(nextEtag).not.toBe(etag)
  })
})
