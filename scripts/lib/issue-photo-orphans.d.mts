export function issuePhotoObjectKey(vin: string, photoId: string): string

export function referencedIssuePhotoKeys(
  rows: ReadonlyArray<{ vin?: string; photos?: unknown; photos_json?: unknown }>,
): Set<string>

export function findIssuePhotoOrphans(
  objects: Iterable<{ key: string; uploadedAt?: string | Date | null }>,
  referencedKeys: Iterable<string>,
  options?: { now?: Date; graceMs?: number },
): {
  orphans: Array<{ key: string; reason: string; uploadedAt: string }>
  retained: Array<{ key: string; reason: string }>
  skippedRecent: Array<{ key: string; reason: string; uploadedAt: string }>
  needsReview: Array<{ key: string; reason: string }>
  ignored: Array<{ key: string; reason: string }>
}
