// Follow-ups must reconcile the exact retained publication, never a new candidate.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cloudBundleSha256 } from './publish-cloud-release.mjs'
import { isMainModule } from './lib/is-main.mjs'

const STORES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/

export function assertRetainedPublication({ bundle, receipt, reportDate }) {
  if (bundle?.complete !== true || bundle.reportDate !== reportDate || bundle.release?.reportDate !== reportDate || !Array.isArray(bundle.release.vehicles)) {
    throw new Error('RETAINED_RELEASE_INVALID')
  }
  if (receipt && (receipt.status !== 'published_and_verified' || receipt.complete !== true || receipt.reportDate !== reportDate ||
      typeof receipt.verifiedAt !== 'string' || !Number.isFinite(Date.parse(receipt.verifiedAt)) ||
      cloudBundleSha256(bundle) !== String(receipt.bundleSha256 ?? '').toLowerCase())) {
    throw new Error('RETAINED_RELEASE_RECEIPT_MISMATCH')
  }
  return bundle
}

export function readRetainedPublication({ workspaceRoot, reportDate, receipt = null, required = false }) {
  const file = path.join(workspaceRoot, 'work', 'releases', reportDate, 'inventory-flow-release.json')
  if (!existsSync(file)) {
    if (required || receipt) throw new Error('RETAINED_RELEASE_MISSING')
    return null
  }
  return assertRetainedPublication({ bundle: JSON.parse(readFileSync(file, 'utf8')), receipt, reportDate })
}

export function integrationExpectedMetadata({ bundle, receipt, reportDate }) {
  assertRetainedPublication({ bundle, receipt, reportDate })
  if (!receipt) throw new Error('VERIFIED_RECEIPT_REQUIRED')
  const publicStoresByVin = new Map()
  const byStore = Object.fromEntries(STORES.map(store => [store, 0]))
  for (const vehicle of bundle.release.vehicles) {
    const row = vehicle.publicRecord
    if (!row) continue // DealerMail-only pre-listing rows are outside this API.
    const vin = String(row.vin ?? '').toUpperCase()
    if (!VIN.test(vin) || !STORES.includes(row.store) || publicStoresByVin.has(vin)) throw new Error('RETAINED_PUBLIC_COUNTS_INVALID')
    publicStoresByVin.set(vin, row.store)
    byStore[row.store] += 1
  }
  if (receipt.counts?.publicRowCount !== publicStoresByVin.size || STORES.some(store => receipt.counts?.publicStoreCounts?.[store] !== byStore[store])) {
    throw new Error('VERIFIED_RECEIPT_STORE_COUNTS_INVALID')
  }
  const excluded = new Set()
  for (const record of bundle.release.managerDispositionOverlay?.records ?? []) {
    const vin = String(record?.vin ?? '').toUpperCase()
    if (record?.deliveredManagerLog === true && record?.matchMethod === 'vin' && VIN.test(vin) &&
        !['matched_vin_stock_review', 'stock_ambiguous'].includes(record?.matchStatus) && publicStoresByVin.has(vin)) excluded.add(vin)
  }
  for (const vin of excluded) byStore[publicStoresByVin.get(vin)] -= 1
  const total = publicStoresByVin.size - excluded.size
  if (total <= 0) throw new Error('VERIFIED_RECEIPT_STORE_COUNTS_INVALID')
  return { bundleSha256: receipt.bundleSha256.toLowerCase(), total, byStore }
}

export function main(workspaceRoot = process.argv[2], reportDate = process.argv[3]) {
  if (!workspaceRoot || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '')) throw new Error('FOLLOWUP_IDENTITY_INVALID')
  const receipt = JSON.parse(readFileSync(path.join(workspaceRoot, 'work', 'app-feed-status', `${reportDate}.json`), 'utf8'))
  const bundle = readRetainedPublication({ workspaceRoot, reportDate, receipt, required: true })
  process.stdout.write(`${JSON.stringify(integrationExpectedMetadata({ bundle, receipt, reportDate }))}\n`)
}

if (isMainModule(import.meta.url)) {
  try { main() } catch {
    process.stderr.write('RETAINED_RELEASE_FOLLOWUP_METADATA_FAILED\n')
    process.exitCode = 1
  }
}
