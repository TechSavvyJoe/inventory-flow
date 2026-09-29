// Upload exact-VIN Ford/Lincoln invoice PDFs to the app's private R2 store.
// Requires the same machine identity and bearer token as the release publisher.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isMainModule } from './lib/is-main.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const PRIVATE_HOSTNAME = 'inventory-ops.joegallant.me'
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/
const MAX_PDF_BYTES = 8 * 1024 * 1024
const APP_ROOT = path.resolve(import.meta.dirname, '..')
let resolvedRoot

function required(name, environment = process.env) {
  const value = environment[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function accessHeaders(environment = process.env) {
  return {
    'CF-Access-Client-Id': required('CF_ACCESS_CLIENT_ID', environment),
    'CF-Access-Client-Secret': required('CF_ACCESS_CLIENT_SECRET', environment),
  }
}

function workspaceRoot() {
  resolvedRoot ??= resolveWorkspaceRoot(import.meta.url)
  return resolvedRoot
}

export function invoicePublicationEndpoint(base, reportDate, vin) {
  const url = new URL(base)
  if (url.protocol !== 'https:' || url.hostname !== PRIVATE_HOSTNAME || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Cloud publish URL must be https://${PRIVATE_HOSTNAME}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !VIN_RE.test(vin)) throw new Error('Invalid invoice publication identity')
  return new URL(`/internal/invoices/${reportDate}/${vin}`, url)
}

export function invoiceFiles({ parsed, enrichment, folder, fileExists = existsSync }) {
  if (parsed?.schema !== 'ford-invoice-parsed-v1' || !Array.isArray(parsed.results)) throw new Error('Invalid Ford invoice parse file')
  if (enrichment?.schemaVersion !== 'inventory-flow-vin-document-enrichment-v1' || !enrichment.recordsByVin) throw new Error('Invalid VIN resource enrichment')
  return parsed.results.flatMap((entry) => {
    const vin = String(entry?.vin ?? '').toUpperCase()
    const resource = enrichment.recordsByVin[vin]?.fordInvoice
    const eligible = entry?.status === 'pdf' && VIN_RE.test(vin) && String(entry?.invoice?.vin ?? '').toUpperCase() === vin &&
      resource?.available === true && resource?.dataState === 'current'
    if (!eligible) return []
    const file = path.join(folder, `${vin}.pdf`)
    // An advertised current document must not disappear from the upload batch
    // and let the daily publisher report successful completion.
    if (!fileExists(file)) throw new Error('INVOICE_DOCUMENT_MISSING')
    return [{ vin, file }]
  })
}

export async function publishInvoiceFile({ reportDate, vin, file, environment = process.env, fetchImpl = fetch }) {
  const pdf = readFileSync(file)
  if (pdf.length < 8 || pdf.length > MAX_PDF_BYTES || pdf.subarray(0, 5).toString('latin1') !== '%PDF-' || !pdf.subarray(Math.max(0, pdf.length - 2048)).toString('latin1').includes('%%EOF')) {
    throw new Error('Captured invoice is not a bounded PDF')
  }
  const response = await fetchImpl(invoicePublicationEndpoint(required('INVENTORY_OPS_CLOUD_URL', environment), reportDate, vin), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${required('INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN', environment)}`,
      'Content-Type': 'application/pdf',
      ...accessHeaders(environment),
    },
    body: pdf,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || !['stored', 'already_stored'].includes(payload.status) || payload.reportDate !== reportDate || payload.vin !== vin) {
    const code = typeof payload?.code === 'string' && /^[A-Z0-9_]+$/.test(payload.code) ? `: ${payload.code}` : ''
    throw new Error(`Invoice upload failed (${response.status}${code})`)
  }
  return payload.status
}

export async function main(reportDate = process.argv[2]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '')) throw new Error('usage: publish-invoice-documents.mjs <YYYY-MM-DD>')
  const root = workspaceRoot()
  const folder = path.join(root, 'work', 'invoice-history', reportDate)
  const parsedPath = path.join(folder, 'parsed.json')
  // Invoice capture and parsing are non-blocking; when they produced nothing
  // there is nothing to upload. Failing here would hold back the pointer
  // advance and archive of an already verified release (merge-invoice-metadata
  // treats the same missing file as an empty day).
  if (!existsSync(parsedPath)) {
    process.stdout.write(`${JSON.stringify({ reportDate, invoices: 0, stored: 0, alreadyStored: 0, skipped: 'no_parsed_invoices' })}\n`)
    return
  }
  const parsed = JSON.parse(readFileSync(parsedPath, 'utf8'))
  const enrichment = JSON.parse(readFileSync(path.join(APP_ROOT, 'data', 'vin-document-enrichment.json'), 'utf8'))
  if (parsed.reportDate !== reportDate) throw new Error('Ford invoice report date mismatch')
  const files = invoiceFiles({ parsed, enrichment, folder })
  let cursor = 0; let stored = 0; let alreadyStored = 0
  const upload = async () => {
    while (cursor < files.length) {
      const item = files[cursor++]
      const status = await publishInvoiceFile({ reportDate, ...item })
      if (status === 'stored') stored += 1
      else alreadyStored += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, upload))
  process.stdout.write(`${JSON.stringify({ reportDate, invoices: files.length, stored, alreadyStored })}\n`)
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Invoice documents were not published: ${error.message}\n`)
    process.exitCode = 1
  })
}
