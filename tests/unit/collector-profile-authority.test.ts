// @ts-nocheck -- hashes the synthetic, installed collector authority profile.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { STORE_CONFIG } from '../../server/importer.mjs'
import { profileFingerprint, validateCollectorProfile } from '../../scripts/lib/collector-profile.mjs'

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

function profileAtCopiedWorkspace(profile) {
  const workspaceRoot=mkdtempSync(path.join(os.tmpdir(),'collector-profile-authority-copy-'))
  roots.push(workspaceRoot)
  for(const relative of ['work/run-status','work/app-feed-status','outputs','apps/inventory-ops'])mkdirSync(path.join(workspaceRoot,relative),{recursive:true})
  for(const relative of ['apps/inventory-ops/scripts/capture-dealermail.mjs','work/build_v2_snapshot.mjs','work/finalize_cloud_snapshot.mjs']){
    const target=path.join(workspaceRoot,relative);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(profile.workspaceRoot,relative),target)
  }
  return {...profile,workspaceRoot}
}

afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})))

describe('collector profile authority fingerprint',()=>{
  it('rejects the enrolled fingerprint when the installed child admission bootstrap bytes change',async()=>{
    const profile=profileFixture(),bridgeRoot=mkdtempSync(path.join(os.tmpdir(),'collector-bootstrap-authority-'))
    roots.push(bridgeRoot)
    // A synthetic installation copy permits real byte drift without editing
    // the shared checkout or racing another collector test's fingerprint.
    for(const relative of [
      'scripts/collector-host.mjs','scripts/lib/collector-profile.mjs','scripts/lib/collector-protocol.mjs',
      'scripts/lib/dealermail-hold-refresh-adapter.mjs','scripts/lib/collector-child-bootstrap.mjs','scripts/lib/cdp.mjs',
      'scripts/run-inventory-flow-daily.mjs','scripts/publish-cloud-release.mjs','scripts/sync-cloud-release.mjs',
      'cloudflare/src/release-validation.mjs',
    ]){
      const target=path.join(bridgeRoot,relative);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.resolve(relative),target)
    }
    mkdirSync(path.join(bridgeRoot,'server'),{recursive:true})
    writeFileSync(path.join(bridgeRoot,'server/importer.mjs'),`export const STORE_CONFIG=${JSON.stringify(STORE_CONFIG)};\n`)
    const moduleUrl=pathToFileURL(path.join(bridgeRoot,'scripts/lib/collector-profile.mjs')).href
    const installed=await import(`${moduleUrl}?before-bootstrap-change`)
    const recorded={...profile,profileSha256:installed.profileFingerprint(profile)}
    expect(installed.validateCollectorProfile(recorded).profileSha256).toBe(recorded.profileSha256)
    appendFileSync(path.join(bridgeRoot,'scripts/lib/collector-child-bootstrap.mjs'),'\n// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS: changed admission bytes\n')
    expect(installed.profileFingerprint(profile)).not.toBe(recorded.profileSha256)
    expect(()=>installed.validateCollectorProfile(recorded)).toThrow('PROFILE_HASH_MISMATCH')
    const changed=await import(`${moduleUrl}?after-bootstrap-change`)
    expect(changed.profileFingerprint(profile)).not.toBe(recorded.profileSha256)
    expect(()=>changed.validateCollectorProfile(recorded)).toThrow('PROFILE_HASH_MISMATCH')
  })

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

  it('binds the absolute workspace root even when dependency source is identical',()=>{
    const profile=profileFixture(),copied=profileAtCopiedWorkspace(profile)
    expect(profileFingerprint(copied)).not.toBe(profileFingerprint(profile))
  })

  it('rejects a recorded fingerprint when the profile workspace root changes',()=>{
    const profile=profileFixture(),recorded={...profile,profileSha256:profileFingerprint(profile)}
    expect(()=>validateCollectorProfile(profileAtCopiedWorkspace(recorded))).toThrow('PROFILE_HASH_MISMATCH')
  })
})
