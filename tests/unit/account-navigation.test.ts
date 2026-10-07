// @vitest-environment node
// @ts-nocheck -- plain ESM with the real synthetic D1/SQLite fixture.
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, describe, expect, it } from 'vitest'
import { createSyntheticPlatformAdmin } from '../../fixtures/synthetic-platform-admin.mjs'
import { dealershipAppUrl, softwareAdminUrl } from '../../cloudflare/src/account-navigation.mjs'
import { readPlatform } from '../../cloudflare/src/platform-admin.mjs'
import { createCloudWorkerHarness } from './cloudWorkerHarness'
const resources=[]
afterEach(()=>resources.splice(0).forEach(fixture=>fixture.close()))
function setup(){const fixture=createSyntheticPlatformAdmin();resources.push(fixture);return fixture}
const claims={email:'owner@example.invalid'}

describe('Separate account navigation',()=>{
  it('revalidates the actual bootstrap when software ownership changes without changing employee access',async()=>{
    const fixture=setup()
    const cloud=await createCloudWorkerHarness([{email:claims.email,userId:'synthetic-employee-owner',name:'Synthetic owner employee',role:'sales',store:'Howell'}])
    resources.push(cloud)
    cloud.database.exec("CREATE TABLE inventory_tenant_identity(singleton INTEGER PRIMARY KEY,group_id TEXT); INSERT INTO inventory_tenant_identity VALUES(1,'synthetic-north')")
    Object.assign(cloud.env,{PLATFORM_CONTROL_DB:fixture.env.PLATFORM_DB,PLATFORM_TENANT_ID:'synthetic-north',SOFTWARE_ADMIN_HOSTNAME:'owner.example.com'})
    const first=await cloud.call('GET','/api/bootstrap',claims.email)
    expect(first.status).toBe(200)
    expect(first.json.access.softwareAdminUrl).toBe('https://owner.example.com/platform')
    const etag=first.headers.get('etag')
    expect(etag).toBeTruthy()
    expect((await cloud.call('GET','/api/bootstrap',claims.email,undefined,{'if-none-match':etag})).status).toBe(304)
    fixture.sqlite.prepare('INSERT INTO platform_owners VALUES(?,?,?,1)').run('synthetic-backup','backup@example.invalid','Synthetic backup')
    fixture.sqlite.prepare("UPDATE platform_owners SET enabled=0 WHERE id='synthetic-owner'").run()
    const revoked=await cloud.call('GET','/api/bootstrap',claims.email,undefined,{'if-none-match':etag})
    expect(revoked.status).toBe(200)
    expect(revoked.json.access).toMatchObject({softwareAdminUrl:null,authenticatedRole:'sales'})
    expect(revoked.headers.get('etag')).not.toBe(etag)
    expect((await cloud.call('GET','/api/health',claims.email)).status).toBe(200)
  })
  it('resolves only the freshly enabled owner, independent of role and preview claims',async()=>{
    const {env,sqlite}=setup()
    const configured={PLATFORM_CONTROL_DB:env.PLATFORM_DB,SOFTWARE_ADMIN_HOSTNAME:'owner.example.invalid'}
    expect(await softwareAdminUrl(configured,{...claims,role:'sales'})).toBe('https://owner.example.invalid/platform')
    expect(await softwareAdminUrl(configured,{email:'manager@example.invalid',role:'software_owner'})).toBeNull()
    expect(await softwareAdminUrl(configured,{...claims,common_name:'synthetic-publisher'})).toBeNull()
    sqlite.prepare('INSERT INTO platform_owners VALUES(?,?,?,1)').run('synthetic-backup','backup@example.invalid','Synthetic backup')
    sqlite.prepare("UPDATE platform_owners SET enabled=0 WHERE id='synthetic-owner'").run()
    expect(await softwareAdminUrl(configured,claims)).toBeNull()
  })
  it.each(['localhost','127.0.0.1','[::1]','example.local','example.internal','https://owner.example.invalid','owner.example.invalid:443','user@owner.example.invalid','owner.example.invalid/path','owner.example.invalid?token=synthetic','owner.example.invalid#fragment',' owner.example.invalid'])('hides malformed or private deployment host %s',async hostname=>{
    const {env}=setup()
    expect(await softwareAdminUrl({PLATFORM_CONTROL_DB:env.PLATFORM_DB,SOFTWARE_ADMIN_HOSTNAME:hostname},claims)).toBeNull()
    expect(dealershipAppUrl({PLATFORM_TENANT_APP_HOSTNAMES:JSON.stringify({'synthetic-north':hostname})},'synthetic-north')).toBeNull()
  })
  it('hides optional navigation when its database is absent or unavailable',async()=>{
    expect(await softwareAdminUrl({SOFTWARE_ADMIN_HOSTNAME:'owner.example.invalid'},claims)).toBeNull()
    expect(await softwareAdminUrl({SOFTWARE_ADMIN_HOSTNAME:'owner.example.invalid',PLATFORM_CONTROL_DB:{prepare(){throw new Error('Synthetic unavailable')}}},claims)).toBeNull()
  })
  it('shows a return link only for an active account with a matching tenant identity',async()=>{
    const {env,sqlite}=setup()
    const configured={...env,PLATFORM_TENANT_APP_HOSTNAMES:JSON.stringify({'synthetic-north':'inventory.example.invalid','synthetic-lake':'lake.example.invalid'})}
    let overview=await readPlatform(configured,claims)
    expect(overview.groups.find(group=>group.id==='synthetic-north').appUrl).toBe('https://inventory.example.invalid/inventory')
    expect(overview.groups.find(group=>group.id==='synthetic-lake').appUrl).toBeNull()
    sqlite.prepare("UPDATE platform_groups SET status='suspended' WHERE id='synthetic-north'").run()
    overview=await readPlatform(configured,claims)
    expect(overview.groups.find(group=>group.id==='synthetic-north').appUrl).toBeNull()
    expect(dealershipAppUrl({PLATFORM_TENANT_APP_HOSTNAMES:'[]'},'synthetic-north')).toBeNull()
    expect(dealershipAppUrl({PLATFORM_TENANT_APP_HOSTNAMES:'invalid'},'synthetic-north')).toBeNull()
    expect(dealershipAppUrl(configured,'unknown')).toBeNull()
  })
})
