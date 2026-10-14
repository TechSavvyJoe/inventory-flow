export function reportIssuePhotoOrphans(input: {
  ledgerRows: ReadonlyArray<{ vin?: string; photos?: unknown; photos_json?: unknown }>
  objects: ReadonlyArray<{ key: string; uploadedAt?: string | Date | null }>
  graceHours?: number
  now?: Date
}): {
  orphans: Array<{ key: string; reason: string; uploadedAt: string | null }>
  retained: Array<{ key: string; reason: string }>
  skippedRecent: Array<{ key: string; reason: string; uploadedAt: string }>
  ignored: Array<{ key: string; reason: string }>
}
