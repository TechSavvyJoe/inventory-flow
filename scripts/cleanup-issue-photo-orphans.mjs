#!/usr/bin/env node
/**
 * Operator helper: report (and optionally delete) unreferenced encrypted issue
 * photos in R2. Default is dry-run. Never deletes a key present in D1 history.
 *
 * Inputs are saved JSON files so this script never needs live credentials in
 * unit tests. Operator steps (order matters):
 *
 * 1. List R2 keys under vehicle-issues/ into a JSON array of
 *    { "key": "...", "uploadedAt": "ISO-8601" }. Capture this first so the
 *    ledger snapshot can include any commit that lands after the upload.
 * 2. Export D1 photo references (read-only) after that R2 list:
 *      wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --json --command \
 *        "SELECT i.vin AS vin, e.photos_json AS photos_json FROM vehicle_issue_events e JOIN vehicle_issues i ON i.id = e.issue_id WHERE e.photos_json != '[]'"
 * 3. Dry-run:
 *      node scripts/cleanup-issue-photo-orphans.mjs --ledger photos.json --objects r2.json
 * 4. Delete only after reviewing the report:
 *      node scripts/cleanup-issue-photo-orphans.mjs --ledger photos.json --objects r2.json --delete --confirm-delete
 *
 * Deletion itself is not implemented here — print the keys and require a
 * separate authorized R2 delete so a mistaken flag cannot wipe objects.
 * Re-export a fresh ledger before deleting if the saved exports are older
 * than the grace window.
 */
import { readFileSync } from 'node:fs'
import { findIssuePhotoOrphans, referencedIssuePhotoKeys } from './lib/issue-photo-orphans.mjs'
import { isMainModule } from './lib/is-main.mjs'

function usage() {
  return `Usage:
  node scripts/cleanup-issue-photo-orphans.mjs --ledger <photos.json> --objects <r2.json> [--grace-hours 24] [--delete --confirm-delete]

photos.json: bare rows { vin, photos_json|photos } or a Wrangler d1 --json result set
r2.json: array of { key, uploadedAt }
Default is dry-run. --delete prints keys only; it does not call R2.
List R2 first, then export the ledger, so in-flight commits are not treated as orphans.`
}

function parseArgs(argv) {
  const options = { ledger: null, objects: null, graceHours: 24, delete: false, confirmDelete: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--ledger') options.ledger = argv[++index]
    else if (arg === '--objects') options.objects = argv[++index]
    else if (arg === '--grace-hours') options.graceHours = Number(argv[++index])
    else if (arg === '--delete') options.delete = true
    else if (arg === '--confirm-delete') options.confirmDelete = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function isWranglerResultSet(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && 'success' in value && 'results' in value
}

/** Unwrap Wrangler d1 --json envelopes; never treat the envelope as ledger rows. */
export function loadLedgerRows(path, text = readFileSync(path, 'utf8')) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`${path} is not valid JSON.`)
  }
  if (Array.isArray(raw)) {
    if (raw.length === 1 && isWranglerResultSet(raw[0])) {
      if (raw[0].success !== true || !Array.isArray(raw[0].results)) {
        throw new Error(`${path} does not hold one successful Wrangler result set ("success": true with a "results" array).`)
      }
      return raw[0].results
    }
    if (raw.some(isWranglerResultSet)) {
      throw new Error(`${path} looks like a Wrangler payload but does not hold exactly one result set.`)
    }
    return raw
  }
  if (Array.isArray(raw?.results?.[0]?.results) && raw.results[0].success === true) return raw.results[0].results
  if (Array.isArray(raw?.result?.[0]?.results) && raw.result[0].success === true) return raw.result[0].results
  throw new Error(`${path} must be a JSON array of ledger rows or a Wrangler d1 --json payload.`)
}

export function loadObjectRows(path, text = readFileSync(path, 'utf8')) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`${path} is not valid JSON.`)
  }
  if (!Array.isArray(raw)) throw new Error(`${path} must be a JSON array of R2 objects.`)
  if (raw.some(isWranglerResultSet)) {
    throw new Error(`${path} looks like a Wrangler payload; R2 object lists must be a bare array of { key, uploadedAt }.`)
  }
  return raw
}

export function reportIssuePhotoOrphans({ ledgerRows, objects, graceHours = 24, now = new Date() }) {
  const referenced = referencedIssuePhotoKeys(ledgerRows)
  return findIssuePhotoOrphans(objects, referenced, {
    now,
    graceMs: graceHours * 60 * 60 * 1000,
  })
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return 0
  }
  if (!options.ledger || !options.objects) {
    console.error(usage())
    return 2
  }
  if (!Number.isFinite(options.graceHours) || options.graceHours < 0) {
    console.error('--grace-hours must be a non-negative number.')
    return 2
  }
  if (options.delete && !options.confirmDelete) {
    console.error('Refusing --delete without --confirm-delete. Default remains dry-run.')
    return 2
  }

  const report = reportIssuePhotoOrphans({
    ledgerRows: loadLedgerRows(options.ledger),
    objects: loadObjectRows(options.objects),
    graceHours: options.graceHours,
  })

  console.log(JSON.stringify({
    mode: options.delete ? 'delete_candidates' : 'dry_run',
    graceHours: options.graceHours,
    referencedCount: report.retained.length,
    orphanCount: report.orphans.length,
    skippedRecentCount: report.skippedRecent.length,
    needsReviewCount: report.needsReview.length,
    ignoredCount: report.ignored.length,
    orphans: report.orphans,
    skippedRecent: report.skippedRecent,
    needsReview: report.needsReview,
    note: options.delete
      ? 'Candidates only — delete these keys with an authorized R2 tool after review. This script never calls R2. Re-export a fresh ledger first if the saved files are older than the grace window.'
      : 'Dry-run — no objects were deleted. Objects without a valid uploadedAt are listed under needsReview, not orphans.',
  }, null, 2))
  return 0
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main()
}
