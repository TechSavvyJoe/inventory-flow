// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// Every database is in memory. No workspace, credentials or source files read.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { sqliteD1 } from '../scripts/run-recovery-drill.mjs'
import { handlePlatformApi } from '../cloudflare/src/platform-worker.mjs'

export function createSyntheticPlatformAdmin({groupId='synthetic-north'} = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../cloudflare/platform-migrations/0001_platform.sql',import.meta.url),'utf8'))
  sqlite.prepare('INSERT INTO platform_owners VALUES(?,?,?,1)').run('synthetic-owner','owner@example.invalid','Demo software owner')
  sqlite.prepare('INSERT INTO platform_groups VALUES(?,?,?,?,?)').run(groupId,'Northside Motors','active','2026-10-05T08:00:00Z','2026-10-05T08:00:00Z')
  sqlite.prepare('INSERT INTO platform_groups VALUES(?,?,?,?,?)').run('synthetic-lake','Lakeside Auto Group','setup','2026-10-05T08:00:00Z','2026-10-05T08:00:00Z')
  sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run('synthetic-dealer',groupId,'Northside Ford','northside','https://northside.example.invalid')
  const tenant = new DatabaseSync(':memory:')
  tenant.exec(`CREATE TABLE cloud_memberships(email TEXT PRIMARY KEY COLLATE NOCASE,user_id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,home_store TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT,updated_at TEXT);
    CREATE TABLE cloud_app_revision(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL); INSERT INTO cloud_app_revision VALUES(1,0);
    CREATE TABLE cloud_release_versions(release_id TEXT PRIMARY KEY,report_date TEXT,status TEXT,published_at TEXT);
    CREATE TABLE cloud_release_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);`)
  tenant.exec(readFileSync(new URL('../cloudflare/migrations/0009_membership_admin.sql',import.meta.url),'utf8'))
  tenant.exec(readFileSync(new URL('../cloudflare/tenant-migrations/0001_tenant_identity.sql',import.meta.url),'utf8'))
  tenant.prepare('INSERT INTO inventory_tenant_identity VALUES(1,?)').run(groupId)
  tenant.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled) VALUES(?,?,?,?,?,1)').run('manager@example.invalid','synthetic-manager','Demo group manager','group_manager','northside')
  tenant.prepare("INSERT INTO cloud_release_versions VALUES('synthetic-platform-release','2026-10-05','current','2026-10-05T12:00:00Z')").run()
  tenant.prepare("INSERT INTO cloud_release_state VALUES('current_release_id','synthetic-platform-release','2026-10-05T12:00:00Z')").run()
  const env = {PLATFORM_DB:sqliteD1(sqlite),TENANT_NORTH_DB:sqliteD1(tenant),PLATFORM_TENANT_BINDINGS:JSON.stringify({[groupId]:'TENANT_NORTH_DB'}),PLATFORM_DEMO:true}
  return {
    env,sqlite,tenant,
    fetch: request => handlePlatformApi(request,env,{email:'owner@example.invalid'},new Date('2026-10-05T14:00:00Z')),
    close: () => {sqlite.close();tenant.close()},
  }
}
