// @ts-nocheck -- repository-safe encrypted fixture exercises real Worker reads.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it, vi } from 'vitest'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { loadLatestCompletedRelease } from '../../server/importer.mjs'
import { cloudReleaseFrom, encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { appReadiness } from '../../cloudflare/src/worker.mjs'

function encryptedFixture() {
  const fixture=createSyntheticWorkspace()
  try {
    const release=loadLatestCompletedRelease({workspaceRoot:fixture.workspaceRoot,now:new Date('2026-08-30T15:00:00Z')})
    const snapshot=release.dealerMailSnapshot,included=snapshot.completeDealerMailUsedInventory.rows
    const heldVins=new Set(snapshot.vehicles.map(row=>row.mainRow.vin))
    for(const row of included){row.rawCellInnerText=Array(22).fill('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS');row.rawCellControlValues=Array.from({length:22},()=>[]);row.holdStateFromRowClass=heldVins.has(row.vin)?'active_hold':'no_current_hold_found'}
    const excluded=included.filter(row=>!heldVins.has(row.vin)),stores=['Howell','Fowlerville','Ford Detroit','Lincoln']
    const counts=rows=>Object.fromEntries(stores.map(store=>[store,rows.filter(row=>row.storeName===store).length]))
    snapshot.excludeActiveHoldsValidationSet={readOnly:true,rows:excluded,summary:{totalRows:excluded.length,uniqueVinCount:excluded.length,uniqueStockCount:excluded.length,byStore:counts(excluded)}}
    snapshot.completeInventorySetValidation.activeHoldDifferenceRows=included.filter(row=>heldVins.has(row.vin)).map(({vin,stockNumber,storeName,storeCode})=>({vin,stockNumber,storeName,storeCode}))
    snapshot.crmInventoryControlValidation={completeInventoryRowsIncludingHolds:included.length,inventoryRowsExcludingHolds:excluded.length,activeHoldVINsRemovedByExcludeFilter:heldVins.size,excludeFilterRemovedExactlyTheActiveHoldSet:true,includingHoldsByStore:counts(included),excludingHoldsByStore:counts(excluded),lotReadyOnlyRowsIncludingHolds:included.length,lotReadyOnlyVINSetEqualsAllVehiclesVINSet:true}
    for(const held of snapshot.vehicles)for(const detail of held.holdDetailRows)detail.orderRaw=String(detail.holdOrderNumber)
    const key=Buffer.alloc(32,17),envelope=encryptBundle(cloudReleaseFrom(release),key)
    return {key,envelope}
  } finally {fixture.cleanup()}
}

function harness({ issuesEnabled = false } = {}) {
  const {key,envelope}=encryptedFixture(),serialized=JSON.stringify(envelope)
  const first=vi.fn(async()=>({object_key:'synthetic-private-release',bundle_sha256:envelope.bundleSha256}))
  const batch=vi.fn(async statements=>{
    if (statements.length === 1) {
      expect(statements[0].sql).toBe("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('vehicle_issues', 'vehicle_issue_events')")
      return [{success:true,results:issuesEnabled?[{name:'vehicle_issues'},{name:'vehicle_issue_events'}]:[]}]
    }
    expect(statements).toHaveLength(issuesEnabled ? 10 : 8)
    for(const {sql} of statements)expect(sql).toMatch(/^SELECT /)
    return statements.map(({sql})=>({success:true,results:sql.includes('cloud_app_revision')?[{revision:7}]:[]}))
  })
  const get=vi.fn(async key=>{expect(key).toBe('synthetic-private-release');return {size:Buffer.byteLength(serialized),text:async()=>serialized}})
  const env={RELEASE_ENCRYPTION_KEY_BASE64:key.toString('base64'),INVENTORY_DB:{prepare(sql){return {sql,first}},batch},RELEASE_SNAPSHOTS:{get}}
  return {env,first,batch,get}
}

describe('machine-only full app readiness',()=>{
  it.each([false,true])('runs decrypt, source validation, read-only D1 snapshot and real bootstrap, returning only allowed summaries (issue schema %s)',async(issuesEnabled)=>{
    const {env,first,batch,get}=harness({issuesEnabled})
    const result=await appReadiness(env)
    expect(first).toHaveBeenCalledOnce();expect(get).toHaveBeenCalledOnce();expect(batch).toHaveBeenCalledTimes(2)
    expect(Object.keys(result).sort()).toEqual(['bootstrapBytes','bundleSha256','counts','ready','reportDate'])
    const stored = JSON.parse(await (await env.RELEASE_SNAPSHOTS.get('synthetic-private-release')).text())
    expect(result.bundleSha256).toBe(stored.bundleSha256)
    expect(result.ready).toBe(true);expect(result.reportDate).toBe('2026-08-30')
    expect(Object.keys(result.counts).sort()).toEqual(['attention','inventory','managerDispositions','transfers'])
    expect(result.counts.inventory).toBe(8);expect(result.counts.managerDispositions).toBe(0);expect(result.counts.transfers).toBe(0)
    for(const value of Object.values(result.counts))expect(Number.isSafeInteger(value)&&value>=0).toBe(true)
    expect(result.bootstrapBytes).toBeGreaterThan(1000)
    expect(JSON.stringify(result)).not.toMatch(/Synthetic|TESTDATA|customer|reason|cookie|token/i)
  })
  it('fails if the encrypted artifact cannot be read rather than reporting metadata-only readiness',async()=>{
    const {env}=harness();env.RELEASE_SNAPSHOTS.get=async()=>null
    await expect(appReadiness(env)).rejects.toMatchObject({code:'RELEASE_ARTIFACT_UNAVAILABLE'})
  })
  it('fails if the shared ledger cannot be loaded rather than hiding a bootstrap failure',async()=>{
    const {env}=harness();env.INVENTORY_DB.batch=async()=>{throw new Error('Synthetic ledger failure')}
    await expect(appReadiness(env)).rejects.toThrow('Synthetic ledger failure')
  })
})
