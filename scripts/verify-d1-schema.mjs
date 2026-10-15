// Read-only D1 schema verifier for the "D1 Migration Ledger Backfill" in
// docs/CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md.
//
// The operator produces the inputs with read-only Wrangler SELECT queries and
// passes the saved JSON files here. This script reads only those files and the
// repository's cloudflare/migrations/*.sql, opens only in-memory SQLite
// databases, and never contacts the network, runs Wrangler, or writes to D1 or
// disk. --print-ledger-sql prints statements for human review; it executes
// nothing.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { isMainModule } from './lib/is-main.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
export const MIGRATIONS_DIRECTORY = path.join(root, 'cloudflare', 'migrations')
const TENANT_IDENTITY_DDL = path.join(root, 'cloudflare', 'tenant-migrations', '0001_tenant_identity.sql')
const TENANT_IDENTITY_OBJECTS = [
  ['table', 'inventory_tenant_identity'],
  ['trigger', 'inventory_tenant_identity_no_update'],
  ['trigger', 'inventory_tenant_identity_no_delete'],
]

export const LIVE_SCHEMA_QUERY = 'SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name'
export const LEDGER_QUERY = 'SELECT name FROM d1_migrations ORDER BY name'
const WRANGLER_READ = 'wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --json --command'

// Quoted exactly from wrangler 4.128.0: getCreateMigrationsTableQuery() in
// node_modules/wrangler/wrangler-dist/cli.js with DEFAULT_MIGRATION_TABLE
// "d1_migrations" passed through escapeIdentifier(). A unit test pins it to
// the installed Wrangler.
export const WRANGLER_D1_MIGRATIONS_TABLE_SQL = 'CREATE TABLE IF NOT EXISTS "d1_migrations"(\n\t\tid         INTEGER PRIMARY KEY AUTOINCREMENT,\n\t\tname       TEXT UNIQUE,\n\t\tapplied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL\n);'

export class VerifierInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'VerifierInputError'
  }
}

class SqlParseError extends Error {}

// ---------------------------------------------------------------------------
// Migration discovery: the same rules as scripts/validate-cloud-release.mjs,
// which runs its gate at import time, so the rules are mirrored here.

export function discoverMigrations(directory = MIGRATIONS_DIRECTORY) {
  const files = readdirSync(directory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(name))
    .sort()
  if (!files.length) throw new Error('No Cloudflare D1 migrations were found.')
  for (const [index, file] of files.entries()) {
    const expected = index + 1
    if (Number(file.slice(0, 4)) !== expected) {
      throw new Error(`Cloudflare migration numbering must be contiguous: expected ${String(expected).padStart(4, '0')}, found ${file}.`)
    }
  }
  return files.map((file) => ({ file, sql: readFileSync(path.join(directory, file), 'utf8') }))
}

// ---------------------------------------------------------------------------
// A small SQLite tokenizer. Comments and whitespace are dropped, identifier
// quoting ("x", `x`, [x]) is removed, and words are lowercased, so two
// statements that differ only in layout, quoting, or keyword case normalize to
// the same text. String literals are kept exactly.

const TWO_CHAR_OPERATORS = new Set(['<>', '!=', '<=', '>=', '==', '||', '<<', '>>', '->'])
const NUMBER = /(?:0x[0-9a-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)/iy
const isIdentifierStart = (character) => /[A-Za-z_]/.test(character) || character.charCodeAt(0) > 127
const isIdentifierPart = (character) => /[A-Za-z0-9_$]/.test(character) || character.charCodeAt(0) > 127

function tokenize(sql) {
  const text = String(sql)
  const tokens = []
  let index = 0
  const readQuoted = (close, kind) => {
    let cursor = index + 1
    let value = ''
    for (;;) {
      if (cursor >= text.length) throw new SqlParseError('unterminated quoted text')
      if (text[cursor] === close) {
        if (close !== ']' && text[cursor + 1] === close) {
          value += close
          cursor += 2
          continue
        }
        break
      }
      value += text[cursor]
      cursor += 1
    }
    const raw = text.slice(index, cursor + 1)
    index = cursor + 1
    return kind === 'string' ? { kind, text: raw } : { kind: 'ident', value, text: raw }
  }
  while (index < text.length) {
    const character = text[index]
    if (/\s/.test(character)) { index += 1; continue }
    if (character === '-' && text[index + 1] === '-') {
      const end = text.indexOf('\n', index)
      index = end < 0 ? text.length : end + 1
      continue
    }
    if (character === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      if (end < 0) throw new SqlParseError('unterminated comment')
      index = end + 2
      continue
    }
    if (character === "'") { tokens.push(readQuoted("'", 'string')); continue }
    if (character === '"' || character === '`') { tokens.push(readQuoted(character, 'ident')); continue }
    if (character === '[') { tokens.push(readQuoted(']', 'ident')); continue }
    if (isIdentifierStart(character)) {
      let end = index + 1
      while (end < text.length && isIdentifierPart(text[end])) end += 1
      const raw = text.slice(index, end)
      tokens.push({ kind: 'word', value: raw.toLowerCase(), text: raw })
      index = end
      continue
    }
    NUMBER.lastIndex = index
    const number = NUMBER.exec(text)
    if (number) {
      tokens.push({ kind: 'number', text: number[0].toLowerCase() })
      index += number[0].length
      continue
    }
    if (text.slice(index, index + 3) === '->>') { tokens.push({ kind: 'punct', text: '->>' }); index += 3; continue }
    const pair = text.slice(index, index + 2)
    if (TWO_CHAR_OPERATORS.has(pair)) { tokens.push({ kind: 'punct', text: pair }); index += 2; continue }
    tokens.push({ kind: 'punct', text: character })
    index += 1
  }
  return tokens
}

const isPunct = (token, text) => token?.kind === 'punct' && token.text === text

function canonical(token) {
  if (token.kind === 'word') return token.value
  if (token.kind === 'ident') {
    const value = token.value.toLowerCase()
    return /^[a-z_][a-z0-9_$]*$/.test(value) ? value : `"${value.replaceAll('"', '""')}"`
  }
  return token.text
}

function word(tokens, index) {
  const token = tokens[index]
  return token?.kind === 'word' ? token.value : undefined
}

function identifier(token) {
  if (!token) return undefined
  if (token.kind === 'word') return token.value
  if (token.kind === 'ident') return token.value.toLowerCase()
  if (token.kind === 'string') return token.text.slice(1, -1).replaceAll("''", "'").toLowerCase()
  return undefined
}

function qualifiedName(tokens, index) {
  if (isPunct(tokens[index + 1], '.')) return { name: identifier(tokens[index + 2]), next: index + 3 }
  return { name: identifier(tokens[index]), next: index + 1 }
}

const OBJECT_TYPES = new Set(['table', 'index', 'view', 'trigger'])
const DML_WORDS = new Set(['insert', 'replace', 'update', 'delete'])

function describeStatement(tokens) {
  const first = word(tokens, 0)
  if (first === 'create') {
    let cursor = 1
    if (word(tokens, cursor) === 'temp' || word(tokens, cursor) === 'temporary') cursor += 1
    const unique = word(tokens, cursor) === 'unique'
    if (unique) cursor += 1
    const virtual = word(tokens, cursor) === 'virtual'
    if (virtual) cursor += 1
    const type = word(tokens, cursor)
    if (!OBJECT_TYPES.has(type) || (virtual && type !== 'table') || (unique && type !== 'index')) return { kind: 'other', verb: 'CREATE' }
    cursor += 1
    let ifNotExistsAt = -1
    if (word(tokens, cursor) === 'if' && word(tokens, cursor + 1) === 'not' && word(tokens, cursor + 2) === 'exists') {
      ifNotExistsAt = cursor
      cursor += 3
    }
    const { name, next } = qualifiedName(tokens, cursor)
    return { kind: 'create', type, name, virtual, unique, ifNotExists: ifNotExistsAt >= 0, ifNotExistsAt, bodyAt: next }
  }
  if (first === 'alter' && word(tokens, 1) === 'table') {
    const { name, next } = qualifiedName(tokens, 2)
    const action = word(tokens, next)
    if (action === 'rename' && word(tokens, next + 1) === 'to') return { kind: 'rename', table: name, to: identifier(tokens[next + 2]) }
    return { kind: 'alter', table: name, action }
  }
  if (first === 'drop' && OBJECT_TYPES.has(word(tokens, 1))) {
    let cursor = 2
    if (word(tokens, cursor) === 'if' && word(tokens, cursor + 1) === 'exists') cursor += 2
    return { kind: 'drop', type: word(tokens, 1), name: qualifiedName(tokens, cursor).name }
  }
  if (DML_WORDS.has(first)) return { kind: 'dml', verb: first.toUpperCase() }
  if (first === 'with') {
    let depth = 0
    for (const token of tokens) {
      if (isPunct(token, '(')) depth += 1
      else if (isPunct(token, ')')) depth -= 1
      else if (depth === 0 && token.kind === 'word' && DML_WORDS.has(token.value)) return { kind: 'dml', verb: token.value.toUpperCase() }
    }
  }
  return { kind: 'other', verb: (first ?? '').toUpperCase() }
}

function isTriggerStatement(tokens) {
  if (word(tokens, 0) !== 'create') return false
  const cursor = word(tokens, 1) === 'temp' || word(tokens, 1) === 'temporary' ? 2 : 1
  return word(tokens, cursor) === 'trigger'
}

/** Split tokens into top-level statements; semicolons inside a trigger body do not end it. */
function splitStatements(tokens) {
  const statements = []
  let current = []
  let depth = 0
  for (const token of tokens) {
    if (depth === 0 && isPunct(token, ';')) {
      if (current.length) statements.push(current)
      current = []
      continue
    }
    current.push(token)
    if (token.kind !== 'word' || !isTriggerStatement(current)) continue
    if (token.value === 'begin') depth += 1
    else if (token.value === 'case' && depth > 0) depth += 1
    else if (token.value === 'end' && depth > 0) depth -= 1
  }
  if (current.length) statements.push(current)
  return statements
}

function normalizeTokens(tokens) {
  let list = tokens
  while (list.length && isPunct(list.at(-1), ';')) list = list.slice(0, -1)
  const header = describeStatement(list)
  if (header.kind === 'create' && header.ifNotExists) {
    list = list.filter((_, index) => index < header.ifNotExistsAt || index >= header.ifNotExistsAt + 3)
  }
  return list.map(canonical).join(' ')
}

export function normalizeSql(sql) {
  return normalizeTokens(tokenize(sql))
}

// ---------------------------------------------------------------------------
// Schema snapshots: sqlite_master plus PRAGMA table_xinfo / index_list /
// index_xinfo for every object that is not SQLite-, D1-, or ledger-internal.

const isIgnoredName = (name) => {
  const lower = String(name ?? '').toLowerCase()
  return lower.startsWith('sqlite_') || lower.startsWith('_cf_') || lower === 'd1_migrations'
}
const objectKey = (type, name) => `${type}:${String(name).toLowerCase()}`
const TABLE_CONSTRAINT_WORDS = new Set(['constraint', 'primary', 'unique', 'check', 'foreign'])

function parseTableBody(tokens, at) {
  if (!isPunct(tokens[at], '(')) return null
  const segments = []
  let current = []
  let depth = 0
  let end = -1
  for (let index = at; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (isPunct(token, '(')) {
      depth += 1
      if (depth === 1) continue
    } else if (isPunct(token, ')')) {
      depth -= 1
      if (depth === 0) {
        segments.push(current)
        end = index
        break
      }
    } else if (depth === 1 && isPunct(token, ',')) {
      segments.push(current)
      current = []
      continue
    }
    current.push(token)
  }
  if (end < 0) throw new SqlParseError('unterminated table definition')
  const columns = new Map()
  const constraints = []
  for (const segment of segments) {
    if (!segment.length) continue
    const text = segment.map(canonical).join(' ')
    if (segment[0].kind === 'word' && TABLE_CONSTRAINT_WORDS.has(segment[0].value)) constraints.push(text)
    else columns.set(identifier(segment[0]), text)
  }
  const options = tokens.slice(end + 1).filter((token) => !isPunct(token, ';')).map(canonical).join(' ')
  return { columns, constraints: constraints.sort(), options }
}

function topLevelWordIndex(tokens, value) {
  let depth = 0
  for (const [index, token] of tokens.entries()) {
    if (isPunct(token, '(')) depth += 1
    else if (isPunct(token, ')')) depth -= 1
    else if (depth === 0 && token.kind === 'word' && token.value === value) return index
  }
  return -1
}

function describeTable(database, name, tokens) {
  const header = describeStatement(tokens)
  if (header.virtual) return { virtual: true }
  const body = parseTableBody(tokens, header.bodyAt)
  const columns = database.prepare('SELECT * FROM pragma_table_xinfo(?) ORDER BY cid').all(name).map((column) => ({
    name: String(column.name).toLowerCase(),
    type: String(column.type ?? '').toUpperCase(),
    notnull: Number(column.notnull),
    default: column.dflt_value == null ? null : normalizeSql(String(column.dflt_value)),
    pk: Number(column.pk),
    hidden: Number(column.hidden),
    definition: body?.columns.get(String(column.name).toLowerCase()) ?? null,
  }))
  return { virtual: false, asSelect: !body, columns, constraints: body?.constraints ?? [], options: body?.options ?? '' }
}

function describeIndex(database, row, tokens) {
  const listed = database.prepare('SELECT * FROM pragma_index_list(?)').all(row.tbl_name)
    .find((entry) => String(entry.name).toLowerCase() === row.name.toLowerCase())
  const keyColumns = database.prepare('SELECT * FROM pragma_index_xinfo(?) ORDER BY seqno').all(row.name)
    .filter((column) => Number(column.key) === 1)
    .map((column) => {
      const collation = String(column.coll ?? 'BINARY').toUpperCase()
      return `${column.name == null ? '<expression>' : String(column.name).toLowerCase()}${Number(column.desc) ? ' DESC' : ''}${collation === 'BINARY' ? '' : ` COLLATE ${collation}`}`
    })
  const whereAt = topLevelWordIndex(tokens, 'where')
  const where = whereAt < 0 ? null : tokens.slice(whereAt + 1).filter((token) => !isPunct(token, ';')).map(canonical).join(' ')
  return { unique: Number(listed?.unique ?? 0), partial: Number(listed?.partial ?? 0), keyColumns, where }
}

function describeObject(database, row) {
  const tokens = tokenize(row.sql)
  const base = { type: row.type, name: row.name, table: String(row.tbl_name).toLowerCase(), sql: row.sql, normalized: normalizeTokens(tokens) }
  if (row.type === 'table') return { ...base, ...describeTable(database, row.name, tokens) }
  if (row.type === 'index') return { ...base, ...describeIndex(database, row, tokens) }
  return base
}

function readSchema(database) {
  const schema = new Map()
  const rows = database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND type IN ('table', 'index', 'view', 'trigger') ORDER BY type, name").all()
  for (const row of rows) {
    if (isIgnoredName(row.name) || isIgnoredName(row.tbl_name)) continue
    schema.set(objectKey(row.type, row.name), describeObject(database, row))
  }
  return schema
}

// ---------------------------------------------------------------------------
// Structural comparison.

function diffColumn(expected, live) {
  const differences = []
  if (expected.type !== live.type) differences.push(`type expected ${expected.type || '(none)'}, found ${live.type || '(none)'}`)
  if (expected.notnull !== live.notnull) differences.push(expected.notnull ? 'NOT NULL expected, found nullable' : 'nullable expected, found NOT NULL')
  if (expected.default !== live.default) differences.push(`default expected ${expected.default ?? '(none)'}, found ${live.default ?? '(none)'}`)
  if (expected.pk !== live.pk) differences.push(`primary-key position expected ${expected.pk}, found ${live.pk}`)
  if (expected.hidden !== live.hidden) differences.push(`hidden/generated flag expected ${expected.hidden}, found ${live.hidden}`)
  if (!differences.length && expected.definition !== live.definition) {
    differences.push(`definition expected \`${expected.definition}\`, found \`${live.definition}\``)
  }
  return differences
}

function diffWholeDefinition(expected, live) {
  return expected.normalized === live.normalized ? [] : [`definition expected \`${expected.normalized}\`, found \`${live.normalized}\``]
}

function diffTable(expected, live, exclude) {
  if (expected.virtual || live.virtual || expected.asSelect || live.asSelect) return diffWholeDefinition(expected, live)
  const differences = []
  const expectedColumns = expected.columns.filter((column) => !exclude.has(column.name))
  const liveColumns = live.columns.filter((column) => !exclude.has(column.name))
  const liveByName = new Map(liveColumns.map((column) => [column.name, column]))
  const expectedNames = new Set(expectedColumns.map((column) => column.name))
  for (const column of expectedColumns) {
    const found = liveByName.get(column.name)
    if (!found) differences.push(`column ${column.name} is missing`)
    else for (const difference of diffColumn(column, found)) differences.push(`column ${column.name}: ${difference}`)
  }
  for (const column of liveColumns) if (!expectedNames.has(column.name)) differences.push(`unexpected column ${column.name}`)
  if (!differences.length) {
    const expectedOrder = expectedColumns.map((column) => column.name).join(', ')
    const liveOrder = liveColumns.map((column) => column.name).join(', ')
    if (expectedOrder !== liveOrder) differences.push(`column order expected (${expectedOrder}), found (${liveOrder})`)
  }
  const remaining = [...live.constraints]
  for (const constraint of expected.constraints) {
    const at = remaining.indexOf(constraint)
    if (at < 0) differences.push(`table constraint missing: ${constraint}`)
    else remaining.splice(at, 1)
  }
  for (const constraint of remaining) differences.push(`unexpected table constraint: ${constraint}`)
  if (expected.options !== live.options) differences.push(`table options expected "${expected.options || '(none)'}", found "${live.options || '(none)'}"`)
  return differences
}

function diffIndex(expected, live) {
  const differences = []
  if (expected.table !== live.table) differences.push(`on table ${live.table}, expected ${expected.table}`)
  if (expected.unique !== live.unique) differences.push(expected.unique ? 'UNIQUE expected, found non-unique' : 'non-unique expected, found UNIQUE')
  const expectedKeys = expected.keyColumns.join(', ')
  const liveKeys = live.keyColumns.join(', ')
  if (expectedKeys !== liveKeys) differences.push(`key columns expected (${expectedKeys}), found (${liveKeys})`)
  if (expected.where !== live.where) differences.push(`partial WHERE expected ${expected.where ?? '(none)'}, found ${live.where ?? '(none)'}`)
  if (!differences.length) differences.push(...diffWholeDefinition(expected, live))
  return differences
}

function diffObject(expected, live, exclude = new Set()) {
  if (expected.type === 'table') return diffTable(expected, live, exclude)
  if (expected.type === 'index') return diffIndex(expected, live)
  const differences = []
  if (expected.table !== live.table) differences.push(`on ${live.table}, expected ${expected.table}`)
  differences.push(...diffWholeDefinition(expected, live))
  return differences
}

// ---------------------------------------------------------------------------
// Expected state: every migration applied in order to one in-memory database,
// with a schema snapshot after each file.

function buildExpected(migrations) {
  const database = new DatabaseSync(':memory:', { allowExtension: false })
  try {
    database.exec('PRAGMA foreign_keys = ON')
    const snapshots = [new Map()]
    for (const migration of migrations) {
      try {
        database.exec(migration.sql)
      } catch (error) {
        throw new Error(`Migration ${migration.file} failed in in-memory SQLite: ${error.message}`)
      }
      snapshots.push(readSchema(database))
    }
    return snapshots
  } finally {
    database.close()
  }
}

function buildExpectedTenantIdentity() {
  const database = new DatabaseSync(':memory:', { allowExtension: false })
  try {
    const sql = readFileSync(TENANT_IDENTITY_DDL, 'utf8')
    database.exec(sql)
    return readSchema(database)
  } catch (error) {
    throw new Error(`Tenant identity DDL failed in in-memory SQLite: ${error.message}`)
  } finally {
    database.close()
  }
}

function analyzeMigration(sql) {
  const statements = splitStatements(tokenize(sql)).map(describeStatement)
  return { statements, dml: [...new Set(statements.filter((statement) => statement.kind === 'dml').map((statement) => statement.verb))] }
}

/**
 * Each migration's delta: objects it creates, rebuilds, or redefines, columns
 * it adds with ALTER TABLE, and objects it drops.
 */
function planFacts(migrations, snapshots) {
  return migrations.map((migration, offset) => {
    const index = offset + 1
    const previous = snapshots[index - 1]
    const current = snapshots[index]
    const analysis = analyzeMigration(migration.sql)
    const rebuiltNames = new Set()
    const rebuiltTables = new Set()
    for (const statement of analysis.statements) {
      if (statement.kind === 'create' && !statement.ifNotExists) rebuiltNames.add(objectKey(statement.type, statement.name))
      if (statement.kind === 'rename') {
        rebuiltNames.add(objectKey('table', statement.to))
        rebuiltTables.add(statement.to)
        rebuiltTables.add(statement.table)
      }
      if (statement.kind === 'drop') {
        // A later CREATE ... IF NOT EXISTS of a dropped name rebuilds it.
        rebuiltNames.add(objectKey(statement.type, statement.name))
        if (statement.type === 'table') rebuiltTables.add(statement.name)
      }
    }
    const facts = []
    for (const [key, object] of current) {
      const before = previous.get(key)
      const rebuilt = rebuiltNames.has(key) || ((object.type === 'index' || object.type === 'trigger') && rebuiltTables.has(object.table))
      if (!before) {
        facts.push({ kind: 'object', key, object, change: 'created', unchanged: false })
      } else if (rebuilt) {
        facts.push({ kind: 'object', key, object, change: 'recreated', unchanged: diffObject(before, object).length === 0 })
      } else if (object.normalized !== before.normalized) {
        if (object.type === 'table' && !object.virtual && !before.virtual) {
          const added = object.columns.filter((column) => !before.columns.some((earlier) => earlier.name === column.name)).map((column) => column.name)
          for (const column of added) facts.push({ kind: 'column', key, table: object.name, column, unchanged: false })
          if (diffObject(before, object, new Set(added)).length) facts.push({ kind: 'object', key, object, change: 'redefined', unchanged: false })
        } else {
          facts.push({ kind: 'object', key, object, change: 'redefined', unchanged: false })
        }
      }
    }
    for (const [key, object] of previous) {
      if (!current.has(key)) facts.push({ kind: 'dropped', key, object, unchanged: false })
    }
    return { ...migration, index, analysis, facts }
  })
}

// ---------------------------------------------------------------------------
// Live state: the operator's sqlite_master rows rebuilt in a second in-memory
// database. Every row must be exactly one CREATE statement for the object it
// names; anything else fails closed.

export function parseWranglerResults(text, label, requiredFields) {
  let parsed
  try {
    parsed = JSON.parse(String(text).replace(/^﻿/, ''))
  } catch {
    throw new VerifierInputError(`${label} is not valid JSON. Save the complete --json output of the read-only Wrangler query.`)
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new VerifierInputError(`${label} must be Wrangler's --json array holding exactly one result set; found ${Array.isArray(parsed) ? `${parsed.length} result sets` : 'something else'}.`)
  }
  const [resultSet] = parsed
  if (!resultSet || typeof resultSet !== 'object' || resultSet.success !== true || !Array.isArray(resultSet.results)) {
    throw new VerifierInputError(`${label} does not hold one successful result set ("success": true with a "results" array).`)
  }
  for (const [index, row] of resultSet.results.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new VerifierInputError(`${label} row ${index + 1} is not an object.`)
    for (const field of requiredFields) {
      if (typeof row[field] !== 'string' || !row[field]) throw new VerifierInputError(`${label} row ${index + 1} has no "${field}" string.`)
    }
  }
  return resultSet.results
}

function rebuildLive(rows) {
  const accepted = []
  const ignored = []
  const seen = new Set()
  let ledgerTable = null
  for (const row of rows) {
    const label = `Live ${display(row.type)} ${display(row.name)}`
    if (!OBJECT_TYPES.has(row.type)) throw new VerifierInputError(`${label} has an unsupported sqlite_master type.`)
    const key = objectKey(row.type, row.name)
    if (seen.has(key)) throw new VerifierInputError(`${label} appears more than once.`)
    seen.add(key)
    let statements
    try {
      statements = splitStatements(tokenize(row.sql))
    } catch (error) {
      throw new VerifierInputError(`${label} has unparseable SQL (${error.message}).`)
    }
    const header = statements.length === 1 ? describeStatement(statements[0]) : null
    if (!header || header.kind !== 'create' || header.type !== row.type || header.name !== row.name.toLowerCase()) {
      throw new VerifierInputError(`${label}: its sql must be exactly one CREATE ${row.type.toUpperCase()} statement for that object.`)
    }
    if (row.type === 'table' && row.name.toLowerCase() === 'd1_migrations') ledgerTable = row
    if (isIgnoredName(row.name) || isIgnoredName(row.tbl_name)) {
      ignored.push({ type: row.type, name: row.name })
      continue
    }
    accepted.push({ row, key, header })
  }

  const database = new DatabaseSync(':memory:', { allowExtension: false })
  try {
    const virtualTables = new Map()
    const create = ({ row }) => {
      const statement = database.prepare(row.sql)
      if (normalizeSql(statement.sourceSQL) !== normalizeSql(row.sql)) {
        throw new VerifierInputError(`Live ${display(row.type)} ${display(row.name)}: its sql must be a single statement.`)
      }
      statement.run()
    }
    for (const type of ['table', 'view', 'index', 'trigger']) {
      let pending = accepted.filter((entry) => entry.row.type === type)
      if (type === 'table') {
        // A virtual table needs its module; compare it by normalized SQL only.
        for (const entry of pending.filter((candidate) => candidate.header.virtual)) {
          virtualTables.set(entry.key, { type: 'table', name: entry.row.name, table: entry.row.tbl_name.toLowerCase(), sql: entry.row.sql, normalized: normalizeSql(entry.row.sql), virtual: true })
        }
        pending = pending.filter((candidate) => !candidate.header.virtual)
      }
      // Views may reference other views; retry until no further progress.
      while (pending.length) {
        const failed = []
        let lastError = null
        for (const entry of pending) {
          try {
            create(entry)
          } catch (error) {
            if (error instanceof VerifierInputError) throw error
            failed.push(entry)
            lastError = error
          }
        }
        if (failed.length === pending.length) {
          const [first] = failed
          throw new VerifierInputError(`Live ${display(first.row.type)} ${display(first.row.name)} could not be rebuilt in memory (${lastError.message}).`)
        }
        pending = failed
      }
    }
    const schema = readSchema(database)
    for (const [key, object] of virtualTables) schema.set(key, object)
    for (const { row, key } of accepted) {
      const object = schema.get(key)
      if (!object || object.table !== row.tbl_name.toLowerCase()) {
        throw new VerifierInputError(`Live ${display(row.type)} ${display(row.name)}: tbl_name does not match its CREATE statement.`)
      }
    }
    return { schema, ignored, ledgerTable, objectCount: accepted.length }
  } finally {
    database.close()
  }
}

// ---------------------------------------------------------------------------
// Evaluation.

function factLabel(fact) {
  if (fact.kind === 'column') return `column ${fact.table}.${fact.column}`
  if (fact.kind === 'dropped') return `drop of ${fact.object.type} ${fact.object.name}`
  return `${fact.object.type} ${fact.object.name}`
}

function laterColumns(planned, index, key) {
  const names = new Set()
  for (const migration of planned.slice(index)) {
    for (const fact of migration.facts) if (fact.kind === 'column' && fact.key === key) names.add(fact.column)
  }
  return names
}

function evaluateFact(fact, migration, planned, snapshots, live) {
  const files = planned.map((entry) => entry.file)
  const liveObject = live.get(fact.key)
  if (fact.kind === 'column') {
    if (!liveObject || liveObject.virtual) return { result: 'missing', details: [`table ${fact.table} is not in the live schema`] }
    const liveColumn = liveObject.columns.find((column) => column.name === fact.column)
    if (!liveColumn) return { result: 'missing', details: [`column ${fact.column} is not on live table ${fact.table}`] }
    let best = null
    for (let later = migration.index; later < snapshots.length; later += 1) {
      const expectedColumn = snapshots[later].get(fact.key)?.columns?.find((column) => column.name === fact.column)
      if (!expectedColumn) continue
      const differences = diffColumn(expectedColumn, liveColumn)
      if (!differences.length) return { result: 'present', details: [] }
      if (!best || differences.length < best.length) best = differences
    }
    return { result: 'different', details: (best ?? ['no expected definition']).map((difference) => `column ${fact.table}.${fact.column}: ${difference}`) }
  }
  if (fact.kind === 'dropped') {
    if (!liveObject) return { result: 'present', details: [] }
    for (let later = migration.index + 1; later < snapshots.length; later += 1) {
      const expected = snapshots[later].get(fact.key)
      if (expected && !diffObject(expected, liveObject).length) return { result: 'present', details: [] }
    }
    for (let earlier = migration.index - 1; earlier >= 1; earlier -= 1) {
      const expected = snapshots[earlier].get(fact.key)
      if (expected && !diffObject(expected, liveObject).length) return { result: 'missing', details: ['still present in the live schema; this migration drops it'] }
    }
    return { result: 'different', details: ['present in the live schema with a definition no migration produces; this migration drops it'] }
  }
  if (!liveObject) return { result: 'missing', details: ['not in the live schema'] }
  const exclude = fact.object.type === 'table' ? laterColumns(planned, migration.index, fact.key) : new Set()
  let best = null
  for (let later = migration.index; later < snapshots.length; later += 1) {
    const expected = snapshots[later].get(fact.key)
    if (!expected) continue
    const differences = diffObject(expected, liveObject, exclude)
    if (!differences.length) {
      return { result: 'present', details: later > migration.index && fact.unchanged === false && expected.normalized !== fact.object.normalized ? [`matches the definition after ${files[later - 1]}`] : [] }
    }
    if (!best || differences.length < best.length) best = differences
  }
  for (let earlier = migration.index - 1; earlier >= 1; earlier -= 1) {
    const expected = snapshots[earlier].get(fact.key)
    if (expected && !diffObject(expected, liveObject, exclude).length) {
      return { result: 'missing', details: [`live still has the definition from before this migration (as of ${files[earlier - 1]})`] }
    }
  }
  return { result: 'different', details: best ?? ['no expected definition'] }
}

function migrationStatus(facts) {
  // A rebuilt object whose definition is identical before and after the
  // migration carries no evidence either way unless it is absent or different.
  const relevant = facts.filter((fact) => !fact.unchanged || fact.result !== 'present')
  if (!relevant.length || relevant.every((fact) => fact.result === 'present')) return 'APPLIED'
  if (relevant.some((fact) => fact.result === 'different')) return 'MODIFIED'
  if (relevant.every((fact) => fact.result === 'missing')) return 'MISSING'
  return 'PARTIAL'
}

function describeDelta(facts) {
  const delta = { created: [], recreated: [], redefined: [], columnsAdded: [], dropped: [] }
  for (const fact of facts) {
    if (fact.kind === 'column') delta.columnsAdded.push(`${fact.table}.${fact.column}`)
    else if (fact.kind === 'dropped') delta.dropped.push(`${fact.object.type} ${fact.object.name}`)
    else delta[fact.change].push(`${fact.object.type} ${fact.object.name}${fact.unchanged ? ' (definition unchanged)' : ''}`)
  }
  return delta
}

/**
 * Compare the operator's saved live schema (and optional ledger) with the
 * repository migrations. Throws VerifierInputError for any input it cannot
 * trust; never touches the network or D1.
 */
export function verifyD1Schema({ liveJson, ledgerJson = null, migrationsDirectory = MIGRATIONS_DIRECTORY, dataReviewed = [], printLedgerSql = false, tenantIdentity = false }) {
  const migrations = discoverMigrations(migrationsDirectory)
  const files = migrations.map((migration) => migration.file)
  const unknownReviewed = dataReviewed.filter((name) => !files.includes(name))
  if (unknownReviewed.length) {
    throw new VerifierInputError(`--data-reviewed names no migration file: ${unknownReviewed.map(display).join(', ')}. Use exact filenames such as ${files[0]}.`)
  }
  const liveRows = parseWranglerResults(liveJson, 'The --live file', ['type', 'name', 'tbl_name', 'sql'])
  const ledgerRows = ledgerJson == null ? null : parseWranglerResults(ledgerJson, 'The --ledger file', ['name'])
  const live = rebuildLive(liveRows)
  // A live ledger table whose rows were not supplied would leave every ledger
  // check unrun (a row recorded for a migration that is not APPLIED would go
  // unnoticed), so the run stops instead of reporting a PASS it cannot prove.
  if (live.ledgerTable && !ledgerRows) {
    throw new VerifierInputError('The live schema has a d1_migrations table, so the verifier needs its rows: pass --ledger with the saved ledger query output.')
  }

  const snapshots = buildExpected(migrations)
  const expectedTenantIdentity = tenantIdentity ? buildExpectedTenantIdentity() : null
  const planned = planFacts(migrations, snapshots)
  const ledgerNames = ledgerRows ? ledgerRows.map((row) => row.name) : []
  const reviewed = new Set(dataReviewed)

  const reports = planned.map((migration) => {
    const facts = migration.facts.map((fact) => ({ ...fact, label: factLabel(fact), ...evaluateFact(fact, migration, planned, snapshots, live.schema) }))
    const status = migrationStatus(facts)
    const schemaIndistinguishable = facts.every((fact) => fact.unchanged)
    const dataReviewReasons = [
      ...migration.analysis.dml.map((verb) => `${verb} statement`),
      ...(schemaIndistinguishable ? ['schema is identical before and after this migration'] : []),
    ]
    return {
      file: migration.file,
      status,
      facts: {
        total: facts.length,
        present: facts.filter((fact) => fact.result === 'present').length,
        missing: facts.filter((fact) => fact.result === 'missing').length,
        different: facts.filter((fact) => fact.result === 'different').length,
      },
      dataReviewRequired: dataReviewReasons.length > 0,
      dataReviewReasons,
      dataReviewAttested: reviewed.has(migration.file),
      schemaIndistinguishable,
      inLedger: ledgerNames.includes(migration.file),
      delta: describeDelta(facts),
      differences: facts
        .filter((fact) => fact.result !== 'present')
        .map((fact) => ({ object: fact.label, result: fact.result, details: fact.details })),
    }
  })

  // An attestation must match a migration that needs one; a typo such as
  // 0008 for 0010 would otherwise mark the wrong file and leave 0010 skipped.
  const needsNoReview = dataReviewed.filter((name) => !reports.some((report) => report.file === name && report.dataReviewRequired))
  if (needsNoReview.length) {
    const required = reports.filter((report) => report.dataReviewRequired).map((report) => report.file)
    throw new VerifierInputError(`--data-reviewed names a migration that is not DATA_REVIEW_REQUIRED: ${[...new Set(needsNoReview)].map(display).join(', ')}. Only these need review: ${required.join(', ')}.`)
  }

  const tenantIdentityDifferences = []
  if (tenantIdentity) {
    for (const [type, name] of TENANT_IDENTITY_OBJECTS) {
      const key = objectKey(type, name)
      const expected = expectedTenantIdentity.get(key)
      const actual = live.schema.get(key)
      if (!actual) tenantIdentityDifferences.push({ object: `${type} ${name}`, result: 'missing', details: ['not in the live schema'] })
      else if (!expected) tenantIdentityDifferences.push({ object: `${type} ${name}`, result: 'different', details: ['not present in the fixed tenant identity DDL'] })
      else {
        const differences = diffObject(expected, actual)
        if (differences.length) tenantIdentityDifferences.push({ object: `${type} ${name}`, result: 'different', details: differences })
      }
    }
    for (const key of expectedTenantIdentity.keys()) {
      const [type, name] = key.split(':')
      if (!TENANT_IDENTITY_OBJECTS.some(([expectedType, expectedName]) => objectKey(expectedType, expectedName) === key)) {
        tenantIdentityDifferences.push({ object: `${type} ${name}`, result: 'different', details: ['unexpected object in the fixed tenant identity DDL'] })
      }
    }
  }
  const tenantIdentityOk = tenantIdentity && tenantIdentityDifferences.length === 0
  const extraLiveObjects = []
  for (const [key, object] of live.schema) {
    const knownTenantObject = TENANT_IDENTITY_OBJECTS.some(([type, name]) => objectKey(type, name) === key)
    if (!snapshots.some((snapshot) => snapshot.has(key)) && !(tenantIdentityOk && knownTenantObject)) extraLiveObjects.push({ type: object.type, name: object.name })
  }

  const wranglerLedgerSql = normalizeSql(WRANGLER_D1_MIGRATIONS_TABLE_SQL)
  const ledgerTableState = !live.ledgerTable ? 'absent' : normalizeSql(live.ledgerTable.sql) === wranglerLedgerSql ? 'matches-wrangler' : 'differs'
  const recorded = ledgerNames ?? []
  const unexpected = [...new Set(recorded.filter((name) => !files.includes(name)))]
  const duplicates = [...new Set(recorded.filter((name, index) => recorded.indexOf(name) !== index))]
  const missing = ledgerRows ? files.filter((name) => !recorded.includes(name)) : []
  const recordedNotApplied = reports.filter((report) => report.inLedger && report.status !== 'APPLIED').map((report) => report.file)
  const anomalies = []
  if (ledgerTableState === 'differs') anomalies.push("The live d1_migrations table differs from Wrangler's definition.")
  if (ledgerRows && !live.ledgerTable) anomalies.push('--ledger rows were supplied but the live schema has no d1_migrations table; both files must come from the same database.')
  if (unexpected.length) anomalies.push(`Ledger names that match no migration file: ${unexpected.map(display).join(', ')}.`)
  if (duplicates.length) anomalies.push(`Ledger names recorded more than once: ${duplicates.map(display).join(', ')}.`)
  if (missing.length) anomalies.push(`Migration names missing from the supplied ledger: ${missing.join(', ')}.`)
  if (recordedNotApplied.length) anomalies.push(`Recorded in the ledger but not APPLIED in the live schema: ${recordedNotApplied.join(', ')}.`)

  const ok = reports.every((report) => report.status === 'APPLIED') && !extraLiveObjects.length && !anomalies.length && (!tenantIdentity || tenantIdentityOk)
  const report = {
    ok,
    exitCode: ok ? 0 : 1,
    readOnly: true,
    migrations: reports,
    extraLiveObjects,
    ignoredLiveObjects: live.ignored,
    liveObjectCount: live.objectCount,
    tenantIdentity: {
      requested: tenantIdentity,
      status: tenantIdentity ? (tenantIdentityOk ? 'verified' : 'failed') : 'not-requested',
      schemaOnly: true,
      differences: tenantIdentityDifferences,
    },
    ledger: {
      supplied: Boolean(ledgerRows),
      liveTable: ledgerTableState,
      recorded,
      unexpected,
      duplicates,
      missing,
      recordedNotApplied,
      anomalies,
    },
  }
  if (printLedgerSql) report.ledgerSql = buildLedgerSql(report)
  return report
}

function buildLedgerSql(report) {
  const createTable = WRANGLER_D1_MIGRATIONS_TABLE_SQL
  const inserts = []
  const skipped = []
  let refused = null
  if (report.ledger.liveTable === 'differs') refused = "the live d1_migrations table differs from Wrangler's definition"
  else if (report.ledger.supplied && report.ledger.liveTable === 'absent') refused = 'the --ledger rows and the live schema disagree about whether d1_migrations exists'
  for (const migration of report.migrations) {
    if (refused) skipped.push({ file: migration.file, reason: `not printed: ${refused}` })
    else if (migration.inLedger) skipped.push({ file: migration.file, reason: 'already recorded in d1_migrations' })
    else if (migration.status !== 'APPLIED') skipped.push({ file: migration.file, reason: `${migration.status}: only APPLIED migrations are ever recorded` })
    else if (migration.dataReviewRequired && !migration.dataReviewAttested) {
      skipped.push({ file: migration.file, reason: `DATA_REVIEW_REQUIRED (${migration.dataReviewReasons.join('; ')}); review its data changes, then pass --data-reviewed ${migration.file}` })
    } else inserts.push(`INSERT INTO d1_migrations (name) VALUES ('${migration.file.replaceAll("'", "''")}');`)
  }
  const lines = [
    '-- d1_migrations ledger SQL printed by scripts/verify-d1-schema.mjs for review.',
    '-- Nothing was executed. Running these statements is release work that Joe must authorize.',
  ]
  if (refused) lines.push(`-- Refused: ${refused}. Resolve it through review before recording any ledger row.`)
  else lines.push(createTable, ...inserts)
  for (const entry of skipped) lines.push(`-- skipped ${entry.file}: ${entry.reason}`)
  return { createTable, inserts, skipped, refused, text: `${lines.join('\n')}\n` }
}

// ---------------------------------------------------------------------------
// Output and CLI.

function display(value) {
  const text = String(value)
  return /^[\w$.-]+$/.test(text) ? text : JSON.stringify(text)
}

// Keep terminal control characters from live input out of the terminal.
const safeText = (text) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)

export function formatReport(report) {
  const lines = []
  lines.push('D1 schema verification (read-only: saved files and in-memory SQLite only; nothing was sent to D1).')
  lines.push(`Live schema: ${report.liveObjectCount} objects compared; ${report.ignoredLiveObjects.length} ignored (sqlite_*, _cf_*, d1_migrations).`)
  const tableState = { absent: 'absent', 'matches-wrangler': "present and matches Wrangler's definition", differs: "present but DIFFERS from Wrangler's definition" }[report.ledger.liveTable]
  lines.push(`Ledger table in live schema: ${tableState}.`)
  lines.push(`Ledger rows: ${report.ledger.supplied ? `${report.ledger.recorded.length} names from --ledger` : 'none (no ledger table)'}.`)
  if (report.tenantIdentity?.requested) {
    lines.push(`Tenant identity schema: ${report.tenantIdentity.status === 'verified' ? 'VERIFIED' : 'FAILED'} (schema definitions only; singleton row and group identity were not verified).`)
    for (const difference of report.tenantIdentity.differences) {
      lines.push(`  ${difference.result.toUpperCase()} ${difference.object}: ${difference.details.join('; ')}`)
    }
  }
  lines.push('')
  const width = Math.max('MIGRATION'.length, ...report.migrations.map((migration) => migration.file.length))
  lines.push(`${'MIGRATION'.padEnd(width)}  ${'STATUS'.padEnd(8)}  ${'SCHEMA'.padEnd(7)}  ${'LEDGER'.padEnd(10)}  DATA REVIEW`)
  for (const migration of report.migrations) {
    const ledger = migration.inLedger ? 'recorded' : 'missing'
    const review = migration.dataReviewRequired
      ? `DATA_REVIEW_REQUIRED (${migration.dataReviewReasons.join('; ')})${migration.dataReviewAttested ? ' - attested by --data-reviewed' : ''}`
      : '-'
    lines.push(`${migration.file.padEnd(width)}  ${migration.status.padEnd(8)}  ${`${migration.facts.present}/${migration.facts.total}`.padEnd(7)}  ${ledger.padEnd(10)}  ${review}`)
  }
  const withDifferences = report.migrations.filter((migration) => migration.differences.length)
  if (withDifferences.length) {
    lines.push('', 'Differences:')
    for (const migration of withDifferences) {
      lines.push(`  ${migration.file} (${migration.status})`)
      for (const difference of migration.differences) {
        lines.push(`    ${difference.result.toUpperCase().padEnd(9)} ${difference.object}`)
        for (const detail of difference.details) lines.push(`              ${detail}`)
      }
    }
  }
  if (report.extraLiveObjects.length) {
    lines.push('', 'Live objects no migration creates:')
    for (const object of report.extraLiveObjects) lines.push(`  ${object.type} ${display(object.name)}`)
  }
  if (report.ledger.anomalies.length) {
    lines.push('', 'Ledger anomalies:')
    for (const anomaly of report.ledger.anomalies) lines.push(`  ${anomaly}`)
  }
  const notApplied = report.migrations.filter((migration) => migration.status !== 'APPLIED')
  const review = report.migrations.filter((migration) => migration.dataReviewRequired && !migration.dataReviewAttested)
  lines.push('')
  if (report.ok) {
    lines.push(`Result: PASS - all ${report.migrations.length} migrations APPLIED; nothing modified or unexplained (exit 0).`)
  } else {
    const reasons = []
    if (notApplied.length) reasons.push(`${notApplied.length} migration(s) not APPLIED (${notApplied.map((migration) => `${migration.file.slice(0, 4)} ${migration.status}`).join(', ')})`)
    if (report.extraLiveObjects.length) reasons.push(`${report.extraLiveObjects.length} unexplained live object(s)`)
    if (report.tenantIdentity?.requested && report.tenantIdentity.status !== 'verified') reasons.push('tenant identity schema not verified')
    if (report.ledger.anomalies.length) reasons.push(`${report.ledger.anomalies.length} ledger anomaly(ies)`)
    lines.push(`Result: FAIL - ${reasons.join('; ')} (exit 1).`)
  }
  if (review.length) {
    lines.push(`Schema presence cannot prove data changes: ${review.map((migration) => migration.file).join(', ')} need data review before their ledger rows are printed (--data-reviewed).`)
  }
  return `${lines.join('\n')}\n`
}

export const USAGE = `Usage: node scripts/verify-d1-schema.mjs --live <schema.json> [--ledger <ledger.json>] [--tenant-identity] [--json]
       [--print-ledger-sql [--data-reviewed <file>,<file>...]]

Read-only. Compares the live D1 schema (saved by the operator) with
cloudflare/migrations/*.sql. Never contacts the network, runs Wrangler, or
writes to D1.

--tenant-identity     also verify the fixed tenant identity table and both
                      immutable triggers from cloudflare/tenant-migrations.
                      This checks schema definitions only, not the singleton
                      row or configured group identity.

Produce the inputs with read-only queries:
  ${WRANGLER_READ} "${LIVE_SCHEMA_QUERY}" > schema.json
  ${WRANGLER_READ} "${LEDGER_QUERY}" > ledger.json   (omit --ledger when the table is absent)

--json               print the report as JSON
--print-ledger-sql   print, for review only, Wrangler's d1_migrations CREATE
                     statement and one INSERT per APPLIED migration not yet in
                     the ledger. DATA_REVIEW_REQUIRED migrations are left out
                     unless --data-reviewed names them.
Exit codes: 0 all migrations APPLIED and nothing modified, unexplained, or
inconsistent; 1 verification found a difference; 2 unusable input.
`

function parseArguments(argv) {
  const options = { live: null, ledger: null, tenantIdentity: false, json: false, printLedgerSql: false, dataReviewed: [], help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const equals = argument.startsWith('--') ? argument.indexOf('=') : -1
    const flag = equals > 0 ? argument.slice(0, equals) : argument
    const inline = equals > 0 ? argument.slice(equals + 1) : undefined
    const value = () => {
      if (inline !== undefined) {
        if (!inline) throw new Error(`${flag} needs a value.`)
        return inline
      }
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value.`)
      index += 1
      return next
    }
    const toggle = () => {
      if (inline !== undefined) throw new Error(`${flag} takes no value.`)
      return true
    }
    switch (flag) {
      case '--live':
        if (options.live) throw new Error('--live may be given once.')
        options.live = value()
        break
      case '--ledger':
        if (options.ledger) throw new Error('--ledger may be given once.')
        options.ledger = value()
        break
      case '--tenant-identity':
        options.tenantIdentity = toggle()
        break
      case '--json':
        options.json = toggle()
        break
      case '--print-ledger-sql':
        options.printLedgerSql = toggle()
        break
      case '--data-reviewed':
        options.dataReviewed.push(...value().split(',').map((name) => name.trim()).filter(Boolean))
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new Error(`Unknown argument: ${display(argument)}`)
    }
  }
  if (!options.help && !options.live) throw new Error('--live <file> is required.')
  if (options.dataReviewed.length && !options.printLedgerSql) throw new Error('--data-reviewed only applies with --print-ledger-sql.')
  return options
}

function readInput(readFile, file, flag) {
  try {
    return readFile(file)
  } catch (error) {
    throw new VerifierInputError(`Cannot read the ${flag} file (${error?.code ?? error?.message ?? 'unknown error'}).`)
  }
}

/** CLI entry point; returns the process exit code. */
export function runCli(argv, io = {}) {
  const readFile = io.readFile ?? ((file) => readFileSync(file, 'utf8'))
  const stdout = io.stdout ?? ((text) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text) => process.stderr.write(text))
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    stderr(`${error.message}\n\n${USAGE}`)
    return 2
  }
  if (options.help) {
    stdout(USAGE)
    return 0
  }
  let report
  try {
    const liveJson = readInput(readFile, options.live, '--live')
    const ledgerJson = options.ledger ? readInput(readFile, options.ledger, '--ledger') : null
    report = verifyD1Schema({ liveJson, ledgerJson, migrationsDirectory: io.migrationsDirectory, dataReviewed: options.dataReviewed, printLedgerSql: options.printLedgerSql, tenantIdentity: options.tenantIdentity })
  } catch (error) {
    const prefix = error instanceof VerifierInputError ? 'D1 schema verification stopped (fail closed)' : 'D1 schema verification failed'
    stderr(safeText(`${prefix}: ${error.message}\n`))
    return 2
  }
  if (options.json) stdout(safeText(`${JSON.stringify(report, null, 2)}\n`))
  else stdout(safeText(`${formatReport(report)}${report.ledgerSql ? `\n${report.ledgerSql.text}` : ''}`))
  return report.exitCode
}

if (isMainModule(import.meta.url)) process.exitCode = runCli(process.argv.slice(2))
