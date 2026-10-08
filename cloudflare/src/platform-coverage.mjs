// Project only validated aggregate counters. Never expose raw release metadata.
export const COVERAGE_COUNT_KEYS = [
  'vehicleCount', 'publicRowCount', 'dealerMailRowCount', 'dealerMailVinReconciledCount',
  'dealerMailVinReviewCount', 'activeInventoryCount', 'resourceRecordCount',
  'fordInvoiceRecordCount', 'fordOasisRecordCount', 'warrantyCheckRecordCount', 'warningCount',
]
const count = value => Number.isSafeInteger(value) && value >= 0
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function storedPublicationCoverage(release, storeKeys = []) {
  let metadata
  try { metadata = JSON.parse(release?.metadata_json) } catch { return undefined }
  if (!object(metadata)) return undefined
  const counts = Object.fromEntries(COVERAGE_COUNT_KEYS.filter(key => count(metadata[key])).map(key => [key, metadata[key]]))
  const stores = [...new Set(storeKeys)].flatMap(storeKey => {
    const values = {}
    for (const [source, target] of [['publicStoreCounts', 'publicCount'], ['crmStoreCounts', 'crmCount'], ['activeStoreCounts', 'activeInventoryCount']]) {
      const totals = metadata[source]
      if (object(totals) && Object.hasOwn(totals, storeKey) && count(totals[storeKey])) values[target] = totals[storeKey]
    }
    return Object.keys(values).length ? [{ storeKey, ...values }] : []
  })
  return { basis: 'stored_publication', reportDate: release.report_date ?? null, publishedAt: release.published_at ?? null, counts, stores }
}
