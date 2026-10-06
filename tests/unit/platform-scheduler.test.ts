// @ts-nocheck -- real SQLite transactions and synthetic source identities.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createSyntheticPlatformAdmin } from '../../fixtures/synthetic-platform-admin.mjs'
import { planScheduledPulls, scheduledSlot, schedulePreview } from '../../cloudflare/src/platform-scheduler.mjs'
import { readDataConnections, saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import worker, { handlePlatformApi } from '../../cloudflare/src/platform-worker.mjs'
const fixtures=[],claims={email:'owner@example.invalid'},group='synthetic-north'
const setup=()=>{const fixture=createSyntheticPlatformAdmin();fixtures.push(fixture);return fixture}
afterEach(()=>{fixtures.splice(0).forEach(fixture=>fixture.close());vi.unstubAllGlobals()})
const add=(sqlite,id,extra={})=>sqlite.prepare('INSERT INTO platform_data_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,extra.group??group,extra.dealer??'synthetic-dealer',`Synthetic ${id}`,'public_inventory','Synthetic vendor','not_applicable','api','https://feed.example.invalid/inventory','',extra.enabled??1,extra.cadence??'daily',extra.time??'05:30',extra.zone??'America/Detroit','2026-10-05T08:00:00Z','2026-10-05T08:00:00Z')
const time=value=>new Date(value)
const enabled=env=>({...env,PLATFORM_SCHEDULER_ENABLED:'true'})
const rows=db=>db.prepare('SELECT * FROM platform_pull_requests ORDER BY id').all()
describe('Daily dealership scheduling',()=>{
 it('does nothing without explicit deployment opt-in, including the default scheduled handler',async()=>{
  const env={PLATFORM_DB:{prepare:()=>{throw new Error('No access expected')}}}
  expect(await planScheduledPulls(env)).toMatchObject({enabled:false,queued:0})
  await worker.scheduled({scheduledTime:Date.now()},env)
 })
 it('waits for local start time, then queues once with a system audit without contacting a source',async()=>{
  const {env,sqlite}=setup();add(sqlite,'north');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
  expect(await planScheduledPulls(enabled(env),time('2026-10-05T09:29:00Z'))).toMatchObject({checked:1,queued:0})
  expect(await planScheduledPulls(enabled(env),time('2026-10-05T09:30:00Z'))).toMatchObject({queued:1,failed:0})
  expect(await planScheduledPulls(enabled(env),time('2026-10-05T09:31:00Z'))).toMatchObject({queued:0,failed:0})
  expect(rows(sqlite)).toHaveLength(1)
  expect(rows(sqlite)[0]).toMatchObject({request_kind:'scheduled',requested_by:null,state:'queued',schedule_slot:'daily:America/Detroit:2026-10-05T05:30'})
  expect(sqlite.prepare('SELECT actor_id FROM platform_audit').get()).toMatchObject({actor_id:'system:scheduler'})
  expect(sqlite.prepare('SELECT revision FROM platform_revision').get().revision).toBe(1)
  expect(fetcher).not.toHaveBeenCalled()
  const data=await readDataConnections(enabled(env),claims,group,time('2026-10-05T09:31:00Z'))
  expect(data.scheduler).toMatchObject({enabled:true,lastTick:'2026-10-05T09:31:00.000Z',failed:0})
  expect(data.execution.connected).toBe(false)
  expect(data.connections[0].schedule).toMatchObject({nextLocal:'2026-10-06 05:30',outcome:'already_planned'})
 })
 it('keeps dealership/group/timezone routing separate and skips suspended, setup and paused sources',async()=>{
  const {env,sqlite}=setup()
  sqlite.prepare('INSERT INTO platform_groups VALUES(?,?,?,?,?)').run('west','Synthetic West','active','2026-10-05','2026-10-05')
  sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run('west-dealer','west','Synthetic west dealer','west','')
  sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run('lake-dealer','synthetic-lake','Synthetic setup dealer','lake','')
  add(sqlite,'north');add(sqlite,'west',{group:'west',dealer:'west-dealer',zone:'America/Los_Angeles'})
  add(sqlite,'setup',{group:'synthetic-lake',dealer:'lake-dealer'});add(sqlite,'paused',{enabled:0})
  expect(await planScheduledPulls(enabled(env),time('2026-10-05T09:30:00Z'))).toMatchObject({checked:2,queued:1})
  expect(rows(sqlite)[0].group_id).toBe(group)
  expect(await planScheduledPulls(enabled(env),time('2026-10-05T12:30:00Z'))).toMatchObject({queued:1})
  expect(rows(sqlite).find(row=>row.connection_id==='west').group_id).toBe('west')
  sqlite.prepare("UPDATE platform_groups SET status='suspended' WHERE id='west'").run()
  expect(await planScheduledPulls(enabled(env),time('2026-10-06T12:30:00Z'))).toMatchObject({checked:1,queued:0,waiting:1})
 })
 it('deduplicates concurrent ticks atomically with one audit and revision',async()=>{
  const {env,sqlite}=setup();add(sqlite,'north')
  const results=await Promise.all([planScheduledPulls(enabled(env),time('2026-10-05T09:30:00Z')),planScheduledPulls(enabled(env),time('2026-10-05T09:30:00Z'))])
  expect(results.reduce((n,result)=>n+result.queued,0)).toBe(1)
  expect(rows(sqlite)).toHaveLength(1)
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n).toBe(1)
  expect(sqlite.prepare('SELECT revision FROM platform_revision').get().revision).toBe(1)
 })
 it('cancellation stays cancelled for the same slot; next day gets a new request',async()=>{
  const {env,sqlite}=setup();add(sqlite,'north')
  await planScheduledPulls(enabled(env),time('2026-10-05T09:30:00Z'))
  await saveDataControl(env,claims,group,'pulls',{connectionId:'north',requestId:rows(sqlite)[0].id,operation:'cancel',reason:'Synthetic cancellation',expectedRevision:1},'cancel')
  expect(await planScheduledPulls(enabled(env),time('2026-10-05T09:40:00Z'))).toMatchObject({queued:0,waiting:0})
  expect(await planScheduledPulls(enabled(env),time('2026-10-06T09:30:00Z'))).toMatchObject({queued:1})
  expect(rows(sqlite).map(row=>row.state).sort()).toEqual(['cancelled','queued'])
 })
 it('bounds a stalled source queue while continuing other sources fairly across batches',async()=>{
  const {env,sqlite}=setup();for(const id of ['a','b','c'])add(sqlite,id)
  const limited={...enabled(env),PLATFORM_SCHEDULER_BATCH_SIZE:'1'}
  for(const minute of [30,31,32])expect(await planScheduledPulls(limited,time(`2026-10-05T09:${minute}:00Z`))).toMatchObject({checked:1,queued:1})
  expect(rows(sqlite)).toHaveLength(3)
  const result=await planScheduledPulls(limited,time('2026-10-06T09:30:00Z'))
  expect(result).toMatchObject({checked:1,queued:0,waiting:1})
  expect(rows(sqlite)).toHaveLength(3)
 })
 it('does not starve valid sources behind malformed schedule data',async()=>{
  const {env,sqlite}=setup();add(sqlite,'a-broken',{zone:'No/SuchZone'});add(sqlite,'b-valid')
  const limited={...enabled(env),PLATFORM_SCHEDULER_BATCH_SIZE:'1'}
  expect(await planScheduledPulls(limited,time('2026-10-05T09:30:00Z'))).toMatchObject({failed:1,queued:0})
  expect(await planScheduledPulls(limited,time('2026-10-05T09:31:00Z'))).toMatchObject({failed:0,queued:1})
  expect((await readDataConnections(env,claims,group)).connections.find(item=>item.id==='a-broken').schedule).toMatchObject({invalid:true,outcome:'invalid'})
 })
 it('rechecks suspension and configuration changes between scan and enqueue',async()=>{
  const {env,sqlite}=setup();add(sqlite,'north')
  const prepare=env.PLATFORM_DB.prepare.bind(env.PLATFORM_DB)
  env.PLATFORM_DB.prepare=sql=>{
   const statement=prepare(sql)
   if(sql.startsWith('SELECT c.*')){
    const all=statement.all.bind(statement)
    statement.all=async()=>{const result=await all();sqlite.prepare("UPDATE platform_groups SET status='suspended' WHERE id=?").run(group);return result}
   }
   return statement
  }
  expect(await planScheduledPulls(enabled(env),time('2026-10-05T09:30:00Z'))).toMatchObject({queued:0,failed:0})
  expect(rows(sqlite)).toEqual([])
  expect(sqlite.prepare('SELECT revision FROM platform_revision').get().revision).toBe(0)
 })
 it('refuses caller-controlled HTTP scheduler/execution routes',async()=>{
  const {env}=setup()
  for(const path of ['scheduler','run','tick','dispatch'])expect((await handlePlatformApi(new Request(`https://owner.example.invalid/api/platform/${path}`,{method:'POST',headers:{origin:'https://owner.example.invalid','content-type':'application/json'},body:'{}'}),enabled(env),claims)).status).toBe(404)
 })
 it.each(['0','101','not-a-number'])('rejects invalid batch size %s without writing',async size=>{
  const {env,sqlite}=setup();add(sqlite,'north')
  await expect(planScheduledPulls({...enabled(env),PLATFORM_SCHEDULER_BATCH_SIZE:size})).rejects.toThrow('INVALID_SCHEDULER_CONFIGURATION')
  expect(rows(sqlite)).toEqual([])
 })
 it('preserves existing attributed manual requests when applying the scheduler migration',()=>{
  const db=new DatabaseSync(':memory:')
  try{
   for(const file of ['0001_platform.sql','0002_data_connections.sql'])db.exec(readFileSync(new URL(`../../cloudflare/platform-migrations/${file}`,import.meta.url),'utf8'))
   db.prepare('INSERT INTO platform_owners VALUES(?,?,?,1)').run('owner','owner@example.invalid','Demo owner')
   db.prepare('INSERT INTO platform_groups VALUES(?,?,?,?,?)').run(group,'Synthetic group','active','2026-10-05','2026-10-05')
   db.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run('synthetic-dealer',group,'Demo dealer','demo','')
   add(db,'north')
   db.prepare("INSERT INTO platform_pull_requests VALUES(?,?,?,'queued',?,?,?,?)").run('manual',group,'north','owner','Demo owner','2026-10-05','2026-10-05')
   db.exec(readFileSync(new URL('../../cloudflare/platform-migrations/0003_pull_scheduler.sql',import.meta.url),'utf8'))
   expect(rows(db)[0]).toMatchObject({id:'manual',request_kind:'manual',requested_by:'owner',requested_name:'Demo owner',schedule_slot:''})
   expect(()=>db.prepare("INSERT INTO platform_pull_requests VALUES(?,?,?,'queued','scheduled',NULL,'Scheduler',?,?,?)").run('duplicate',group,'north','slot','2026-10-05','2026-10-05')).toThrow()
  }finally{db.close()}
 })
})
describe('Wall-clock schedules and daylight saving time',()=>{
 const daily={cadence:'daily',localTime:'02:30',timezone:'America/Detroit'}
 it('catches a spring-forward missing time at the first later tick',()=>{
  expect(scheduledSlot(daily,time('2026-03-08T06:59:00Z')).due).toBe(false)
  expect(scheduledSlot(daily,time('2026-03-08T07:00:00Z'))).toMatchObject({due:true,key:'daily:America/Detroit:2026-03-08T02:30'})
 })
 it('uses one identity for both occurrences of a fall-back hour',()=>{
  const hourly={...daily,cadence:'hourly',localTime:'00:30'}
  expect(scheduledSlot(hourly,time('2026-11-01T05:40:00Z')).key).toBe(scheduledSlot(hourly,time('2026-11-01T06:40:00Z')).key)
 })
 it('uses only the latest hourly slot after a missed interval, and starts again next local day',()=>{
  const source={cadence:'hourly',localTime:'05:30',timezone:'America/Detroit'}
  expect(scheduledSlot(source,time('2026-10-05T11:45:00Z'))).toMatchObject({time:'07:30',due:true})
  const last=scheduledSlot(source,time('2026-10-06T03:45:00Z')).key
  expect(schedulePreview(source,time('2026-10-06T03:45:00Z'),last)).toMatchObject({nextLocal:'2026-10-06 05:30',due:false})
 })
 it('handles local dates beyond UTC date and non-hour timezone offsets',()=>{
  expect(scheduledSlot({cadence:'daily',localTime:'00:15',timezone:'Pacific/Auckland'},time('2026-10-05T12:00:00Z')).date).toBe('2026-10-06')
  expect(scheduledSlot({cadence:'daily',localTime:'05:30',timezone:'Asia/Kolkata'},time('2026-10-05T00:00:00Z')).due).toBe(true)
  expect(schedulePreview({cadence:'manual'},new Date())).toBe(null)
 })
})
