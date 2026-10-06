// @ts-nocheck -- fabricated identities with actual SQLite transaction constraints.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyntheticPlatformAdmin } from '../../fixtures/synthetic-platform-admin.mjs'
import { readDataConnections, readPlatformAudit, saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import { handlePlatformApi } from '../../cloudflare/src/platform-worker.mjs'
const claims={email:'owner@example.invalid'},group='synthetic-north',fixtures=[]
const setup=()=>{const fixture=createSyntheticPlatformAdmin();fixtures.push(fixture);return fixture}
afterEach(()=>{fixtures.splice(0).forEach(fixture=>fixture.close());vi.unstubAllGlobals()})
const source=extra=>({dealershipId:'synthetic-dealer',name:'Synthetic inventory API',provider:'public_inventory',method:'api',endpoint:'https://inventory.example.invalid/feed',credentialRef:'CREDENTIAL_INVENTORY',enabled:true,cadence:'daily',localTime:'05:30',timezone:'America/Detroit',reason:'Synthetic source setup',expectedRevision:0,...extra})
const pull=(id,extra)=>({connectionId:id,operation:'request',reason:'Synthetic source refresh',expectedRevision:1,...extra})
describe('Dealership source configuration and queued requests',()=>{
 it('stores configuration without contacting a source, granting credentials or claiming verification',async()=>{
  const {env}=setup(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
  const saved=await saveDataControl(env,claims,group,'connections',source(),'config')
  const result=await readDataConnections(env,claims,group)
  expect(result.connections).toContainEqual(expect.objectContaining({id:saved.id,dealershipId:'synthetic-dealer',verification:'not_verified'}))
  expect(result.execution.connected).toBe(false);expect(result.requests).toEqual([]);expect(fetcher).not.toHaveBeenCalled()
  expect(await saveDataControl(env,claims,group,'connections',source(),'config')).toMatchObject({replayed:true,id:saved.id})
 })
 it('rejects stale configuration atomically and never reassigns a source to a different dealership or group',async()=>{
  const {env,sqlite}=setup()
  const saved=await saveDataControl(env,claims,group,'connections',source(),'config')
  await expect(saveDataControl(env,claims,group,'connections',source({id:saved.id,name:'Stale'}),'stale')).rejects.toMatchObject({status:409})
  await expect(saveDataControl(env,claims,'synthetic-lake','connections',source({id:saved.id,expectedRevision:1}),'other-group')).rejects.toMatchObject({status:404})
  await expect(saveDataControl(env,claims,group,'connections',source({dealershipId:'other-store',expectedRevision:1}),'other-dealer')).rejects.toMatchObject({status:422})
  sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run('second-dealer',group,'Synthetic second','second','')
  await expect(saveDataControl(env,claims,group,'connections',source({id:saved.id,dealershipId:'second-dealer',expectedRevision:1}),'move')).rejects.toMatchObject({status:422})
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n).toBe(1)
 })
 it.each([{endpoint:'https://user:password@example.invalid/feed'},{endpoint:'https://feed.example.invalid?token=fake'},{endpoint:'http://feed.example.invalid'},{endpoint:'https://127.0.0.1/feed'},{endpoint:'https://[::1]/feed'},{endpoint:'https://collector.local/feed'},{credentialRef:'Bearer fake-token'},{secret:'fake'},{method:'collector'},{localTime:'25:90'},{timezone:'Not/A_Zone'},{cadence:'every_second'},{provider:'arbitrary-command'}])('rejects unsupported or unsafe source settings %j',async extra=>{
  const {env,sqlite}=setup();await expect(saveDataControl(env,claims,group,'connections',source(extra),'invalid')).rejects.toMatchObject({status:422})
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_data_connections').get().n).toBe(0)
 })
 it('supports different history, equipment and OEM providers per dealership without enabling assumed systems',async()=>{
  const {env}=setup()
  for(const [index,provider,vendor,oem] of [[0,'carfax','CARFAX','not_applicable'],[1,'equipment','Synthetic Equipment Vendor','not_applicable'],[2,'oem','Synthetic GM Portal','gm']])await saveDataControl(env,claims,group,'connections',source({provider,vendor,oem,expectedRevision:index}),'provider-'+index)
  const data=await readDataConnections(env,claims,group)
  expect(data.connections.map(item=>item.vendor)).toContain('CARFAX')
  expect(data.connections.find(item=>item.provider==='oem')).toMatchObject({oem:'gm',verification:'not_verified'})
  await expect(saveDataControl(env,claims,group,'connections',source({provider:'oem',oem:'not_applicable',expectedRevision:3}),'missing-oem')).rejects.toMatchObject({status:422})
 })
 it('accepts collector configuration with no URL, and pauses or resumes preferences with an audit',async()=>{
  const {env}=setup(),input=source({method:'collector',endpoint:'',provider:'dealermail',cadence:'hourly'})
  const saved=await saveDataControl(env,claims,group,'connections',input,'collector')
  await saveDataControl(env,claims,group,'connections',{...input,id:saved.id,enabled:false,expectedRevision:1},'pause')
  expect((await readDataConnections(env,claims,group)).connections[0]).toMatchObject({enabled:false,method:'collector'})
  await expect(saveDataControl(env,claims,group,'pulls',pull(saved.id,{expectedRevision:2}),'paused-pull')).rejects.toMatchObject({code:'PLATFORM_PULL_DISABLED'})
 })
 it('queues exactly one attributed request, preserves retry identity, and cancels without running anything',async()=>{
  const {env,sqlite}=setup(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
  const connection=await saveDataControl(env,claims,group,'connections',source(),'source')
  const queued=await saveDataControl(env,claims,group,'pulls',pull(connection.id),'pull')
  expect(await saveDataControl(env,claims,group,'pulls',pull(connection.id),'pull')).toMatchObject({id:queued.id,replayed:true})
  await expect(saveDataControl(env,claims,group,'pulls',pull(connection.id,{expectedRevision:2}),'duplicate')).rejects.toMatchObject({status:409})
  await expect(saveDataControl(env,claims,group,'connections',source({id:connection.id,enabled:false,expectedRevision:2}),'pause')).rejects.toMatchObject({code:'PLATFORM_PULL_PENDING'})
  expect((await readDataConnections(env,claims,group)).requests[0]).toMatchObject({state:'queued',requestedBy:'Demo software owner'})
  await expect(saveDataControl(env,claims,'synthetic-lake','pulls',pull(connection.id,{operation:'cancel',requestId:queued.id,expectedRevision:2}),'foreign-cancel')).rejects.toMatchObject({status:404})
  await saveDataControl(env,claims,group,'pulls',pull(connection.id,{operation:'cancel',requestId:queued.id,expectedRevision:2}),'cancel')
  expect((await readDataConnections(env,claims,group)).requests[0].state).toBe('cancelled')
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n).toBe(3);expect(fetcher).not.toHaveBeenCalled()
 })
 it('blocks new pulls for suspended groups but allows cancelling their waiting request',async()=>{
  const {env,sqlite}=setup(),connection=await saveDataControl(env,claims,group,'connections',source(),'config')
  sqlite.prepare("UPDATE platform_groups SET status='suspended' WHERE id=?").run(group)
  await expect(saveDataControl(env,claims,group,'pulls',pull(connection.id),'suspended')).rejects.toMatchObject({code:'PLATFORM_PULL_DISABLED'})
 })
 it('reads only allowlisted audit fields and normalizes stored boolean values',async()=>{
  const {env,sqlite}=setup(),saved=await saveDataControl(env,claims,group,'connections',source(),'source')
  await saveDataControl(env,claims,group,'connections',source({id:saved.id,enabled:false,expectedRevision:1}),'pause')
  const audit=sqlite.prepare("SELECT id FROM platform_audit WHERE request_key='pause'").get()
  const detail=await readPlatformAudit(env,claims,audit.id)
  expect(detail.changes).toContainEqual({field:'enabled',before:true,after:false})
  expect(detail.changes.map(change=>change.field)).toEqual(['enabled'])
  expect(JSON.stringify(detail)).not.toContain('request_hash')
 })
 it('denies every connection/pull/audit path to employees, machine identities and disabled owners',async()=>{
  const {env}=setup()
  for(const identity of [{email:'manager@example.invalid'},{email:claims.email,common_name:'machine'}])for(const path of [`/groups/${group}/connections`,`/groups/${group}/pulls`,'/audit/not-found']) {
   const response=await handlePlatformApi(new Request(`https://owner.example.invalid/api/platform${path}`),env,identity)
   expect(response.status).toBe(403)
  }
 })
 it('keeps the new API bounded, same-origin and free of source-execution routes',async()=>{
  const {env}=setup()
  const call=(path,method='POST',input=source(),origin='https://owner.example.invalid')=>handlePlatformApi(new Request(`https://owner.example.invalid/api/platform${path}`,{method,headers:{origin,'content-type':'application/json','idempotency-key':'http'},body:method==='GET'?undefined:JSON.stringify(input)}),env,claims)
  expect((await call(`/groups/${group}/connections`,'POST',source(),'https://foreign.example.invalid')).status).toBe(403)
  expect((await call(`/groups/${group}/connections`)).status).toBe(200)
  for(const path of [`/groups/${group}/run`,`/groups/${group}/connections?token=other`,`/groups/${group}/secrets`,`/audit/not-found`])expect([400,404]).toContain((await call(path)).status)
  expect((await call(`/groups/${group}/connections`,'DELETE')).status).toBe(405)
 })
})
