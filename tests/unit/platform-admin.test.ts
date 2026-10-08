// @ts-nocheck -- real SQLite/D1 transactions, fabricated owner and tenant identities.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, describe, expect, it } from 'vitest'
import { createSyntheticPlatformAdmin } from '../../fixtures/synthetic-platform-admin.mjs'
import { handlePlatformApi } from '../../cloudflare/src/platform-worker.mjs'
import { platformOwner, readPlatform, readTenantMembers, savePlatform, saveTenantMember, tenantDatabase } from '../../cloudflare/src/platform-admin.mjs'
import { assertTenantEnabled } from '../../cloudflare/src/tenant-gate.mjs'
import { createIntegrationWorker } from '../../cloudflare/src/integration-worker.mjs'
import { vi } from 'vitest'
import { startInventoryServer } from '../../server/index.mjs'
import { buildSyntheticRelease } from '../../fixtures/synthetic-release.mjs'

const resources = []
const claims = {email:'owner@example.invalid',role:'sales'}
const groupId = 'synthetic-north'
afterEach(()=>{for(const resource of resources.splice(0))resource.close()})
function setup() {const fixture=createSyntheticPlatformAdmin();resources.push(fixture);return fixture}
const group = extra => ({name:'Synthetic New Group',status:'setup',reason:'Synthetic account setup',expectedRevision:0,...extra})
const member = extra => ({name:'Synthetic Employee',email:'employee@example.invalid',role:'sales',homeStore:'northside',enabled:true,reason:'Synthetic access setup',expectedRevision:0,...extra})

describe('Software owner identity and registry',()=>{
  it('never derives ownership from employee roles, JWT role claims, names or a publisher identity',async()=>{
    const {env}=setup()
    for(const identity of [{email:'manager@example.invalid',role:'software_owner'}, {name:'Demo software owner',role:'group_manager'}, {email:claims.email,common_name:'machine'}]) await expect(platformOwner(env.PLATFORM_DB,identity)).rejects.toMatchObject({status:403})
    expect((await platformOwner(env.PLATFORM_DB,claims)).id).toBe('synthetic-owner')
  })
  it('creates setup accounts with immutable IDs, attributed audit and retry protection',async()=>{
    const {env,sqlite}=setup()
    const first=await savePlatform(env,claims,'groups',group(),'synthetic-create')
    expect(await savePlatform(env,claims,'groups',group(),'synthetic-create')).toMatchObject({id:first.id,replayed:true})
    await expect(savePlatform(env,claims,'groups',group({name:'Other'}),'synthetic-create')).rejects.toMatchObject({status:409})
    const audit=sqlite.prepare('SELECT * FROM platform_audit').get()
    expect(audit.actor_name).toBe('Demo software owner')
    expect(audit.actor_id).toBe('synthetic-owner')
    expect(()=>sqlite.prepare('DELETE FROM platform_audit').run()).toThrow('append-only')
    expect(()=>sqlite.prepare("UPDATE platform_audit SET actor_name='spoof'").run()).toThrow('append-only')
  })
  it('rejects stale editors atomically, including their audit entry',async()=>{
    const {env,sqlite}=setup()
    await savePlatform(env,claims,'groups',group(),'first')
    await expect(savePlatform(env,claims,'groups',group({name:'Stale'}),'second')).rejects.toMatchObject({code:'PLATFORM_CONFLICT'})
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_groups').get().n).toBe(3)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n).toBe(1)
  })
  it('protects the last owner and prevents self-disable and email reassignment',async()=>{
    const {env,sqlite}=setup()
    await expect(savePlatform(env,claims,'owners',{id:'synthetic-owner',email:claims.email,name:'Demo owner',enabled:false,reason:'Synthetic disable',expectedRevision:0},'self')).rejects.toMatchObject({code:'PLATFORM_SELF_DISABLE'})
    expect(()=>sqlite.prepare('UPDATE platform_owners SET enabled=0').run()).toThrow('at least one')
    expect(()=>sqlite.prepare('DELETE FROM platform_owners').run()).toThrow('at least one')
    await savePlatform(env,claims,'owners',{name:'Synthetic Backup',email:'backup@example.invalid',enabled:true,reason:'Synthetic backup owner',expectedRevision:0},'backup')
    await expect(savePlatform(env,claims,'owners',{id:'synthetic-owner',email:'reassigned@example.invalid',name:'Demo owner',enabled:true,reason:'Synthetic reassignment',expectedRevision:1},'email')).rejects.toMatchObject({status:422})
    sqlite.prepare("UPDATE platform_owners SET enabled=0 WHERE id='synthetic-owner'").run()
    await expect(readPlatform(env,claims)).rejects.toMatchObject({status:403})
    await expect(savePlatform(env,claims,'groups',group(),'revoked')).rejects.toMatchObject({status:403})
  })
  it('keeps new groups in setup until an isolated DB, dealership and group manager exist',async()=>{
    const {env}=setup()
    await expect(savePlatform(env,claims,'groups',group({status:'active'}),'new-active')).rejects.toMatchObject({status:422})
    await expect(savePlatform(env,claims,'groups',group({id:'synthetic-lake',status:'active'}),'unconnected')).rejects.toMatchObject({code:'TENANT_NOT_READY'})
    const suspended=await savePlatform(env,claims,'groups',group({id:groupId,status:'suspended'}),'suspend')
    expect(suspended.saved).toBe(true)
    await expect(assertTenantEnabled({PLATFORM_CONTROL_DB:env.PLATFORM_DB,PLATFORM_TENANT_ID:groupId,INVENTORY_DB:env.TENANT_NORTH_DB})).rejects.toMatchObject({code:'TENANT_ACCESS_SUSPENDED'})
    await savePlatform(env,claims,'groups',group({id:groupId,status:'active',expectedRevision:1}),'resume')
    await expect(assertTenantEnabled({PLATFORM_CONTROL_DB:env.PLATFORM_DB,PLATFORM_TENANT_ID:groupId,INVENTORY_DB:env.TENANT_NORTH_DB})).resolves.toBeUndefined()
  })
  it('validates dealership websites and prevents moving records between groups',async()=>{
    const {env}=setup()
    const dealer={groupId,name:'Synthetic dealership',storeKey:'southside',website:'https://southside.example.invalid',enabled:true,reason:'Synthetic store setup',expectedRevision:0}
    for(const website of ['http://example.invalid','https://user:password@example.invalid','https://example.invalid?token=synthetic']) await expect(savePlatform(env,claims,'dealerships',{...dealer,website},'bad-url')).rejects.toMatchObject({status:422})
    const created=await savePlatform(env,claims,'dealerships',dealer,'dealer')
    await expect(savePlatform(env,claims,'dealerships',{...dealer,id:created.id,groupId:'synthetic-lake',expectedRevision:1},'move')).rejects.toMatchObject({status:422})
    await expect(savePlatform(env,claims,'dealerships',{...dealer,id:created.id,storeKey:'replacement',expectedRevision:1},'key')).rejects.toMatchObject({status:422})
  })
})

describe('Tenant boundaries and monitoring',()=>{
  it('exposes only stored aggregate coverage for the verified tenant and its registered stores',async()=>{
    const {env,tenant}=setup()
    tenant.prepare('UPDATE cloud_release_versions SET metadata_json=?').run(JSON.stringify({vehicleCount:5,publicRowCount:4,
      publicStoreCounts:{northside:4,foreign:90},dealerMailVinReviewStocks:['PRIVATE_STOCK_MARKER'],warnings:['PRIVATE_WARNING_MARKER']}))
    const overview=await readPlatform(env,claims,new Date('2026-10-05T14:00:00Z'))
    expect(overview.groups.find(item=>item.id===groupId).health.coverage).toEqual({basis:'stored_publication',reportDate:'2026-10-05',publishedAt:'2026-10-05T12:00:00Z',counts:{vehicleCount:5,publicRowCount:4},stores:[{storeKey:'northside',publicCount:4}]})
    expect(overview.groups.find(item=>item.id==='synthetic-lake').health.coverage).toBeUndefined()
    expect(JSON.stringify(overview)).not.toContain('PRIVATE_')
    expect(JSON.stringify(overview)).not.toContain('foreign')
    tenant.prepare('UPDATE cloud_release_versions SET metadata_json=?').run('invalid json')
    expect((await readPlatform(env,claims)).groups.find(item=>item.id===groupId).health).toMatchObject({connected:true})
    expect((await readPlatform(env,claims)).groups.find(item=>item.id===groupId).health.coverage).toBeUndefined()
  })
  it('does not read a database with the wrong immutable tenant identity or a client-supplied binding',async()=>{
    const {env}=setup()
    await expect(tenantDatabase({...env,PLATFORM_TENANT_BINDINGS:'{"synthetic-lake":"TENANT_NORTH_DB"}'},'synthetic-lake')).rejects.toMatchObject({code:'TENANT_CONFIGURATION_REQUIRED'})
    await expect(tenantDatabase({...env,PLATFORM_TENANT_BINDINGS:'{"a":"TENANT_NORTH_DB","b":"TENANT_NORTH_DB"}'},'a')).rejects.toMatchObject({status:503})
    await expect(savePlatform(env,claims,'groups',group({databaseBinding:'TENANT_NORTH_DB'}),'spoof')).rejects.toMatchObject({status:422})
    await expect(readTenantMembers(env,claims,'synthetic-lake')).rejects.toMatchObject({code:'TENANT_NOT_CONNECTED'})
  })
  it('reports aggregate health only, isolates an unavailable tenant and marks overdue publication',async()=>{
    const {env,tenant}=setup()
    tenant.exec("CREATE TABLE synthetic_private_marker(customer TEXT); INSERT INTO synthetic_private_marker VALUES('PRIVATE_CUSTOMER_CANARY')")
    const overview=await readPlatform(env,claims,new Date('2026-10-05T14:00:00Z'))
    expect(overview.groups.find(item=>item.id===groupId).health).toMatchObject({status:'current',employees:1,activeEmployees:1,reportDate:'2026-10-05'})
    expect(overview.groups.find(item=>item.id==='synthetic-lake').health.status).toBe('not_connected')
    expect(JSON.stringify(overview)).not.toContain('PRIVATE_CUSTOMER_CANARY')
    expect((await readPlatform(env,claims,new Date('2026-10-07T14:00:00Z'))).groups.find(item=>item.id===groupId).health.status).toBe('stale')
  })
  it('requires complete gate configuration and never lets a request choose a group',async()=>{
    const {env}=setup()
    await expect(assertTenantEnabled({PLATFORM_TENANT_ID:groupId})).rejects.toMatchObject({status:503})
    await expect(assertTenantEnabled({PLATFORM_CONTROL_DB:env.PLATFORM_DB})).rejects.toMatchObject({status:503})
    await expect(assertTenantEnabled({PLATFORM_CONTROL_DB:env.PLATFORM_DB,PLATFORM_TENANT_ID:'synthetic-lake',INVENTORY_DB:env.TENANT_NORTH_DB})).rejects.toMatchObject({status:503})
    await expect(assertTenantEnabled({})).resolves.toBeUndefined()
  })
  it('edits employees only inside their bound group, preserving email, last manager, revision and audit rules',async()=>{
    const {env,tenant}=setup()
    const created=await saveTenantMember(env,claims,groupId,member(),'member')
    expect(await saveTenantMember(env,claims,groupId,member(),'member')).toMatchObject({id:created.id,replayed:true})
    expect((await readTenantMembers(env,claims,groupId)).revision).toBe(1)
    expect(tenant.prepare('SELECT actor_name,actor_user_id FROM cloud_membership_events').get()).toEqual({actor_name:'Demo software owner',actor_user_id:'platform:synthetic-owner'})
    await expect(saveTenantMember(env,claims,groupId,member({id:created.id,email:'changed@example.invalid',expectedRevision:1}),'email')).rejects.toMatchObject({status:422})
    await expect(saveTenantMember(env,claims,groupId,member({id:'other-group-user',expectedRevision:1}),'other')).rejects.toMatchObject({status:404})
    await expect(saveTenantMember(env,claims,groupId,member({email:'next@example.invalid'}),'stale')).rejects.toMatchObject({status:409})
    await expect(saveTenantMember(env,claims,groupId,member({id:'synthetic-manager',email:'manager@example.invalid',role:'sales',expectedRevision:1}),'last')).rejects.toMatchObject({status:409})
    for(const extra of [{role:'software_owner'},{homeStore:'other-group-store'},{actor:'spoof'}]) await expect(saveTenantMember(env,claims,groupId,member(extra),'invalid')).rejects.toMatchObject({status:422})
    expect(tenant.prepare('SELECT COUNT(*) AS n FROM cloud_membership_events').get().n).toBe(1)
  })
  it('keeps two connected databases independent, including when the same sign-in email is used',async()=>{
    const north=setup(),south=createSyntheticPlatformAdmin({groupId:'synthetic-south'});resources.push(south)
    north.sqlite.prepare('INSERT INTO platform_groups VALUES(?,?,?,?,?)').run('synthetic-south','Synthetic South','setup','2026-10-05T12:00:00Z','2026-10-05T12:00:00Z')
    north.sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run('synthetic-south-store','synthetic-south','Synthetic South Ford','northside','')
    const env={...north.env,TENANT_SOUTH_DB:south.env.TENANT_NORTH_DB,PLATFORM_TENANT_BINDINGS:'{"synthetic-north":"TENANT_NORTH_DB","synthetic-south":"TENANT_SOUTH_DB"}'}
    const first=await saveTenantMember(env,claims,groupId,member(),'north-user')
    expect((await readTenantMembers(env,claims,'synthetic-south')).members).not.toContainEqual(expect.objectContaining({id:first.id}))
    await expect(saveTenantMember(env,claims,'synthetic-south',member({id:first.id}),'foreign-id')).rejects.toMatchObject({status:404})
    const second=await saveTenantMember(env,claims,'synthetic-south',member(),'south-user')
    expect(second.id).not.toBe(first.id)
    expect(north.tenant.prepare('SELECT COUNT(*) AS n FROM cloud_membership_events').get().n).toBe(1)
    expect(south.tenant.prepare('SELECT COUNT(*) AS n FROM cloud_membership_events').get().n).toBe(1)
  })
  it('can revoke an existing employee after their dealership stops accepting new assignments',async()=>{
    const {env,sqlite,tenant}=setup()
    const created=await saveTenantMember(env,claims,groupId,member(),'employee')
    sqlite.prepare("UPDATE platform_dealerships SET enabled=0 WHERE store_key='northside'").run()
    await expect(saveTenantMember(env,claims,groupId,member({email:'new@example.invalid',expectedRevision:1}),'new-employee')).rejects.toMatchObject({status:422})
    await saveTenantMember(env,claims,groupId,member({id:created.id,enabled:false,expectedRevision:1}),'revoke')
    expect(tenant.prepare('SELECT enabled FROM cloud_memberships WHERE user_id=?').get(created.id).enabled).toBe(0)
    expect(tenant.prepare('SELECT COUNT(*) AS n FROM cloud_membership_events').get().n).toBe(2)
  })
  it('refuses a membership change when its transaction revision guard is missing',async()=>{
    const {env,tenant}=setup()
    tenant.exec('DELETE FROM cloud_app_revision')
    await expect(saveTenantMember(env,claims,groupId,member(),'missing-revision')).rejects.toMatchObject({status:503})
    expect(tenant.prepare('SELECT COUNT(*) AS n FROM cloud_memberships').get().n).toBe(1)
    expect(tenant.prepare('SELECT COUNT(*) AS n FROM cloud_membership_events').get().n).toBe(0)
  })
  it.each(['/api/v1/inventory','/mcp'])('suspends authenticated integration reads on %s before loading data',async path=>{
    const {env,sqlite}=setup(),loadReadService=vi.fn(),quota=vi.fn(),audit=vi.fn()
    sqlite.prepare("UPDATE platform_groups SET status='suspended' WHERE id='synthetic-north'").run()
    const worker=createIntegrationWorker({authenticate:async()=>({id:'synthetic-client'}),quota,audit,loadReadService})
    const result=await worker.fetch(new Request(`https://integration.example.invalid${path}`,{method:path==='/mcp'?'POST':'GET'}),{INTEGRATIONS_ENABLED:'true',INTEGRATION_HOSTNAME:'integration.example.invalid',INVENTORY_DB:env.TENANT_NORTH_DB,PLATFORM_CONTROL_DB:env.PLATFORM_DB,PLATFORM_TENANT_ID:groupId})
    expect(result.status).toBe(403)
    expect((await result.json()).error.code).toBe('TENANT_ACCESS_SUSPENDED')
    expect(quota).not.toHaveBeenCalled();expect(loadReadService).not.toHaveBeenCalled()
  })
})

describe('Separate platform write-surface contract',()=>{
  const writes=['/groups','/dealerships','/owners',`/groups/${groupId}/members`]
  async function call(env,path,method='GET',body,extra={}) {
    const request=new Request(`https://software.example.invalid/api/platform${path}`,{method,headers:{origin:'https://software.example.invalid','content-type':'application/json','idempotency-key':'synthetic-http',...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})})
    const response=await handlePlatformApi(request,env,claims,new Date('2026-10-05T14:00:00Z'))
    return {status:response.status,body:await response.json(),headers:response.headers}
  }
  it.each(['PUT','PATCH','DELETE'].flatMap(method=>writes.map(path=>[method,path])))('%s %s refuses mutation',async(method,path)=>{
    const {env,sqlite}=setup()
    expect((await call(env,path,method,group())).status).toBe(405)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n).toBe(0)
  })
  it('accepts only the four named POST routes, requires same origin and bounds request size',async()=>{
    const {env,sqlite}=setup()
    for(const path of ['', '/settings', '/groups/other/delete', '/dealermail/holds', '/groups?database=other']) expect([400,404]).toContain((await call(env,path,'POST',group())).status)
    expect((await call(env,'/groups','POST',group(),{origin:'https://untrusted.example.invalid'})).status).toBe(403)
    expect((await call(env,'/groups','POST','x'.repeat(9000))).status).toBe(413)
    const result=await call(env,'/groups','POST',group())
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n).toBe(1)
  })
  it('handles the demo frontend proxy origin without permitting a foreign browser origin',async()=>{
    const fixture=setup()
    const app=startInventoryServer({port:0,releaseLoader:()=>buildSyntheticRelease(),platformAdmin:fixture})
    await new Promise(resolve=>app.server.listening?resolve():app.server.once('listening',resolve))
    const endpoint=`http://127.0.0.1:${app.server.address().port}/api/platform/groups`
    try {
      const headers={'content-type':'application/json','idempotency-key':'synthetic-proxy','origin':'http://127.0.0.1:4173'}
      const first=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(group())})
      expect(first.status).toBe(200)
      expect((await fetch(endpoint,{method:'POST',headers:{...headers,origin:'https://foreign.example.invalid'},body:JSON.stringify(group())})).status).toBe(403)
    } finally {await app.close();resources.splice(resources.indexOf(fixture),1)}
  })
})
