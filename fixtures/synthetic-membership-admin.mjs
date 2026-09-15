// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// In-memory demo adapter: exercises the same transactions as the hosted app.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { readMembershipAdmin, saveMembership } from '../cloudflare/src/membership-admin.mjs'
import { SYNTHETIC_ADMIN_MEMBERS } from './synthetic-admin-directory.mjs'

export function createSyntheticMembershipAdmin() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE cloud_memberships(email TEXT PRIMARY KEY COLLATE NOCASE,user_id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,home_store TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT,updated_at TEXT);
    CREATE TABLE cloud_app_revision(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL); INSERT INTO cloud_app_revision VALUES(1,0);`)
  sqlite.exec(readFileSync(new URL('../cloudflare/migrations/0009_membership_admin.sql', import.meta.url), 'utf8'))
  for (const member of SYNTHETIC_ADMIN_MEMBERS) sqlite.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled) VALUES(?,?,?,?,?,?)').run(`${member.user_id}@example.invalid`, member.user_id, member.name, member.role, member.home_store, member.enabled)
  const db = {
    prepare(sql) {
      const statement = {
        params: [],
        bind(...params) { return { ...statement, params } },
        async first() { return sqlite.prepare(sql).get(...this.params) ?? null },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...this.params) } },
        execute() { return { success: true, results: sqlite.prepare(sql).all(...this.params) } },
      }
      return statement
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE')
      try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const actor = context => ({ ...context, userId: 'synthetic-group-manager' })
  return {
    listMembers: () => sqlite.prepare('SELECT user_id,name,role,home_store,enabled FROM cloud_memberships').all(),
    readMembers: context => readMembershipAdmin(db, actor(context)),
    saveMember: (input, context, key) => saveMembership(db, input, actor(context), key),
    close: () => sqlite.close(),
  }
}
