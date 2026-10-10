// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// Every database is in memory. No workspace, credentials or source files read.
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { sqliteD1 } from '../scripts/run-recovery-drill.mjs'
import { handlePlatformApi } from '../cloudflare/src/platform-worker.mjs'

export function createSyntheticPlatformAdmin({groupId='synthetic-north',showcase=false,collectorShowcase=false} = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../cloudflare/platform-migrations/0001_platform.sql',import.meta.url),'utf8'))
  sqlite.exec(readFileSync(new URL('../cloudflare/platform-migrations/0002_data_connections.sql',import.meta.url),'utf8'))
  sqlite.exec(readFileSync(new URL('../cloudflare/platform-migrations/0003_pull_scheduler.sql',import.meta.url),'utf8'))
  sqlite.exec(readFileSync(new URL('../cloudflare/platform-migrations/0004_collector_execution.sql',import.meta.url),'utf8'))
  sqlite.exec(readFileSync(new URL('../cloudflare/platform-migrations/0005_collector_group_serialization.sql',import.meta.url),'utf8'))
  sqlite.prepare('INSERT INTO platform_owners VALUES(?,?,?,1)').run('synthetic-owner','owner@example.invalid','Demo software owner')
  sqlite.prepare('INSERT INTO platform_groups VALUES(?,?,?,?,?)').run(groupId,'Northside Motors','active','2026-10-05T08:00:00Z','2026-10-05T08:00:00Z')
  sqlite.prepare('INSERT INTO platform_groups VALUES(?,?,?,?,?)').run('synthetic-lake','Lakeside Auto Group','setup','2026-10-05T08:00:00Z','2026-10-05T08:00:00Z')
  sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run('synthetic-dealer',groupId,'Northside Ford','northside','https://northside.example.invalid')
  const tenant = new DatabaseSync(':memory:')
  tenant.exec(`CREATE TABLE cloud_memberships(email TEXT PRIMARY KEY COLLATE NOCASE,user_id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,home_store TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT,updated_at TEXT);
    CREATE TABLE cloud_app_revision(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL); INSERT INTO cloud_app_revision VALUES(1,0);
    CREATE TABLE cloud_release_versions(release_id TEXT PRIMARY KEY,report_date TEXT,status TEXT,published_at TEXT,metadata_json TEXT);
    CREATE TABLE cloud_release_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);`)
  tenant.exec(readFileSync(new URL('../cloudflare/migrations/0009_membership_admin.sql',import.meta.url),'utf8'))
  tenant.exec(readFileSync(new URL('../cloudflare/tenant-migrations/0001_tenant_identity.sql',import.meta.url),'utf8'))
  tenant.prepare('INSERT INTO inventory_tenant_identity VALUES(1,?)').run(groupId)
  tenant.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled) VALUES(?,?,?,?,?,1)').run('manager@example.invalid','synthetic-manager','Demo group manager','group_manager','northside')
  tenant.prepare("INSERT INTO cloud_release_versions(release_id,report_date,status,published_at) VALUES('synthetic-platform-release','2026-10-05','current','2026-10-05T12:00:00Z')").run()
  tenant.prepare("INSERT INTO cloud_release_state VALUES('current_release_id','synthetic-platform-release','2026-10-05T12:00:00Z')").run()
  tenant.prepare('UPDATE cloud_release_versions SET metadata_json=?').run(JSON.stringify({vehicleCount:8,publicRowCount:8,dealerMailRowCount:2,dealerMailVinReconciledCount:2,dealerMailVinReviewCount:0,activeInventoryCount:8,resourceRecordCount:8,fordInvoiceRecordCount:6,fordOasisRecordCount:6,warrantyCheckRecordCount:6,warningCount:1,publicStoreCounts:{northside:6,'northside-lincoln':2},crmStoreCounts:{northside:2,'northside-lincoln':0},activeStoreCounts:{northside:6,'northside-lincoln':2}}))
  const env = {PLATFORM_DB:sqliteD1(sqlite),TENANT_NORTH_DB:sqliteD1(tenant),PLATFORM_TENANT_BINDINGS:JSON.stringify({[groupId]:'TENANT_NORTH_DB'}),PLATFORM_DEMO:true}
  const extraTenants=[]
  if(showcase) {
    sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run('synthetic-north-lincoln',groupId,'Northside Lincoln','northside-lincoln','https://lincoln.example.invalid')
    for(const [id,name,role,store] of [['synthetic-sales','Demo salesperson','sales','northside'],['synthetic-service','Demo coordinator','coordinator','northside-lincoln']]) tenant.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled) VALUES(?,?,?,?,?,1)').run(`${id}@example.invalid`,id,name,role,store)
    for(const [id,name,state,binding,store,count,published] of [['synthetic-harbor','Harbor Automotive','active','TENANT_HARBOR_DB','harbor',2,'2026-10-03T12:00:00Z'],['synthetic-redwood','Redwood Auto Group','suspended','TENANT_REDWOOD_DB','redwood',1,'2026-10-05T12:00:00Z']]) {
      const extra=createSyntheticPlatformAdmin({groupId:id});extraTenants.push(extra)
      sqlite.prepare('INSERT INTO platform_groups VALUES(?,?,?,?,?)').run(id,name,state,'2026-10-05T08:00:00Z','2026-10-05T08:00:00Z')
      sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run(`${id}-dealer`,id,`${name} Sales`,store,`https://${store}.example.invalid`)
      extra.tenant.prepare('UPDATE cloud_memberships SET home_store=?').run(store)
      if(count===2)extra.tenant.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled) VALUES(?,?,?,?,?,1)').run('harbor-sales@example.invalid','harbor-sales','Demo Harbor salesperson','sales',store)
      extra.tenant.prepare('UPDATE cloud_release_versions SET published_at=?').run(published)
      env[binding]=extra.env.TENANT_NORTH_DB
    }
    env.PLATFORM_TENANT_BINDINGS=JSON.stringify({[groupId]:'TENANT_NORTH_DB','synthetic-harbor':'TENANT_HARBOR_DB','synthetic-redwood':'TENANT_REDWOOD_DB'})
    for(const [id,name,provider,method,endpoint,cadence] of [['synthetic-public','Public inventory','public_inventory','api','https://northside.example.invalid/inventory/feed','daily'],['synthetic-crm','DealerMail holds','dealermail','collector','','hourly'],['synthetic-vauto','vAuto equipment','vauto','file','https://northside.example.invalid/feeds/equipment.csv','manual']]) sqlite.prepare('INSERT INTO platform_data_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,groupId,'synthetic-dealer',name,provider,provider==='vauto'?'vAuto':provider==='dealermail'?'DealerMail':'Authorized public feed','not_applicable',method,endpoint,'',1,cadence,'05:30','America/Detroit','2026-10-05T08:00:00Z','2026-10-05T08:00:00Z')
    for(const [id,entity,target,reason,next] of [['synthetic-audit-group','groups',groupId,'Synthetic group setup',{name:'Northside Motors',status:'active'}],['synthetic-audit-dealer','dealerships','synthetic-dealer','Synthetic dealership registration',{name:'Northside Ford',enabled:true}],['synthetic-audit-source','connections','synthetic-public','Synthetic API feed configuration',{name:'Public inventory',method:'api',cadence:'daily'}]]) sqlite.prepare('INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'synthetic-owner','Demo software owner',entity,target,'created',reason,null,JSON.stringify(next),id,id,'2026-10-05T10:00:00Z')
  }
  if(collectorShowcase) {
    // Explicit opt-in presentation fixture. Contact is seeded; no provider
    // verification or successful publication is inferred from this record.
    const existing=sqlite.prepare('SELECT id FROM platform_dealerships WHERE group_id=? ORDER BY id').all(groupId)
    for(let i=existing.length;i<4;i++)sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run(`synthetic-collector-dealer-${i}`,groupId,`Synthetic Collector Store ${i+1}`,`collector-store-${i}`,'')
    const dealers=sqlite.prepare('SELECT id,store_key FROM platform_dealerships WHERE group_id=? ORDER BY id').all(groupId)
    const connections=[]
    for(const [i,d] of dealers.entries()){const id=`synthetic-collector-mail-${i}`;connections.push(id);sqlite.prepare('INSERT INTO platform_data_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,groupId,d.id,`DealerMail · ${d.store_key}`,'dealermail','DealerMail','not_applicable','collector','','CREDENTIAL_SYNTHETIC_MAIL',1,'manual','05:30','America/Detroit','2026-10-05T08:00:00Z','2026-10-05T08:00:00Z')}
    // Scope digest uses the same canonical shape as the runtime, computed from
    // entirely fabricated registry values. This is a disabled presentation-only
    // enrollment; its Detroit timezone intentionally does not authorize the
    // installed New York adapter or verify any provider session.
    const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v)
    const scope={groupId,dealerships:dealers.map(d=>({id:d.id,storeKey:d.store_key})),connectionIds:connections,credentialRef:'CREDENTIAL_SYNTHETIC_MAIL'}
    const scopeSha=createHash('sha256').update(canonical(scope)).digest('hex')
    sqlite.prepare('INSERT INTO platform_collectors VALUES(?,?,?,?,?,?,?,?,?,0,1,NULL,?,?,?)').run('synthetic-enrolled-host',groupId,'synthetic-host.access','Synthetic dealership host','dealermail-hold-refresh','1','synthetic-four-store-profile','a'.repeat(64),scopeSha,'2026-10-05T13:59:00Z','2026-10-05T13:59:00Z','2026-10-05T14:00:00Z')
    for(const [i,d] of dealers.entries())sqlite.prepare('INSERT INTO platform_collector_grants VALUES(?,?,?,?)').run('synthetic-enrolled-host',connections[i],d.id,groupId)
  }

  return {
    env,sqlite,tenant,
    fetch: request => handlePlatformApi(request,env,{email:'owner@example.invalid'},new Date('2026-10-05T14:00:00Z')),
    close: () => {sqlite.close();tenant.close();extraTenants.forEach(extra=>extra.close())},
  }
}
