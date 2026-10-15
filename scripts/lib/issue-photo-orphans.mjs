/**
 * Decide which encrypted issue-photo R2 objects are safe to delete.
 *
 * Rules (docs/VEHICLE_ISSUES.md):
 * - Never delete an object referenced by any vehicle_issue_events.photos_json.
 * - Allow for in-flight writes: skip objects newer than the grace window.
 * - Dry-run callers report orphans; deletion is a separate operator step.
 */

const OBJECT_KEY = /^vehicle-issues\/([^/]+)\/([a-f0-9]{64})\.enc$/

export function issuePhotoObjectKey(vin, photoId) {
  return `vehicle-issues/${vin}/${photoId}.enc`
}

export function referencedIssuePhotoKeys(rows) {
  const keys = new Set()
  for (const row of rows) {
    const vin = String(row.vin ?? '')
    let photos = row.photos
    if (photos == null && row.photos_json != null) {
      photos = typeof row.photos_json === 'string' ? JSON.parse(row.photos_json) : row.photos_json
    }
    if (!vin || !Array.isArray(photos)) continue
    for (const photo of photos) {
      const id = photo?.id
      if (typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) keys.add(issuePhotoObjectKey(vin, id))
    }
  }
  return keys
}

/**
 * @param {Iterable<{ key: string, uploadedAt?: string | Date | null }>} objects
 * @param {Iterable<string>} referencedKeys
 * @param {{ now?: Date, graceMs?: number }} [options]
 */
export function findIssuePhotoOrphans(objects, referencedKeys, options = {}) {
  const now = options.now ?? new Date()
  const graceMs = options.graceMs ?? 24 * 60 * 60 * 1000
  const referenced = referencedKeys instanceof Set ? referencedKeys : new Set(referencedKeys)
  const orphans = []
  const retained = []
  const skippedRecent = []
  const needsReview = []
  const ignored = []

  for (const object of objects) {
    const key = object?.key
    if (typeof key !== 'string' || !OBJECT_KEY.test(key)) {
      if (typeof key === 'string') ignored.push({ key, reason: 'not_issue_photo_object' })
      continue
    }
    if (referenced.has(key)) {
      retained.push({ key, reason: 'referenced_by_ledger' })
      continue
    }
    // Missing or invalid upload times are not deletion candidates. An in-flight
    // write can land in R2 before D1, and without a timestamp the grace window
    // cannot protect it.
    const uploadedAt = object.uploadedAt == null || object.uploadedAt === ''
      ? null
      : new Date(object.uploadedAt)
    if (!uploadedAt || Number.isNaN(uploadedAt.getTime())) {
      needsReview.push({ key, reason: 'missing_or_invalid_uploaded_at' })
      continue
    }
    if (now.getTime() - uploadedAt.getTime() < graceMs) {
      skippedRecent.push({ key, reason: 'inside_grace_window', uploadedAt: uploadedAt.toISOString() })
      continue
    }
    orphans.push({
      key,
      reason: 'unreferenced',
      uploadedAt: uploadedAt.toISOString(),
    })
  }

  return { orphans, retained, skippedRecent, needsReview, ignored }
}
