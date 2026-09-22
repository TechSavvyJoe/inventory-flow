import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/

function datedPublicVehicles(workspaceRoot, reportDate) {
  const snapshotPath = path.join(workspaceRoot, 'work', 'inventory-history', 'snapshots', `${reportDate}-public.json`)
  if (!existsSync(snapshotPath)) throw new Error(`snapshot not found: ${snapshotPath}`)
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  const vehicles = snapshot.vehicles || {}
  const entries = Array.isArray(vehicles)
    ? vehicles.filter((vehicle) => vehicle?.vin).map((vehicle) => [vehicle.vin, vehicle])
    : Object.entries(vehicles)
  return entries.map(([key, vehicle]) => {
    const vin = String(vehicle?.vin || key || '').trim().toUpperCase()
    return [vin, { ...vehicle, vin }]
  }).filter(([vin]) => VIN.test(vin))
}

function dealerMailVehicle(row) {
  const vin = String(row?.vin || '').trim().toUpperCase()
  if (!VIN.test(vin)) return null
  const mileageText = String(row.mileageRaw || '').replace(/[^0-9]/g, '')
  return {
    vin,
    stock: String(row.stockNumber || '').trim(),
    stockNumber: String(row.stockNumber || '').trim(),
    store: String(row.storeName || '').trim(),
    storeCode: String(row.storeCode || '').trim(),
    year: String(row.yearRaw || '').trim(),
    make: String(row.makeRaw || '').trim().toUpperCase(),
    model: String(row.modelRaw || '').trim(),
    mileage: mileageText ? Number(mileageText) : null,
    inventorySource: 'dealermail',
  }
}

/** Current app membership inputs: public website inventory plus current DealerMail rows. */
export function loadDatedInventoryVehicles(workspaceRoot, reportDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate || '')) throw new Error('INVALID_REPORT_DATE')
  const byVin = new Map(datedPublicVehicles(workspaceRoot, reportDate))
  const dealerMailPath = path.join(workspaceRoot, 'work', 'dealermail-history', 'snapshots', `${reportDate}-complete-used-inventory-deep-cloud-ready.json`)
  if (!existsSync(dealerMailPath)) return Object.fromEntries(byVin)

  const dealerMail = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
  const rows = dealerMail.completeDealerMailUsedInventory?.rows
  if (dealerMail.reportDate !== reportDate || dealerMail.sourceStatus?.authenticatedSession !== true || !Array.isArray(rows)) {
    throw new Error('DEALERMAIL_CURRENT_INVENTORY_INVALID')
  }
  for (const row of rows) {
    const vehicle = dealerMailVehicle(row)
    if (vehicle && !byVin.has(vehicle.vin)) byVin.set(vehicle.vin, vehicle)
  }
  return Object.fromEntries(byVin)
}
