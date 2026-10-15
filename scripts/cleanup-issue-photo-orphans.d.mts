export function loadLedgerRows(path: string, text?: string): Array<Record<string, unknown>>
export function loadObjectRows(path: string, text?: string): Array<{ key: string; uploadedAt?: string | Date | null }>

export function reportIssuePhotoOrphans(input: {
  ledgerRows: ReadonlyArray<{ vin?: string; photos?: unknown; photos_json?: unknown }>
  objects: ReadonlyArray<{ key: string; uploadedAt?: string | Date | null }>
  graceHours?: number
  now?: Date
}): {
  orphans: Array<{ key: string; reason: string; uploadedAt: string }>
  retained: Array<{ key: string; reason: string }>
  skippedRecent: Array<{ key: string; reason: string; uploadedAt: string }>
  needsReview: Array<{ key: string; reason: string }>
  ignored: Array<{ key: string; reason: string }>
}
