import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_PDF_BYTES = 8 * 1024 * 1024

export function savedInvoicePdf(file, expectedSha256 = null) {
  if (!existsSync(file)) return null
  const size = statSync(file).size
  if (size < 8 || size > MAX_PDF_BYTES) return null
  const bytes = readFileSync(file)
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-' ||
      !bytes.subarray(Math.max(0, size - 2048)).toString('latin1').includes('%%EOF')) return null
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (expectedSha256 && sha256 !== expectedSha256) return null
  return { bytes: size, sha256 }
}

export function reusableInvoices(root, reportDate, vins) {
  const wanted = new Set([...vins].filter(vin => VIN_RE.test(vin)))
  const found = new Map()
  const history = path.join(root, 'work', 'invoice-history')
  if (!existsSync(history)) return found
  const dates = readdirSync(history, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && DATE_RE.test(entry.name) && entry.name < reportDate)
    .map(entry => entry.name).sort().reverse()
  for (const sourceReportDate of dates) {
    if (!wanted.size) break
    const folder = path.join(history, sourceReportDate)
    let index, parsed
    try {
      index = JSON.parse(readFileSync(path.join(folder, 'index.json'), 'utf8'))
      parsed = JSON.parse(readFileSync(path.join(folder, 'parsed.json'), 'utf8'))
    } catch { continue }
    if (index.schema !== 'ford-invoice-index-v1' || index.reportDate !== sourceReportDate ||
        parsed.schema !== 'ford-invoice-parsed-v1' || parsed.reportDate !== sourceReportDate ||
        !Array.isArray(index.results) || !Array.isArray(parsed.results)) continue
    const verified = new Set(parsed.results.filter(row => row?.status === 'pdf' && !row.error &&
      row?.invoice?.vin === row?.vin && wanted.has(row.vin)).map(row => row.vin))
    for (const row of index.results) {
      const vin = row?.vin
      if (!verified.has(vin) || row.status !== 'pdf') continue
      const capturedAtUtc = row.capturedAtUtc ?? index.capturedAtUtc
      if (!Number.isFinite(Date.parse(capturedAtUtc)) || capturedAtUtc.slice(0, 10) > reportDate) continue
      const file = path.join(folder, `${vin}.pdf`)
      const pdf = savedInvoicePdf(file, row.sha256)
      if (!pdf || (row.bytes != null && row.bytes !== pdf.bytes)) continue
      found.set(vin, { vin, file, capturedAtUtc, sourceReportDate, ...pdf })
      wanted.delete(vin)
    }
  }
  return found
}
