export type MigrationStatus = 'APPLIED' | 'MISSING' | 'PARTIAL' | 'MODIFIED'

export interface MigrationDifference {
  object: string
  result: 'missing' | 'different'
  details: string[]
}

export interface MigrationReport {
  file: string
  status: MigrationStatus
  facts: { total: number; present: number; missing: number; different: number }
  dataReviewRequired: boolean
  dataReviewReasons: string[]
  dataReviewAttested: boolean
  schemaIndistinguishable: boolean
  inLedger: boolean
  delta: { created: string[]; recreated: string[]; redefined: string[]; columnsAdded: string[]; dropped: string[] }
  differences: MigrationDifference[]
}

export interface LedgerSql {
  createTable: string
  inserts: string[]
  skipped: Array<{ file: string; reason: string }>
  refused: string | null
  text: string
}

export interface VerificationReport {
  ok: boolean
  exitCode: 0 | 1
  readOnly: true
  migrations: MigrationReport[]
  extraLiveObjects: Array<{ type: string; name: string }>
  ignoredLiveObjects: Array<{ type: string; name: string }>
  liveObjectCount: number
  ledger: {
    supplied: boolean
    liveTable: 'absent' | 'matches-wrangler' | 'differs'
    recorded: string[]
    unexpected: string[]
    duplicates: string[]
    recordedNotApplied: string[]
    anomalies: string[]
  }
  ledgerSql?: LedgerSql
}

export const MIGRATIONS_DIRECTORY: string
export const LIVE_SCHEMA_QUERY: string
export const LEDGER_QUERY: string
export const WRANGLER_D1_MIGRATIONS_TABLE_SQL: string
export const USAGE: string

export class VerifierInputError extends Error {}

export function discoverMigrations(directory?: string): Array<{ file: string; sql: string }>
export function normalizeSql(sql: string): string
export function parseWranglerResults(text: string, label: string, requiredFields: string[]): Array<Record<string, unknown>>
export function verifyD1Schema(options: {
  liveJson: string
  ledgerJson?: string | null
  migrationsDirectory?: string
  dataReviewed?: string[]
  printLedgerSql?: boolean
}): VerificationReport
export function formatReport(report: VerificationReport): string
export function runCli(
  argv: string[],
  io?: {
    readFile?: (file: string) => string
    stdout?: (text: string) => void
    stderr?: (text: string) => void
    migrationsDirectory?: string
  },
): number
