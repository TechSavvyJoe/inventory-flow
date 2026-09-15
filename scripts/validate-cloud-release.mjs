// Offline Cloudflare release gate. It intentionally opens only an in-memory
// SQLite database: no credentials, bindings, remote D1, or Wrangler commands.
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const migrationsDirectory = path.join(root, 'cloudflare', 'migrations')
const files = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(name))
  .sort()

if (!files.length) throw new Error('No Cloudflare D1 migrations were found.')

const numbers = files.map((name) => Number(name.slice(0, 4)))
for (const [index, number] of numbers.entries()) {
  const expected = index + 1
  if (number !== expected) {
    throw new Error(`Cloudflare migration numbering must be contiguous: expected ${String(expected).padStart(4, '0')}, found ${files[index]}.`)
  }
}

const database = new DatabaseSync(':memory:')
try {
  database.exec('PRAGMA foreign_keys = ON')
  for (const file of files) database.exec(readFileSync(path.join(migrationsDirectory, file), 'utf8'))
  for (const table of ['cloud_app_revision', 'vehicle_service_events', 'vehicle_service_intake']) {
    if (!database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table)) {
      throw new Error(`Cloudflare migration validation did not create required table ${table}.`)
    }
  }
  process.stdout.write(`Cloud release validation passed (${files.length} contiguous migrations applied to in-memory SQLite).\n`)
} finally {
  database.close()
}
