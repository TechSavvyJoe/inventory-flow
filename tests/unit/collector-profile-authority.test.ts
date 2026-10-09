// @ts-nocheck -- hashes the synthetic, installed collector authority profile.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { STORE_CONFIG } from '../../server/importer.mjs'
import { profileFingerprint } from '../../scripts/lib/collector-profile.mjs'

const roots=[]
function profileFixture() {
  const workspaceRoot=mkdtempSync(path.join(os.tmpdir(),'collector-profile-authority-'))
  roots.push(workspaceRoot)
  const files={
    'apps/inventory-ops/scripts/capture-dealermail.mjs':'// synthetic capture\n',
    'work/build_v2_snapshot.mjs':'// synthetic builder\n',
    'work/finalize_cloud_snapshot.mjs':'// synthetic finalizer\n',
  }
  for(const relative of ['work/run-status','work/app-feed-status','outputs','apps/inventory-ops'])mkdirSync(path.join(workspaceRoot,relative),{recursive:true})
  const dependencyHashes={}
  const keys={
    'apps/inventory-ops/scripts/capture-dealermail.mjs':'dealermailCapture',
    'work/build_v2_snapshot.mjs':'snapshotBuilder',
    'work/finalize_cloud_snapshot.mjs':'snapshotFinalizer',
  }
  for(const [relative,source] of Object.entries(files)){
    const target=path.join(workspaceRoot,relative);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,source)
    dependencyHashes[keys[relative]]=createHash('sha256').update(source).digest('hex')
  }
  const storeKeys={Howell:'howell',Fowlerville:'fowlerville','Ford Detroit':'ford-detroit',Lincoln:'lincoln'}
  const stores=Object.entries(STORE_CONFIG).map(([name,value])=>({dealerMailId:value.dealerMailId,storeKey:storeKeys[name],dealershipId:`${name}-dealer`,connectionId:`${name}-connection`}))
  return {schemaVersion:1,adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-profile',groupId:'synthetic-group',source:'dealermail',stores,controlPlaneOrigin:'https://inventory-admin-staging.joegallant.me',credentialRef:'CREDENTIAL_SYNTHETIC_MAIL',releaseKeyRef:'synthetic-release-key',workspaceRoot,dependencyHashes}
}

afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})))

describe('collector profile authority fingerprint',()=>{
  it.each([
    ['controlPlaneOrigin','https://inventory-admin.joegallant.me'],
    ['credentialRef','CREDENTIAL_SYNTHETIC_OTHER'],
    ['releaseKeyRef','synthetic-other-release-key'],
  ])('binds %s into the profile fingerprint',(_key)=>{
    const profile=profileFixture(),original=profileFingerprint(profile)
    const changed={...profile,[ _key ]:_key==='controlPlaneOrigin'?'https://inventory-admin.joegallant.me':_key==='credentialRef'?'CREDENTIAL_SYNTHETIC_OTHER':'synthetic-other-release-key'}
    expect(profileFingerprint(changed)).not.toBe(original)
  })

  it('binds every enrolled connection ID into the profile fingerprint',()=>{
    const profile=profileFixture(),original=profileFingerprint(profile)
    const changed={...profile,stores:profile.stores.map((store,index)=>index===0?{...store,connectionId:'replacement-connection'}:store)}
    expect(profileFingerprint(changed)).not.toBe(original)
  })
})
