#!/usr/bin/env node
/**
 * Operator helper: report (and optionally delete) unreferenced encrypted issue
 * photos in R2. Default is dry-run. Never deletes a key present in D1 history.
 *
 * Inputs are saved JSON files so this script never needs live credentials in
 * unit tests. Operator steps:
 *
 * 1. Export D1 photo references (read-only):
 *      wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --json --command \
 *        "SELECT i.vin AS vin, e.photos_json AS photos_json FROM vehicle_issue_events e JOIN vehicle_issues i ON i.id = e.issue_id WHERE e.photos_json != '[]'"
 * 2. List R2 keys under vehicle-issues/ into a JSON array of
 *    { "key": "...", "uploadedAt": "ISO-8601" }.
 * 3. Dry-run:
 *      node scripts/cleanup-issue-photo-orphans.mjs --ledger photos.json --objects r2.json
 * 4. Delete only after reviewing the report:
 *      node scripts/cleanup-issue-photo-orphans.mjs --ledger photos.json --objects r2.json --delete --confirm-delete
 *
 * Deletion itself is not implemented here — print the keys and require a
 * separate authorized R2 delete so a mistaken flag cannot wipe objects.
 */
import { readFileSync } from 'node:fs'
import { findIssuePhotoOrphans, referencedIssuePhotoKeys } from './lib/issue-photo-orphans.mjs'
import { isMainModule } from './lib/is-main.mjs'

function usage() {
  return `Usage:
  node scripts/cleanup-issue-photo-orphans.mjs --ledger <photos.json> --objects <r2.json> [--grace-hours 24] [--delete --confirm-delete]

photos.json: array of { vin, photos_json|photos }
r2.json: array of { key, uploadedAt? }
Default is dry-run. --delete prints keys only; it does not call R2.`
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

function loadJson(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  // Wrangler d1 --json wraps results; accept either a bare array or the first result set.
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.results?.[0]?.results)) return raw.results[0].results
  if (Array.isArray(raw?.result?.[0]?.results)) return raw.result[0].results
  throw new Error(`${path} must be a JSON array of rows or a Wrangler d1 --json payload.`)
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
    ledgerRows: loadJson(options.ledger),
    objects: loadJson(options.objects),
    graceHours: options.graceHours,
  })

  console.log(JSON.stringify({
    mode: options.delete ? 'delete_candidates' : 'dry_run',
    graceHours: options.graceHours,
    referencedCount: report.retained.length,
    orphanCount: report.orphans.length,
    skippedRecentCount: report.skippedRecent.length,
    ignoredCount: report.ignored.length,
    orphans: report.orphans,
    skippedRecent: report.skippedRecent,
    note: options.delete
      ? 'Candidates only — delete these keys with an authorized R2 tool after review. This script never calls R2.'
      : 'Dry-run — no objects were deleted.',
  }, null, 2))
  return 0
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main()
}
