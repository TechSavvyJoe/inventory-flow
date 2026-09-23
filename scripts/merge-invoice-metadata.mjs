// Attach only exact-VIN Ford/Lincoln invoice availability to the daily resource
// file. The PDF itself stays outside the release and is uploaded privately.
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { isMainModule } from './lib/is-main.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/
const FORD_MAKES = new Set(['FORD', 'LINC', 'LINCOLN'])
const MAX_PDF_BYTES = 8 * 1024 * 1024
const APP_ROOT = path.resolve(import.meta.dirname, '..')
let resolvedRoot

function workspaceRoot() {
  resolvedRoot ??= resolveWorkspaceRoot(import.meta.url)
  return resolvedRoot
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temporary, file)
}

function exactInvoiceRows(parsed) {
  if (parsed?.schema !== 'ford-invoice-parsed-v1' || !Array.isArray(parsed.results)) {
    throw new Error('INVALID_FORD_INVOICE_PARSE')
  }
  if (typeof parsed.parsedAtUtc !== 'string' || !Number.isFinite(Date.parse(parsed.parsedAtUtc))) {
    throw new Error('INVALID_FORD_INVOICE_CAPTURE_TIME')
  }
  return new Map(parsed.results.flatMap((entry) => {
    const vin = String(entry?.vin ?? '').toUpperCase()
    const printedVin = String(entry?.invoice?.vin ?? '').toUpperCase()
    return entry?.status === 'pdf' && VIN_RE.test(vin) && printedVin === vin ? [[vin, entry]] : []
  }))
}

export function mergeInvoiceMetadata({ enrichment, parsed, vehicles, pdfAvailable = () => true }) {
  if (enrichment?.schemaVersion !== 'inventory-flow-vin-document-enrichment-v1' || !enrichment.recordsByVin || Array.isArray(enrichment.recordsByVin)) {
    throw new Error('INVALID_VIN_DOCUMENT_ENRICHMENT')
  }
  const exactRows = exactInvoiceRows(parsed)
  let removed = 0
  for (const [vin, record] of Object.entries(enrichment.recordsByVin)) {
    if (!record?.fordInvoice) continue
    delete record.fordInvoice
    removed += 1
    if (!Object.keys(record).some((key) => key !== 'vin')) delete enrichment.recordsByVin[vin]
  }

  let attached = 0
  for (const [vin, vehicle] of Object.entries(vehicles)) {
    if (!FORD_MAKES.has(String(vehicle?.make ?? '').toUpperCase()) || !exactRows.has(vin) || !pdfAvailable(vin)) continue
    const record = enrichment.recordsByVin[vin] ?? { vin }
    record.fordInvoice = {
      dataState: 'current',
      available: true,
      capturedAt: exactRows.get(vin).capturedAtUtc ?? parsed.parsedAtUtc,
      sourceLabel: 'Saved Ford factory invoice',
    }
    enrichment.recordsByVin[vin] = record
    attached += 1
  }
  enrichment.recordsByVin = Object.fromEntries(Object.entries(enrichment.recordsByVin).sort(([left], [right]) => left.localeCompare(right)))
  enrichment.generatedAt = new Date().toISOString()
  return { attached, removed }
}

export function main(reportDate = process.argv[2]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '')) throw new Error('usage: merge-invoice-metadata.mjs <YYYY-MM-DD>')
  const root = workspaceRoot()
  const enrichmentPath = path.join(APP_ROOT, 'data', 'vin-document-enrichment.json')
  const invoiceFolder = path.join(root, 'work', 'invoice-history', reportDate)
  const parsedPath = path.join(invoiceFolder, 'parsed.json')
  const enrichment = JSON.parse(readFileSync(enrichmentPath, 'utf8'))
  const parsed = existsSync(parsedPath)
    ? JSON.parse(readFileSync(parsedPath, 'utf8'))
    : { schema: 'ford-invoice-parsed-v1', reportDate, parsedAtUtc: new Date().toISOString(), results: [] }
  if (parsed.reportDate !== reportDate) throw new Error('FORD_INVOICE_DATE_MISMATCH')
  const stats = mergeInvoiceMetadata({
    enrichment,
    parsed,
    vehicles: loadDatedInventoryVehicles(root, reportDate),
    pdfAvailable: (vin) => {
      const file = path.join(invoiceFolder, `${vin}.pdf`)
      if (!existsSync(file)) return false
      const size = statSync(file).size
      return size >= 5 && size <= MAX_PDF_BYTES
    },
  })
  writeJsonAtomic(enrichmentPath, enrichment)
  process.stdout.write(`${JSON.stringify({ reportDate, ...stats })}\n`)
}

if (isMainModule(import.meta.url)) {
  try { main() } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
