// Stage VIN-bound vAuto equipment PDFs privately before publishing a release.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isMainModule } from './lib/is-main.mjs'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/
const HASH_RE = /^[a-f0-9]{64}$/
const CAI_PATH = /^\/window-stickers\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|pdf)$/i
const MAX_PDF_BYTES = 8 * 1024 * 1024
const PRIVATE_HOSTNAME = 'inventory-ops.joegallant.me'

function required(name, environment) {
  const value = environment[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function approvedEquipmentSource(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'assets.cai-media-management.com' &&
      !url.port && !url.username && !url.password && !url.search && !url.hash && CAI_PATH.test(url.pathname)
  } catch { return false }
}

export function equipmentPublicationEndpoint(base, vin, sha256) {
  const url = new URL(base)
  if (url.protocol !== 'https:' || url.hostname !== PRIVATE_HOSTNAME || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Cloud publish URL must be https://${PRIVATE_HOSTNAME}`)
  }
  if (!VIN_RE.test(vin) || !HASH_RE.test(sha256)) throw new Error('Invalid vAuto document identity')
  return new URL(`/internal/equipment/${vin}/${sha256}`, url)
}

export function equipmentFiles({ index, folder, vehicles, fileExists = existsSync }) {
  if (index?.schema !== 'vauto-equipment-pdf-cache-v1' || !index.byVin || Array.isArray(index.byVin)) throw new Error('Invalid vAuto document index')
  return Object.entries(vehicles).flatMap(([vin]) => {
    const item = index.byVin[vin]
    if (!item || !HASH_RE.test(item.sha256) || !approvedEquipmentSource(item.sourceUrl) ||
        !['printed_vin', 'vauto_exact_vin_image_only'].includes(item.vinVerification)) return []
    const file = path.join(folder, 'objects', `${item.sha256}.pdf`)
    return fileExists(file) ? [{ vin, sha256: item.sha256, sourceUrl: item.sourceUrl, file }] : []
  })
}

export async function stageEquipmentFile({ vin, sha256, sourceUrl, file, environment = process.env, fetchImpl = fetch }) {
  const pdf = readFileSync(file)
  if (pdf.length < 8 || pdf.length > MAX_PDF_BYTES || pdf.subarray(0, 5).toString('latin1') !== '%PDF-' ||
      !pdf.subarray(Math.max(0, pdf.length - 2048)).toString('latin1').includes('%%EOF') ||
      createHash('sha256').update(pdf).digest('hex') !== sha256) throw new Error('Saved vAuto PDF failed integrity check')
  const endpoint = equipmentPublicationEndpoint(required('INVENTORY_OPS_CLOUD_URL', environment), vin, sha256)
  const headers = {
    Authorization: `Bearer ${required('INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN', environment)}`,
    'CF-Access-Client-Id': required('CF_ACCESS_CLIENT_ID', environment),
    'CF-Access-Client-Secret': required('CF_ACCESS_CLIENT_SECRET', environment),
    'X-Inventory-Source-Url': sourceUrl,
  }
  const status = await fetchImpl(endpoint, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000), headers })
  const statusBody = await status.json().catch(() => null)
  if (!status.ok || statusBody?.vin !== vin || statusBody?.sha256 !== sha256 ||
      !['stored', 'missing'].includes(statusBody.status)) throw new Error(`vAuto PDF status check failed (${status.status})`)
  if (statusBody.status === 'stored') return 'already_stored'
  const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000),
    headers: { ...headers, 'Content-Type': 'application/pdf' }, body: pdf })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !['stored', 'already_stored'].includes(payload?.status) ||
      payload.vin !== vin || payload.sha256 !== sha256) throw new Error(`vAuto PDF upload failed (${response.status})`)
  return payload.status
}

export async function main(reportDate = process.argv[2]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '')) throw new Error('usage: publish-vauto-documents.mjs <YYYY-MM-DD>')
  const root = resolveWorkspaceRoot(import.meta.url)
  const folder = path.join(root, 'work', 'vauto-documents')
  const indexPath = path.join(folder, 'index.json')
  if (!existsSync(indexPath)) {
    process.stdout.write(`${JSON.stringify({ reportDate, documents: 0, stored: 0, alreadyStored: 0 })}\n`)
    return
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const files = equipmentFiles({ index, folder, vehicles: loadDatedInventoryVehicles(root, reportDate) })
  let cursor = 0; let stored = 0; let alreadyStored = 0
  const upload = async () => {
    while (cursor < files.length) {
      const status = await stageEquipmentFile(files[cursor++])
      if (status === 'stored') stored += 1
      else alreadyStored += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, upload))
  process.stdout.write(`${JSON.stringify({ reportDate, documents: files.length, stored, alreadyStored })}\n`)
}

if (isMainModule(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`vAuto PDFs were not staged: ${error.message}\n`)
    process.exitCode = 1
  })
}
