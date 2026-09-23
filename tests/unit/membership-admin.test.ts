// @ts-nocheck -- tests the shared ESM Cloudflare membership transaction.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { readMembershipAdmin, saveMembership } from '../../cloudflare/src/membership-admin.mjs'
import { applySyntheticSchema, sqliteD1 } from '../../scripts/run-recovery-drill.mjs'

const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })
const context = { role: 'group_manager', userId: 'admin', user: 'Ignored client label' }
function harness() {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  applySyntheticSchema(sqlite)
  sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0009_membership_admin.sql', import.meta.url), 'utf8'))
  sqlite.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled) VALUES(?,?,?,?,?,?)').run('admin@example.invalid', 'admin', 'Trusted Admin', 'group_manager', 'Howell', 1)
  return { sqlite, db: sqliteD1(sqlite) }
}
function input(extra = {}) { return { email: 'employee@example.invalid', name: 'New Employee', role: 'sales', homeStore: 'Howell', enabled: true, reason: 'New employee access', expectedRevision: 0, ...extra } }
describe('Membership administration', () => {
  it('creates, edits and disables an employee with immutable ID and server-owned audit actor', async () => {
    const { db, sqlite } = harness()
    const created = await saveMembership(db, input(), context, 'create')
    expect(created.saved).toBe(true)
    const directory = await readMembershipAdmin(db, context)
    expect(directory.members).toHaveLength(2)
    expect(directory.revision).toBe(1)
    expect(directory.audit[0]).toMatchObject({ actor: 'Trusted Admin', targetName: 'New Employee', action: 'created' })
    await saveMembership(db, input({ id: created.id, role: 'manager', homeStore: 'Lincoln', expectedRevision: 1, reason: 'Promoted and moved store' }), context, 'edit')
    await saveMembership(db, input({ id: created.id, role: 'manager', homeStore: 'Lincoln', enabled: false, expectedRevision: 2, reason: 'Employee departed' }), context, 'disable')
    expect(sqlite.prepare('SELECT user_id,role,home_store,enabled FROM cloud_memberships WHERE user_id=?').get(created.id)).toMatchObject({ user_id: created.id, role: 'manager', home_store: 'Lincoln', enabled: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM cloud_membership_events').get().count).toBe(3)
    expect(() => sqlite.prepare("UPDATE cloud_membership_events SET reason='tampered'").run()).toThrow('append-only')
    expect(() => sqlite.prepare('DELETE FROM cloud_membership_events').run()).toThrow('append-only')
  })
  it('makes retries idempotent and rejects a reused key with different data', async () => {
    const { db, sqlite } = harness()
    const first = await saveMembership(db, input(), context, 'same')
    expect(await saveMembership(db, input(), context, 'same')).toMatchObject({ id: first.id, replayed: true })
    await expect(saveMembership(db, input({ name: 'Different' }), context, 'same')).rejects.toMatchObject({ code: 'ADMIN_REQUEST_CONFLICT' })
    expect(sqlite.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(1)
  })
  it('atomically rejects stale changes without creating users or audit records', async () => {
    const { db, sqlite } = harness()
    await saveMembership(db, input(), context, 'first')
    await expect(saveMembership(db, input({ email: 'second@example.invalid' }), context, 'stale')).rejects.toMatchObject({ code: 'ADMIN_CONFLICT' })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM cloud_memberships').get().count).toBe(2)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM cloud_membership_events').get().count).toBe(1)
  })
  it('does not report a conflict when only unrelated app activity advanced the global revision', async () => {
    const { db, sqlite } = harness()
    const directory = await readMembershipAdmin(db, context)
    // A transfer or release commit elsewhere bumps cloud_app_revision while the
    // form is open; the directory itself is unchanged.
    sqlite.prepare('UPDATE cloud_app_revision SET revision=revision+5 WHERE id=1').run()
    const saved = await saveMembership(db, input({ expectedRevision: directory.revision }), context, 'unrelated-activity')
    expect(saved).toMatchObject({ saved: true, replayed: false })
    expect((await readMembershipAdmin(db, context)).revision).toBe(directory.revision + 1)
    expect(sqlite.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(6)
  })
  it('rejects spoofed roles, disabled actors, email reassignment and self-demotion', async () => {
    const { db, sqlite } = harness()
    await expect(saveMembership(db, input(), { ...context, role: 'sales' }, 'denied')).rejects.toMatchObject({ status: 403 })
    await expect(saveMembership(db, input(), { ...context, userId: 'unknown' }, 'denied')).rejects.toMatchObject({ status: 403 })
    await expect(saveMembership(db, input({ id: 'admin', email: 'replacement@example.invalid' }), context, 'email')).rejects.toMatchObject({ code: 'ADMIN_EMAIL_IMMUTABLE' })
    await expect(saveMembership(db, input({ id: 'admin', email: 'admin@example.invalid', enabled: false }), context, 'self')).rejects.toMatchObject({ code: 'ADMIN_SELF_ACCESS_CHANGE' })
    expect(() => sqlite.prepare("UPDATE cloud_memberships SET enabled=0 WHERE user_id='admin'").run()).toThrow('at least one')
    expect(() => sqlite.prepare("DELETE FROM cloud_memberships WHERE user_id='admin'").run()).toThrow('at least one')
    sqlite.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled) VALUES(?,?,?,?,?,?)').run('admin2@example.invalid', 'admin2', 'Other admin', 'group_manager', 'Howell', 1)
    sqlite.prepare("UPDATE cloud_memberships SET enabled=0 WHERE user_id='admin'").run()
    await expect(readMembershipAdmin(db, context)).rejects.toMatchObject({ code: 'ADMIN_ACCESS_CHANGED', status: 403 })
  })
  it('validates roles, stores, reason, boolean status, email and unsupported identity fields', async () => {
    const { db } = harness()
    for (const fields of [{ role: 'owner' }, { homeStore: 'Unknown' }, { enabled: 1 }, { reason: 'x' }, { email: 'invalid' }, { userId: 'spoof' }, { expectedRevision: -1 }]) {
      await expect(saveMembership(db, input(fields), context, 'invalid')).rejects.toMatchObject({ status: 422 })
    }
  })
  it.each(['existing replay', 'competing retry'])('rechecks actor access after a revocation during %s', async (stage) => {
    const { db, sqlite } = harness()
    sqlite.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled) VALUES(?,?,?,?,?,?)').run('backup@example.invalid', 'backup', 'Backup Admin', 'group_manager', 'Howell', 1)
    const revoke = () => sqlite.prepare("UPDATE cloud_memberships SET role='sales' WHERE user_id='admin'").run()
    if (stage === 'existing replay') await saveMembership(db, input(), context, 'same-key')
    const racingDb = {
      prepare(sql) {
        const statement = db.prepare(sql)
        if (stage === 'existing replay' && sql.startsWith('SELECT request_hash,target_user_id')) {
          const first = statement.first.bind(statement)
          statement.first = async () => { const result = await first(); revoke(); return result }
        }
        return statement
      },
      async batch(statements) {
        if (stage === 'competing retry') {
          // The other request commits and revocation wins before this request's
          // transaction checks its revision/actor guard.
          await saveMembership(db, input(), context, 'same-key')
          revoke()
        }
        return db.batch(statements)
      },
    }
    await expect(saveMembership(racingDb, input(), context, 'same-key')).rejects.toMatchObject({ code: 'ADMIN_ACCESS_CHANGED', status: 403 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM cloud_membership_events').get().count).toBe(1)
    expect(sqlite.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(1)
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM cloud_memberships WHERE email='employee@example.invalid'").get().count).toBe(1)
  })
})
