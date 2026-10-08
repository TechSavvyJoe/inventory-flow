import { describe, expect, it } from 'vitest'
import type { PlatformConnection, PlatformConnections, PlatformGroup } from './types'
import { buildOemCoverage, OEM_PROFILES, sourceReadiness } from './platformSourceModel'

const group:PlatformGroup={id:'group',name:'Synthetic group',status:'active',updatedAt:'',dealerships:[
 {id:'dealer-ford',groupId:'group',name:'Ford store',storeKey:'ford',website:'',enabled:true},
 {id:'dealer-other',groupId:'group',name:'Other store',storeKey:'other',website:'',enabled:true},
],health:{status:'current',message:'Synthetic',connected:true}}
const connection=(overrides:Partial<PlatformConnection>={}):PlatformConnection=>({id:'ford-source',groupId:'group',dealershipId:'dealer-ford',name:'Factory evidence',provider:'oem',vendor:'Synthetic provider',oem:'ford_lincoln',method:'collector',endpoint:'',credentialRef:'',enabled:true,cadence:'daily',localTime:'05:30',timezone:'America/Detroit',updatedAt:'',verification:'not_verified',schedule:{nextLocal:'2026-10-08 05:30',due:false,checkedAt:null,outcome:null},...overrides})
const data=(overrides:Partial<PlatformConnections>={}):PlatformConnections=>({groupId:'group',revision:1,connections:[],requests:[],scheduler:{enabled:false,lastTick:null,checked:0,queued:0,waiting:0,failed:0},execution:{connected:false,message:'No executor'},...overrides})

describe('platform source planning model',()=>{
 it('covers every named OEM family by actual dealership and counts configured, enabled, and paused sources',()=>{
  const rows=buildOemCoverage(group,[connection(),connection({id:'paused-ford',enabled:false}),connection({id:'gm-source',oem:'gm',dealershipId:'dealer-other'})])
  expect(rows).toHaveLength(Object.keys(OEM_PROFILES).length)
  expect(rows.find(row=>row.oem==='ford_lincoln')).toMatchObject({configured:2,enabled:1,paused:1,noOEMSource:false,dealerships:[{dealershipId:'dealer-ford',configured:2,enabled:1,paused:1,status:'configured'},{dealershipId:'dealer-other',configured:0,status:'missing'}]})
  expect(rows.find(row=>row.oem==='gm')).toMatchObject({configured:1,enabled:1,paused:0,dealerships:[{dealershipId:'dealer-ford',status:'missing'},{dealershipId:'dealer-other',configured:1,status:'configured'}]})
 })

 it('marks absent OEM connections explicitly and does not infer a family from a dealership name',()=>{
  const unrelated=connection({id:'named-ford-but-generic',dealershipId:'dealer-ford',provider:'public_inventory',oem:'not_applicable'})
  const rows=buildOemCoverage(group,[unrelated,connection({id:'unrecognized-oem',oem:'unknown-family'}),connection({id:'foreign-group-source',groupId:'other-group'}),connection({id:'foreign-dealership-source',dealershipId:'other-dealer'})])
  expect(rows.find(row=>row.oem==='ford_lincoln')).toMatchObject({configured:0,enabled:0,paused:0,noOEMSource:true,dealerships:[{status:'missing'},{status:'missing'}]})
  expect(rows.every(row=>row.configured===0)).toBe(true)
 })

 it('keeps saved configuration separate from access, executor, and planner evidence',()=>{
  const item=connection()
  const result=sourceReadiness(item,data({connections:[item]}),group)
  expect(result.checks.find(check=>check.key==='source')).toMatchObject({status:'configured'})
  expect(result.access.status).toBe('unverified')
  expect(result.executor.connected).toBe(false)
  expect(result.planner).toMatchObject({enabled:false,detail:'The planner is not activated.'})
  expect(result).not.toHaveProperty('healthy')
 })

 it('does not require a credential reference for a public source and reports a queued request separately',()=>{
  const item=connection({provider:'public_inventory',oem:'not_applicable',cadence:'manual'})
  const result=sourceReadiness(item,data({requests:[{id:'pull',connectionId:item.id,state:'queued',kind:'manual',requestedBy:'Owner',createdAt:'',updatedAt:''}]}),group)
  expect(result.checks.find(check=>check.key==='queue')).toMatchObject({status:'blocked'})
  expect(result.checks.find(check=>check.key==='source')).toMatchObject({status:'configured'})
  expect(result.checks.find(check=>check.key==='endpoint')).toMatchObject({status:'configured'})
  expect(result.access.status).toBe('unverified')
 })
})
