// Upload exact-VIN Ford/Lincoln invoice PDFs to the app's private R2 store.
// Requires the same machine identity and bearer token as the release publisher.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isMainModule } from './lib/is-main.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'
import { readRetainedPublication } from './publication-followup-metadata.mjs'

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

// Parsed eligibility and the retained release contract are separate checks. A
// missing parse row must not make an advertised current saved invoice vanish.
export function retainedInvoiceFiles({ bundle, parsed, enrichment, folder, fileExists = existsSync }) {
  const advertisedVins = new Set(bundle.release.vehicles.filter(vehicle => vehicle.resourceRecord?.fordInvoice?.available === true && vehicle.resourceRecord.fordInvoice.dataState === 'current').map(vehicle => String(vehicle.vin ?? '').toUpperCase()))
  const eligible = parsed ? invoiceFiles({ parsed: { ...parsed, results: parsed.results?.filter(entry => advertisedVins.has(String(entry?.vin ?? '').toUpperCase())) }, enrichment, folder, fileExists }) : []
  const byVin = new Map(eligible.map(item => [item.vin, item]))
  return bundle.release.vehicles.flatMap(vehicle => {
    const resource = vehicle.resourceRecord?.fordInvoice
    if (resource?.available !== true || resource?.dataState !== 'current') return []
    const vin = String(vehicle.vin ?? '').toUpperCase()
    const currentResource = enrichment?.recordsByVin?.[vin]?.fordInvoice
    if (!VIN_RE.test(vin) || !byVin.has(vin) || typeof resource.capturedAt !== 'string' || !Number.isFinite(Date.parse(resource.capturedAt)) || currentResource?.capturedAt !== resource.capturedAt) {
      throw new Error('ADVERTISED_INVOICE_NOT_RECONCILED')
    }
    return [byVin.get(vin)]
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

export async function main(reportDate = process.argv[2], { root = workspaceRoot(), appRoot = APP_ROOT, environment = process.env, fetchImpl = fetch } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '')) throw new Error('usage: publish-invoice-documents.mjs <YYYY-MM-DD>')
  const folder = path.join(root, 'work', 'invoice-history', reportDate)
  const parsedPath = path.join(folder, 'parsed.json')
  const receiptPath = path.join(root, 'work', 'app-feed-status', `${reportDate}.json`)
  const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null
  const bundle = readRetainedPublication({ workspaceRoot: root, reportDate, receipt })
  // A zero-document day is valid only when the retained release advertises
  // none. A standalone invocation without a retained release stays compatible.
  if (!existsSync(parsedPath) && !bundle?.release.vehicles.some(vehicle => vehicle.resourceRecord?.fordInvoice?.available === true && vehicle.resourceRecord.fordInvoice.dataState === 'current')) {
    process.stdout.write(`${JSON.stringify({ reportDate, invoices: 0, stored: 0, alreadyStored: 0, skipped: 'no_parsed_invoices' })}\n`)
    return
  }
  if (!existsSync(parsedPath)) throw new Error('ADVERTISED_INVOICE_NOT_RECONCILED')
  const parsed = existsSync(parsedPath) ? JSON.parse(readFileSync(parsedPath, 'utf8')) : null
  const enrichment = JSON.parse(readFileSync(path.join(appRoot, 'data', 'vin-document-enrichment.json'), 'utf8'))
  if (parsed && parsed.reportDate !== reportDate) throw new Error('Ford invoice report date mismatch')
  const files = bundle ? retainedInvoiceFiles({ bundle, parsed, enrichment, folder }) : invoiceFiles({ parsed, enrichment, folder })
  let cursor = 0; let stored = 0; let alreadyStored = 0
  const upload = async () => {
    while (cursor < files.length) {
      const item = files[cursor++]
      const status = await publishInvoiceFile({ reportDate, ...item, environment, fetchImpl })
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
