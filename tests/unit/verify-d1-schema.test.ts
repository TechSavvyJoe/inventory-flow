// @vitest-environment node
// Every "live" schema here is synthetic: it is built by applying the repository
// migrations (optionally edited) to an in-memory SQLite database and wrapped in
// the JSON envelope Wrangler prints for --json. No D1, network, or real data.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LIVE_SCHEMA_QUERY,
  WRANGLER_D1_MIGRATIONS_TABLE_SQL,
  runCli,
  verifyD1Schema,
  type VerificationReport,
} from '../../scripts/verify-d1-schema.mjs'

const SCRIPT = fileURLToPath(new URL('../../scripts/verify-d1-schema.mjs', import.meta.url))
const MIGRATIONS = fileURLToPath(new URL('../../cloudflare/migrations/', import.meta.url))
const FILES = readdirSync(MIGRATIONS).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(name)).sort()
const DML_FILES = [
  '0002_app_access.sql',
  '0003_transport_assignment_identity.sql',
  '0005_manager_disposition_audit.sql',
  '0010_integration_audit_operations.sql',
  // 0015 rebuilds dispositions and copies their ledger rows before dropping the old table.
  '0015_manual_inventory_controls.sql',
  // 0017 copies legacy manual hold history into the approval-state table rebuild.
  '0017_manual_hold_approval.sql',
]
const insertFor = (file: string) => `INSERT INTO d1_migrations (name) VALUES ('${file}');`

function wranglerJson(results: unknown[]) {
  return JSON.stringify([{ results, success: true, meta: { served_by: 'synthetic', duration: 0.1, changes: 0, rows_read: results.length, rows_written: 0 } }])
}
const ledgerJson = (names: string[]) => wranglerJson(names.map((name) => ({ name })))

interface LiveOptions {
  skip?: string[]
  edit?: Record<string, (sql: string) => string>
  after?: string
  ledgerTable?: boolean
}

/** Apply the repository migrations to an in-memory database and export sqlite_master like Wrangler. */
function syntheticLive({ skip = [], edit = {}, after = '', ledgerTable = false }: LiveOptions = {}) {
  const database = new DatabaseSync(':memory:')
  try {
    // D1 keeps an internal table of its own; the verifier must ignore it.
    database.exec('CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID')
    if (ledgerTable) database.exec(WRANGLER_D1_MIGRATIONS_TABLE_SQL)
    for (const file of FILES) {
      if (skip.includes(file)) continue
      const original = readFileSync(path.join(MIGRATIONS, file), 'utf8')
      const sql = edit[file] ? edit[file](original) : original
      if (edit[file]) expect(sql, `edit of ${file} must change it`).not.toBe(original)
      database.exec(sql)
    }
    if (after) database.exec(after)
    return wranglerJson(database.prepare(LIVE_SCHEMA_QUERY).all())
  } finally {
    database.close()
  }
}

function cli(args: string[], files: Record<string, string>) {
  let stdout = ''
  let stderr = ''
  const code = runCli(args, {
    readFile: (file) => {
      if (!(file in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return files[file]
    },
    stdout: (text) => { stdout += text },
    stderr: (text) => { stderr += text },
  })
  return { code, stdout, stderr }
}

const migrationReport = (report: VerificationReport, prefix: string) => {
  const found = report.migrations.find((migration) => migration.file.startsWith(prefix))
  if (!found) throw new Error(`No migration ${prefix}`)
  return found
}
const statusesExcept = (report: VerificationReport, prefixes: string[]) =>
  new Set(report.migrations.filter((migration) => !prefixes.some((prefix) => migration.file.startsWith(prefix))).map((migration) => migration.status))

describe('read-only D1 schema verifier', () => {
  it('reports every migration APPLIED and exits 0 when the live schema has all of them', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(12)
    const live = syntheticLive()
    const { code, stdout, stderr } = cli(['--live', 'live.json', '--json'], { 'live.json': live })
    expect(stderr).toBe('')
    expect(code).toBe(0)
    const report = JSON.parse(stdout) as VerificationReport
    expect(report.migrations.map((migration) => migration.file)).toEqual(FILES)
    expect(new Set(report.migrations.map((migration) => migration.status))).toEqual(new Set(['APPLIED']))
    expect(report).toMatchObject({ ok: true, exitCode: 0, readOnly: true, extraLiveObjects: [] })
    expect(report.ignoredLiveObjects.map((object) => object.name).sort()).toEqual(['_cf_KV', 'sqlite_sequence'])
    // Each migration's delta is known, including the ALTER-added columns.
    expect(migrationReport(report, '0003').delta.columnsAdded).toEqual([
      'transfer_events.actor_user_id',
      'transfer_events.driver_or_porter_user_id',
      'transfer_requests.transport_assignee_user_id',
    ])
    expect(migrationReport(report, '0012').delta.columnsAdded).toEqual(['attention_events.input_hash'])
    expect(migrationReport(report, '0011').delta.created).toContain('table vehicle_issues')

    const human = cli(['--live', 'live.json'], { 'live.json': live })
    expect(human.code).toBe(0)
    expect(human.stdout).toContain('Result: PASS')
    expect(human.stdout).toMatch(/0012_attention_event_input_hash\.sql\s+APPLIED/)
  })

  it('reports 0011 and 0012 MISSING and never prints ledger SQL for them', () => {
    const live = syntheticLive({ skip: ['0011_vehicle_issues.sql', '0012_attention_event_input_hash.sql'] })
    const { code, stdout } = cli(['--live', 'live.json', '--json', '--print-ledger-sql', '--data-reviewed', DML_FILES.join(',')], { 'live.json': live })
    expect(code).toBe(1)
    const report = JSON.parse(stdout) as VerificationReport
    expect(migrationReport(report, '0011').status).toBe('MISSING')
    expect(migrationReport(report, '0012').status).toBe('MISSING')
    expect(statusesExcept(report, ['0011', '0012'])).toEqual(new Set(['APPLIED']))
    expect(migrationReport(report, '0011').differences.map((difference) => difference.object)).toEqual(expect.arrayContaining([
      'table vehicle_issues', 'table vehicle_issue_events', 'index vehicle_issues_vin_idx', 'trigger vehicle_issue_events_no_delete',
    ]))
    expect(migrationReport(report, '0012').differences).toEqual([
      { object: 'column attention_events.input_hash', result: 'missing', details: [expect.stringContaining('not on live table attention_events')] },
    ])
    const ledgerSql = report.ledgerSql
    expect(ledgerSql?.inserts).toEqual(FILES.filter((file) => !/^001[12]_/.test(file)).map(insertFor))
    expect(ledgerSql?.text).not.toMatch(/VALUES \('001[12]_/)
    expect(ledgerSql?.skipped).toEqual(expect.arrayContaining([
      { file: '0011_vehicle_issues.sql', reason: expect.stringContaining('MISSING') },
      { file: '0012_attention_event_input_hash.sql', reason: expect.stringContaining('MISSING') },
    ]))
  })

  it('reports 0003 PARTIAL when one of its ALTER-added columns is missing', () => {
    const live = syntheticLive({
      edit: { '0003_transport_assignment_identity.sql': (sql) => sql.replace('ALTER TABLE transfer_events ADD COLUMN driver_or_porter_user_id TEXT;\n', '') },
    })
    const report = verifyD1Schema({ liveJson: live, printLedgerSql: true, dataReviewed: DML_FILES })
    const partial = migrationReport(report, '0003')
    expect(partial.status).toBe('PARTIAL')
    expect(partial.facts).toMatchObject({ total: 4, present: 3, missing: 1, different: 0 })
    expect(partial.differences).toEqual([
      { object: 'column transfer_events.driver_or_porter_user_id', result: 'missing', details: [expect.stringContaining('not on live table transfer_events')] },
    ])
    // The columns 0003 adds are attributed to 0003, so 0001's transfer_events still verifies.
    expect(statusesExcept(report, ['0003'])).toEqual(new Set(['APPLIED']))
    expect(report.exitCode).toBe(1)
    expect(report.ledgerSql?.inserts).not.toContain(insertFor('0003_transport_assignment_identity.sql'))
    expect(report.ledgerSql?.inserts).toContain(insertFor('0001_initial.sql'))
  })

  it('reports MODIFIED and each differing index when an index definition changed', () => {
    const live = syntheticLive({
      after: [
        'DROP INDEX transfer_requests_vin_idx;',
        'CREATE INDEX transfer_requests_vin_idx ON transfer_requests(vin);',
        'DROP INDEX home_assignments_one_current;',
        'CREATE UNIQUE INDEX home_assignments_one_current ON home_assignments(vin) WHERE effective_to IS NOT NULL;',
      ].join('\n'),
    })
    const { code, stdout } = cli(['--live', 'live.json', '--print-ledger-sql'], { 'live.json': live })
    expect(code).toBe(1)
    expect(stdout).toMatch(/0001_initial\.sql\s+MODIFIED/)
    expect(stdout).toContain('index transfer_requests_vin_idx')
    expect(stdout).toContain('key columns expected (vin, updated_at DESC), found (vin)')
    expect(stdout).toContain('index home_assignments_one_current')
    expect(stdout).toContain('partial WHERE expected effective_to is null, found effective_to is not null')
    expect(stdout).not.toContain(insertFor('0001_initial.sql'))
    expect(stdout).toContain('-- skipped 0001_initial.sql: MODIFIED')

    const report = verifyD1Schema({ liveJson: live })
    expect(migrationReport(report, '0001').differences.map((difference) => difference.object).sort()).toEqual([
      'index home_assignments_one_current', 'index transfer_requests_vin_idx',
    ])
    expect(statusesExcept(report, ['0001'])).toEqual(new Set(['APPLIED']))
  })

  it('tells a skipped table rebuild (MISSING) from a rebuild with a different CHECK (MODIFIED)', () => {
    const skipped = verifyD1Schema({ liveJson: syntheticLive({ skip: ['0010_integration_audit_operations.sql'] }) })
    const missing = migrationReport(skipped, '0010')
    // Its recreated indexes are identical to 0005/0006's, so they are no evidence that 0010 ran.
    expect(missing.status).toBe('MISSING')
    expect(missing.differences).toEqual([
      { object: 'table integration_access_audit', result: 'missing', details: [expect.stringContaining('definition from before this migration')] },
    ])
    expect(statusesExcept(skipped, ['0010'])).toEqual(new Set(['APPLIED']))

    const narrowed = verifyD1Schema({
      liveJson: syntheticLive({ edit: { '0010_integration_audit_operations.sql': (sql) => sql.replace("'reconciliation_get', ", '') } }),
    })
    const modified = migrationReport(narrowed, '0010')
    expect(modified.status).toBe('MODIFIED')
    expect(modified.differences).toEqual([
      { object: 'table integration_access_audit', result: 'different', details: [expect.stringMatching(/^column operation: definition expected .*reconciliation_get/)] },
    ])
  })

  it('reports live objects and columns that no migration creates', () => {
    const live = syntheticLive({
      after: [
        'CREATE TABLE synthetic_extra (id TEXT PRIMARY KEY, note TEXT);',
        'CREATE INDEX synthetic_extra_note_idx ON synthetic_extra(note);',
        'ALTER TABLE app_state ADD COLUMN synthetic_note TEXT;',
      ].join('\n'),
    })
    const { code, stdout } = cli(['--live', 'live.json'], { 'live.json': live })
    expect(code).toBe(1)
    expect(stdout).toContain('Live objects no migration creates:')
    expect(stdout).toContain('table synthetic_extra')
    const report = verifyD1Schema({ liveJson: live })
    expect(report.extraLiveObjects).toEqual(expect.arrayContaining([
      { type: 'table', name: 'synthetic_extra' }, { type: 'index', name: 'synthetic_extra_note_idx' },
    ]))
    expect(report.extraLiveObjects).toHaveLength(2)
    expect(migrationReport(report, '0001').status).toBe('MODIFIED')
    expect(migrationReport(report, '0001').differences).toEqual([
      { object: 'table app_state', result: 'different', details: ['unexpected column synthetic_note'] },
    ])
  })

  it('recognizes the complete approval rebuild but prints its ledger row only after explicit data review', () => {
    const file = '0017_manual_hold_approval.sql'
    const live = syntheticLive()
    const unattested = verifyD1Schema({ liveJson: live, printLedgerSql: true })
    expect(migrationReport(unattested, '0017')).toMatchObject({
      status: 'APPLIED',
      facts: { total: 4, present: 4, missing: 0, different: 0 },
      schemaIndistinguishable: false,
      dataReviewRequired: true,
      dataReviewReasons: ['INSERT statement'],
      dataReviewAttested: false,
      delta: {
        created: [],
        recreated: [
          'index vehicle_manual_hold_events_vin_idx (definition unchanged)',
          'table vehicle_manual_hold_events',
          'trigger vehicle_manual_hold_events_no_delete (definition unchanged)',
          'trigger vehicle_manual_hold_events_no_update (definition unchanged)',
        ],
        redefined: [], columnsAdded: [], dropped: [],
      },
    })
    expect(unattested.ledgerSql?.inserts).not.toContain(insertFor(file))
    expect(unattested.ledgerSql?.skipped).toContainEqual({ file, reason: expect.stringContaining('DATA_REVIEW_REQUIRED (INSERT statement)') })

    // Attesting to previous data migrations cannot attest to preservation of the hold history.
    const previousReviewed = verifyD1Schema({ liveJson: live, printLedgerSql: true, dataReviewed: DML_FILES.filter((name) => name !== file) })
    expect(previousReviewed.ledgerSql?.inserts).not.toContain(insertFor(file))
    const attested = cli(['--live', 'live.json', '--print-ledger-sql', '--data-reviewed', file], { 'live.json': live })
    expect(attested.code).toBe(0)
    expect(attested.stdout).toContain(insertFor(file))
    expect(attested.stdout).not.toContain(insertFor('0015_manual_inventory_controls.sql'))
  })

  it('reports the legacy manual hold schema as missing approval even when its data review is attested', () => {
    const file = '0017_manual_hold_approval.sql'
    const report = verifyD1Schema({ liveJson: syntheticLive({ skip: [file] }), printLedgerSql: true, dataReviewed: DML_FILES })
    expect(report.exitCode).toBe(1)
    expect(migrationReport(report, '0017')).toMatchObject({
      status: 'MISSING',
      facts: { total: 4, present: 3, missing: 1, different: 0 },
      dataReviewRequired: true,
      dataReviewAttested: true,
      differences: [{ object: 'table vehicle_manual_hold_events', result: 'missing', details: [expect.stringContaining('definition from before this migration')] }],
    })
    expect(statusesExcept(report, ['0017'])).toEqual(new Set(['APPLIED']))
    expect(report.ledgerSql?.inserts).not.toContain(insertFor(file))
    expect(report.ledgerSql?.skipped).toContainEqual({ file, reason: expect.stringContaining('MISSING') })
  })

  it.each([
    ['approval states', (sql: string) => sql.replace("'released', 'rejected', 'cancelled'", "'released', 'cancelled'"), 'table vehicle_manual_hold_events', 'column state: definition expected'],
    ['owner identity requirement', (sql: string) => sql.replace('owner_user_id TEXT NOT NULL', 'owner_user_id TEXT'), 'table vehicle_manual_hold_events', 'column owner_user_id: NOT NULL expected'],
    ['version uniqueness', (sql: string) => sql.replace('UNIQUE (vin, version), ', ''), 'table vehicle_manual_hold_events', 'table constraint missing: unique ( vin , version )'],
    ['idempotency uniqueness', (sql: string) => sql.replace(', UNIQUE (vin, idempotency_key)', ''), 'table vehicle_manual_hold_events', 'table constraint missing: unique ( vin , idempotency_key )'],
    ['VIN index order', (sql: string) => sql.replace('(vin, version DESC);', '(vin, version);'), 'index vehicle_manual_hold_events_vin_idx', 'key columns expected (vin, version DESC), found (vin, version)'],
    ['update trigger', (sql: string) => sql.replace("BEFORE UPDATE ON vehicle_manual_hold_events BEGIN SELECT RAISE(ABORT, 'Manual hold history is append-only'); END;", 'BEFORE UPDATE ON vehicle_manual_hold_events BEGIN SELECT 1; END;'), 'trigger vehicle_manual_hold_events_no_update', 'definition expected'],
    ['delete trigger', (sql: string) => sql.replace("BEFORE DELETE ON vehicle_manual_hold_events BEGIN SELECT RAISE(ABORT, 'Manual hold history is append-only'); END;", 'BEFORE DELETE ON vehicle_manual_hold_events BEGIN SELECT 1; END;'), 'trigger vehicle_manual_hold_events_no_delete', 'definition expected'],
  ])('refuses an approval ledger row when %s differs from the migration', (_label, edit, object, detail) => {
    const file = '0017_manual_hold_approval.sql'
    const report = verifyD1Schema({ liveJson: syntheticLive({ edit: { [file]: edit } }), printLedgerSql: true, dataReviewed: DML_FILES })
    expect(report.exitCode).toBe(1)
    expect(migrationReport(report, '0017').status).toBe('MODIFIED')
    expect(migrationReport(report, '0017').differences).toContainEqual({ object, result: 'different', details: expect.arrayContaining([expect.stringContaining(detail)]) })
    expect(report.ledgerSql?.inserts).not.toContain(insertFor(file))
  })

  it('refuses an approval ledger row when a rebuilt append-only trigger is absent', () => {
    const file = '0017_manual_hold_approval.sql'
    const report = verifyD1Schema({
      liveJson: syntheticLive({ after: 'DROP TRIGGER vehicle_manual_hold_events_no_delete;' }),
      printLedgerSql: true, dataReviewed: DML_FILES,
    })
    expect(migrationReport(report, '0017').status).toBe('PARTIAL')
    expect(migrationReport(report, '0017').differences).toEqual([
      { object: 'trigger vehicle_manual_hold_events_no_delete', result: 'missing', details: ['not in the live schema'] },
    ])
    expect(report.ledgerSql?.inserts).not.toContain(insertFor(file))
  })

  it('requires data review for a migration with no schema delta instead of treating schema presence as data evidence', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'synthetic-d1-data-review-'))
    try {
      writeFileSync(path.join(directory, '0001_initial.sql'), 'CREATE TABLE synthetic_state (id TEXT PRIMARY KEY, state TEXT NOT NULL);')
      const file = '0002_update_state.sql'
      writeFileSync(path.join(directory, file), "UPDATE synthetic_state SET state = 'reviewed';")
      const live = wranglerJson([{ type: 'table', name: 'synthetic_state', tbl_name: 'synthetic_state', sql: 'CREATE TABLE synthetic_state (id TEXT PRIMARY KEY, state TEXT NOT NULL)' }])
      const report = verifyD1Schema({ liveJson: live, migrationsDirectory: directory, printLedgerSql: true })
      expect(migrationReport(report, '0002')).toMatchObject({
        status: 'APPLIED', facts: { total: 0, present: 0, missing: 0, different: 0 },
        schemaIndistinguishable: true, dataReviewRequired: true, dataReviewAttested: false,
        dataReviewReasons: ['UPDATE statement', 'schema is identical before and after this migration'],
      })
      expect(report.ledgerSql?.inserts).toEqual([insertFor('0001_initial.sql')])
      expect(verifyD1Schema({ liveJson: live, migrationsDirectory: directory, printLedgerSql: true, dataReviewed: [file] }).ledgerSql?.inserts)
        .toEqual([insertFor('0001_initial.sql'), insertFor(file)])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('flags INSERT/UPDATE/DELETE migrations and leaves them out of ledger SQL unless attested', () => {
    const live = syntheticLive()
    const unattested = verifyD1Schema({ liveJson: live, printLedgerSql: true })
    expect(unattested.exitCode).toBe(0)
    expect(unattested.migrations.filter((migration) => migration.dataReviewRequired).map((migration) => migration.file)).toEqual(DML_FILES)
    expect(migrationReport(unattested, '0002').dataReviewReasons).toEqual(['INSERT statement'])
    expect(migrationReport(unattested, '0003').dataReviewReasons).toEqual(['UPDATE statement'])
    expect(migrationReport(unattested, '0015').dataReviewReasons).toContain('INSERT statement')
    // 0005 rebuilds the audit table with an identical definition: only data can show it ran.
    expect(migrationReport(unattested, '0005')).toMatchObject({ status: 'APPLIED', schemaIndistinguishable: true })
    expect(migrationReport(unattested, '0009')).toMatchObject({ dataReviewRequired: false, schemaIndistinguishable: false })
    expect(unattested.ledgerSql?.inserts).toEqual(FILES.filter((file) => !DML_FILES.includes(file)).map(insertFor))
    for (const file of DML_FILES) {
      expect(unattested.ledgerSql?.skipped).toContainEqual({ file, reason: expect.stringContaining('DATA_REVIEW_REQUIRED') })
    }

    const { code, stdout } = cli(
      ['--live', 'live.json', '--print-ledger-sql', '--data-reviewed', '0002_app_access.sql,0010_integration_audit_operations.sql'],
      { 'live.json': live },
    )
    expect(code).toBe(0)
    expect(stdout).toContain(insertFor('0002_app_access.sql'))
    expect(stdout).toContain(insertFor('0010_integration_audit_operations.sql'))
    expect(stdout).not.toContain(insertFor('0003_transport_assignment_identity.sql'))
    expect(stdout).not.toContain(insertFor('0005_manager_disposition_audit.sql'))
    expect(stdout).toContain('attested by --data-reviewed')

    const unknown = cli(['--live', 'live.json', '--print-ledger-sql', '--data-reviewed', '0002_app_access'], { 'live.json': live })
    expect(unknown.code).toBe(2)
    expect(unknown.stdout).toBe('')
    const withoutSql = cli(['--live', 'live.json', '--data-reviewed', '0002_app_access.sql'], { 'live.json': live })
    expect(withoutSql.code).toBe(2)
  })

  it('refuses a --data-reviewed attestation for a migration that needs no data review', () => {
    const live = syntheticLive()
    // The operator meant 0010 but typed 0008: nothing is attested and nothing is printed.
    const mistyped = cli(['--live', 'live.json', '--print-ledger-sql', '--data-reviewed', '0008_service_intake.sql'], { 'live.json': live })
    expect(mistyped.code).toBe(2)
    expect(mistyped.stdout).toBe('')
    expect(mistyped.stderr).toContain('fail closed')
    expect(mistyped.stderr).toContain('not DATA_REVIEW_REQUIRED: 0008_service_intake.sql')
    for (const file of DML_FILES) expect(mistyped.stderr).toContain(file)
    // One wrong name among right ones still stops the run.
    expect(() => verifyD1Schema({ liveJson: live, printLedgerSql: true, dataReviewed: ['0010_integration_audit_operations.sql', '0001_initial.sql'] }))
      .toThrow(/not DATA_REVIEW_REQUIRED: 0001_initial\.sql/)
    // Every DATA_REVIEW_REQUIRED file is still accepted.
    expect(verifyD1Schema({ liveJson: live, printLedgerSql: true, dataReviewed: DML_FILES }).ledgerSql?.inserts).toEqual(FILES.map(insertFor))
  })

  it('reads a pre-edit 0004 with 0005 and 0010 never run as three MODIFIED audit-table migrations', () => {
    // 0004's CHECK gained manager_dispositions_list in Git after it was first applied;
    // the runbook tells the operator how to read this result.
    const live = syntheticLive({
      skip: ['0005_manager_disposition_audit.sql', '0010_integration_audit_operations.sql'],
      edit: { '0004_integrations.sql': (sql) => sql.replace("'holds_summary', 'manager_dispositions_list', ", "'holds_summary', ") },
    })
    const report = verifyD1Schema({ liveJson: live })
    for (const prefix of ['0004', '0005', '0010']) {
      const migration = migrationReport(report, prefix)
      expect(migration.status, prefix).toBe('MODIFIED')
      expect(migration.differences.find((difference) => difference.object === 'table integration_access_audit'), prefix).toMatchObject({
        result: 'different',
        details: [expect.stringMatching(/^column operation: definition expected .*manager_dispositions_list/)],
      })
    }
    expect(report.exitCode).toBe(1)

    // With 0005 run on top of the original 0004, only 0010 is MISSING.
    const after0005 = verifyD1Schema({
      liveJson: syntheticLive({
        skip: ['0010_integration_audit_operations.sql'],
        edit: { '0004_integrations.sql': (sql) => sql.replace("'holds_summary', 'manager_dispositions_list', ", "'holds_summary', ") },
      }),
    })
    expect(migrationReport(after0005, '0010').status).toBe('MISSING')
  })

  it('fails closed on malformed or unsuccessful Wrangler JSON', () => {
    const row = { type: 'table', name: 'app_state', tbl_name: 'app_state', sql: 'CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)' }
    const cases: Array<[string, string]> = [
      ['not JSON', 'Error: authentication required'],
      ['a bare object', JSON.stringify({ results: [row], success: true })],
      ['no result set', '[]'],
      ['two result sets', JSON.stringify([{ results: [row], success: true }, { results: [], success: true }])],
      ['an unsuccessful query', JSON.stringify([{ results: [row], success: false }])],
      ['a result set without results', JSON.stringify([{ success: true }])],
      ['a row without sql', wranglerJson([{ type: 'table', name: 'app_state', tbl_name: 'app_state' }])],
      ['a row that is not a CREATE', wranglerJson([{ ...row, sql: 'DROP TABLE app_state' }])],
      ['a row with two statements', wranglerJson([{ ...row, sql: `${row.sql}; DROP TABLE cloud_memberships` }])],
      ['a row whose CREATE names another object', wranglerJson([{ ...row, name: 'cloud_release_state', tbl_name: 'cloud_release_state' }])],
      ['a row with an unknown type', wranglerJson([{ ...row, type: 'module' }])],
      ['unterminated SQL', wranglerJson([{ ...row, sql: "CREATE TABLE app_state (key TEXT DEFAULT 'x)" }])],
    ]
    for (const [label, text] of cases) {
      const result = cli(['--live', 'live.json', '--print-ledger-sql'], { 'live.json': text })
      expect(result.code, label).toBe(2)
      expect(result.stdout, label).toBe('')
      expect(result.stderr, label).toContain('fail closed')
      expect(() => verifyD1Schema({ liveJson: text }), label).toThrow()
    }
    const live = syntheticLive()
    expect(cli(['--live', 'live.json', '--ledger', 'ledger.json'], { 'live.json': live, 'ledger.json': JSON.stringify([{ success: false, results: [] }]) }).code).toBe(2)
    expect(cli(['--live', 'live.json', '--ledger', 'ledger.json'], { 'live.json': live, 'ledger.json': wranglerJson([{ id: 1 }]) }).code).toBe(2)
    expect(cli(['--live', 'absent.json'], {}).code).toBe(2)
    expect(cli([], {}).code).toBe(2)
    expect(cli(['--live', 'live.json', '--write'], { 'live.json': live }).code).toBe(2)
  })

  it('skips ledger SQL for names already recorded and reports ledger anomalies', () => {
    const live = syntheticLive({ ledgerTable: true })
    const recorded = FILES.slice(0, 4)
    const { code, stdout } = cli(
      ['--live', 'live.json', '--ledger', 'ledger.json', '--print-ledger-sql', '--data-reviewed', DML_FILES.join(',')],
      { 'live.json': live, 'ledger.json': ledgerJson(recorded) },
    )
    // A complete schema still needs its complete supplied migration ledger.
    // Backfill SQL remains reviewable, but incomplete tracking is not PASS.
    expect(code).toBe(1)
    expect(stdout).toContain('Migration names missing from the supplied ledger:')
    expect(stdout).toContain("Ledger table in live schema: present and matches Wrangler's definition.")
    expect(stdout.split(WRANGLER_D1_MIGRATIONS_TABLE_SQL)).toHaveLength(2)
    for (const file of recorded) {
      expect(stdout).not.toContain(insertFor(file))
      expect(stdout).toContain(`-- skipped ${file}: already recorded in d1_migrations`)
    }
    for (const file of FILES.slice(4)) expect(stdout).toContain(insertFor(file))

    const complete = verifyD1Schema({ liveJson: live, ledgerJson: ledgerJson(FILES) })
    expect(complete.ok).toBe(true)
    expect(complete.ledger.missing).toEqual([])
    const empty = verifyD1Schema({ liveJson: live, ledgerJson: ledgerJson([]) })
    expect(empty.ok).toBe(false)
    expect(empty.ledger.missing).toEqual(FILES)

    const unexpected = verifyD1Schema({ liveJson: live, ledgerJson: ledgerJson([...recorded, '0099_synthetic_unknown.sql']), printLedgerSql: true })
    expect(unexpected.exitCode).toBe(1)
    expect(unexpected.ledger.unexpected).toEqual(['0099_synthetic_unknown.sql'])
    expect(unexpected.ledgerSql?.inserts).not.toContain(insertFor('0001_initial.sql'))

    const recordedButMissing = verifyD1Schema({
      liveJson: syntheticLive({ ledgerTable: true, skip: ['0012_attention_event_input_hash.sql'] }),
      ledgerJson: ledgerJson(FILES),
    })
    expect(recordedButMissing.ledger.recordedNotApplied).toEqual(['0012_attention_event_input_hash.sql'])
    expect(recordedButMissing.exitCode).toBe(1)

    // A live ledger table without its rows cannot say which INSERTs are new.
    const noRows = cli(['--live', 'live.json', '--print-ledger-sql'], { 'live.json': live })
    expect(noRows.code).toBe(2)
    expect(noRows.stderr).toContain('--ledger')
    // Nor can a plain run check the ledger, so it never reports PASS without the rows,
    // even when the unseen ledger may record a migration that is not APPLIED.
    for (const args of [['--live', 'live.json'], ['--live', 'live.json', '--json']]) {
      const unchecked = cli(args, { 'live.json': syntheticLive({ ledgerTable: true, skip: ['0012_attention_event_input_hash.sql'] }) })
      expect(unchecked.code).toBe(2)
      expect(unchecked.stdout).toBe('')
      expect(unchecked.stderr).toContain('fail closed')
      expect(unchecked.stderr).toContain('pass --ledger')
    }
    expect(() => verifyD1Schema({ liveJson: live })).toThrow(/pass --ledger/)

    // A hand-made ledger table that is not Wrangler's gets no SQL at all.
    const handMade = verifyD1Schema({
      liveJson: syntheticLive({ after: 'CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);' }),
      ledgerJson: ledgerJson([]),
      printLedgerSql: true,
    })
    expect(handMade.ledger.liveTable).toBe('differs')
    expect(handMade.exitCode).toBe(1)
    expect(handMade.ledgerSql?.inserts).toEqual([])
    expect(handMade.ledgerSql?.refused).toContain("differs from Wrangler's definition")
    expect(handMade.ledgerSql?.text).not.toContain('CREATE TABLE')
  })

  it('pins the d1_migrations CREATE statement to the one the installed Wrangler generates', () => {
    expect(WRANGLER_D1_MIGRATIONS_TABLE_SQL).toBe(
      'CREATE TABLE IF NOT EXISTS "d1_migrations"(\n\t\tid         INTEGER PRIMARY KEY AUTOINCREMENT,\n\t\tname       TEXT UNIQUE,\n\t\tapplied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL\n);',
    )
    const wranglerRoot = path.dirname(createRequire(import.meta.url).resolve('wrangler/package.json'))
    const bundle = readFileSync(path.join(wranglerRoot, 'wrangler-dist', 'cli.js'), 'utf8')
    const escapeSource = bundle.match(/function escapeIdentifier\(id\) \{[\s\S]*?\n\}/)?.[0]
    const createSource = bundle.match(/function getCreateMigrationsTableQuery\(migrationsTableName\) \{[\s\S]*?\n\}/)?.[0]
    const defaultTable = bundle.match(/DEFAULT_MIGRATION_TABLE = "([^"]+)"/)?.[1]
    expect(escapeSource && createSource && defaultTable).toBeTruthy()
    const generate = new Function(`${escapeSource}\n${createSource}\nreturn getCreateMigrationsTableQuery`)() as (table: string) => string
    expect(defaultTable).toBe('d1_migrations')
    expect(generate(defaultTable as string)).toBe(WRANGLER_D1_MIGRATIONS_TABLE_SQL)
  })

  it('runs as a command on saved files without touching anything else', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'synthetic-d1-schema-'))
    try {
      const livePath = path.join(directory, 'live.json')
      writeFileSync(livePath, syntheticLive())
      const passed = spawnSync(process.execPath, [SCRIPT, '--live', livePath, '--json'], { encoding: 'utf8' })
      expect(passed.status).toBe(0)
      expect((JSON.parse(passed.stdout) as VerificationReport).ok).toBe(true)
      writeFileSync(livePath, '[{"success":false,"results":[]}]')
      const refused = spawnSync(process.execPath, [SCRIPT, '--live', livePath, '--print-ledger-sql'], { encoding: 'utf8' })
      expect(refused.status).toBe(2)
      expect(refused.stdout).toBe('')
      expect(readdirSync(directory)).toEqual(['live.json'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
