// @ts-nocheck -- exercises the plain ESM daily merge helper.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mergeFordServiceHistory } from '../../scripts/merge-ford-service-history.mjs'

const fordVin = '1FMCU9GN8RUA43672'
const lincolnVin = '5LMCJ1DA6RUL15774'
const nonFordVin = '1GNEVGKW2PJ285653'

function repairOrder(overrides = {}) {
  return {
    repairOrderNumber: '123456', dealerCode: '00001', openDate: '04/02/2026', closeDate: '04/03/2026',
    odometer: 28580, detailComplete: true,
    inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' },
    parts: [{ description: 'OIL FILTER', quantity: 1, partNumber: 'AA5Z-6714-A' }],
    laborOperations: [{ code: 'CPOUCI', description: 'CERTIFIED BLUE OVAL INSPECTION' }],
    services: ['Certified Blue Oval inspection', 'Oil and filter service'],
    summary: 'Certified Blue Oval inspection; Oil and filter service.',
    ...overrides,
  }
}

function capture(vin, overrides = {}) {
  const order = repairOrder()
  return {
    vin, checkedAt: '2026-09-21T20:45:00.000Z', result: 'OK', dataState: 'current', historyCaptured: true,
    repairOrderCount: 2, detailScanCount: 1, inspectionSearchStatus: 'confirmed',
    latestRepairOrder: order, recentInspection: order,
    checkedRepairOrders: [{ ...order, privateCaptureOnly: 'must never reach the app' }],
    ...overrides,
  }
}

describe('Ford service-history merge', () => {
  it('adds exact-VIN history to website and DealerMail-only Ford-family inventory', () => {
    const enrichment = {
      schemaVersion: 'inventory-flow-vin-document-enrichment-v1', generatedAt: '2026-09-20T10:00:00Z',
      recordsByVin: {
        [fordVin]: {
          vin: fordVin,
          fordOasis: {
            dataState: 'current', capturedAt: '2026-09-21T19:00:00.000Z', sourceLabel: 'Ford OASIS',
            openActionsCaptured: true, openFieldServiceActions: [], warrantyCoverages: [], extendedCoverageExpirations: [],
          },
        },
      },
    }
    const captures = {
      schema: 'bob-maxey-ford-service-history-v1', reportDate: '2026-09-21',
      records: [capture(fordVin), capture(lincolnVin), capture(nonFordVin)],
    }
    const result = mergeFordServiceHistory({
      enrichment, captures,
      vehicles: {
        [fordVin]: { make: 'Ford' },
        [lincolnVin]: { make: 'LINC', inventorySource: 'dealermail' },
        [nonFordVin]: { make: 'Chevrolet' },
      },
    })

    expect(result.stats).toEqual({ activeFord: 2, attached: 2, created: 1, staleRemoved: 0 })
    expect(enrichment.recordsByVin[fordVin].fordOasis.sourceLabel).toBe('Ford OASIS')
    expect(enrichment.recordsByVin[lincolnVin].fordOasis).toMatchObject({
      dataState: 'current', openActionsCaptured: false,
      serviceHistory: {
        sourceLabel: 'Ford PTS Retail Service Repair History (read-only; no customer data)',
        recentInspection: { openDate: '04/02/2026', closeDate: '04/03/2026' },
      },
    })
    expect(enrichment.recordsByVin[lincolnVin].fordOasis.serviceHistory.checkedRepairOrders).toBeUndefined()
    expect(enrichment.recordsByVin[nonFordVin]).toBeUndefined()
  })

  it('removes stale history when a current exact-VIN capture is unavailable', () => {
    const enrichment = {
      schemaVersion: 'inventory-flow-vin-document-enrichment-v1', generatedAt: '2026-09-20T10:00:00Z',
      recordsByVin: {
        [fordVin]: {
          vin: fordVin,
          fordOasis: {
            dataState: 'current', capturedAt: '2026-09-20T10:00:00Z', openActionsCaptured: false,
            openFieldServiceActions: [], warrantyCoverages: [], extendedCoverageExpirations: [],
            serviceHistory: {
              dataState: 'stale_unverified', checkedAt: '2026-09-20T10:00:00Z', historyCaptured: true,
              repairOrderCount: 0, detailScanCount: 0, inspectionSearchStatus: 'not_identified',
            },
          },
        },
      },
    }
    const result = mergeFordServiceHistory({
      enrichment,
      captures: { schema: 'bob-maxey-ford-service-history-v1', records: [capture(fordVin, { vin: lincolnVin })] },
      vehicles: { [fordVin]: { make: 'Ford' } },
    })
    expect(result.stats).toMatchObject({ attached: 0, staleRemoved: 1 })
    expect(enrichment.recordsByVin[fordVin].fordOasis.serviceHistory).toBeUndefined()
  })
})
