// @ts-nocheck -- Node ESM source utility.
// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDatedInventoryVehicles } from '../../scripts/lib/inventory-worklist.mjs'

const roots: string[] = []
const DATE = '2026-09-21'

function fixture(dealerMailOverrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'inventory-worklist-'))
  roots.push(root)
  const publicDir = path.join(root, 'work', 'inventory-history', 'snapshots')
  const dealerMailDir = path.join(root, 'work', 'dealermail-history', 'snapshots')
  mkdirSync(publicDir, { recursive: true })
  mkdirSync(dealerMailDir, { recursive: true })
  writeFileSync(path.join(publicDir, `${DATE}-public.json`), JSON.stringify({ vehicles: {
    '1FTFW1E50RFA00001': { vin: '1FTFW1E50RFA00001', stock: 'PUBLIC1', make: 'Ford', model: 'F-150', mileage: 100 },
  } }))
  writeFileSync(path.join(dealerMailDir, `${DATE}-complete-used-inventory-deep-cloud-ready.json`), JSON.stringify({
    reportDate: DATE,
    sourceStatus: { authenticatedSession: true },
    completeDealerMailUsedInventory: { rows: [
      { vin: '1FTFW1E50RFA00001', stockNumber: 'CRM-DUPLICATE', makeRaw: 'FORD' },
      { vin: '5LMCJ1DA6RUL15774', stockNumber: 'L14546P', storeCode: 'L', storeName: 'Lincoln', yearRaw: '2024', makeRaw: 'LINC', modelRaw: 'CORSAIR', mileageRaw: '14,695' },
      { vin: 'NOT-A-VIN', stockNumber: 'INVALID' },
    ] },
    ...dealerMailOverrides,
  }))
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('daily current-inventory worklist', () => {
  it('keeps public details and adds current DealerMail-only pre-listing VINs', () => {
    const vehicles = loadDatedInventoryVehicles(fixture(), DATE)
    expect(Object.keys(vehicles).sort()).toEqual(['1FTFW1E50RFA00001', '5LMCJ1DA6RUL15774'])
    expect(vehicles['1FTFW1E50RFA00001']).toMatchObject({ stock: 'PUBLIC1', model: 'F-150', mileage: 100 })
    expect(vehicles['5LMCJ1DA6RUL15774']).toMatchObject({
      stock: 'L14546P', store: 'Lincoln', year: '2024', make: 'LINC', model: 'CORSAIR', mileage: 14695,
      inventorySource: 'dealermail',
    })
  })

  it('fails closed when a present DealerMail snapshot is not authenticated current data', () => {
    expect(() => loadDatedInventoryVehicles(fixture({ sourceStatus: { authenticatedSession: false } }), DATE))
      .toThrow('DEALERMAIL_CURRENT_INVENTORY_INVALID')
  })
})
