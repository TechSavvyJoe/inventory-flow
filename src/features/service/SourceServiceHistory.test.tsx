import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { FordServiceRepairOrderRecord, VehicleRecord } from '../../types'
import { SourceServiceHistory, serviceEvidenceSummary } from './SourceServiceHistory'

function order(number: string, openDate: string, closeDate: string, services: string[]): FordServiceRepairOrderRecord {
  return {
    repairOrderNumber: number, dealerCode: '00001', openDate, closeDate, odometer: 28100,
    detailComplete: true, inspection: { status: 'not_identified' }, parts: [], laborOperations: [], services,
  }
}

describe('source service history', () => {
  it('shows recent Ford work without exposing repair-order or dealer identifiers', () => {
    const recent = [
      order('123456', '09/01/2026', '09/03/2026', ['Oil and filter service', 'Brake inspection/service']),
      order('123012', '05/10/2026', '05/10/2026', ['Tire inspection/service']),
    ]
    const vehicle = {
      vin: '1FMCU9GN8RUA43672', make: 'Ford',
      fordOasis: { serviceHistory: {
        dataState: 'current', checkedAt: '2026-09-21T20:45:00.000Z', historyCaptured: true,
        repairOrderCount: 7, detailScanCount: 2, inspectionSearchStatus: 'not_identified',
        latestRepairOrder: recent[0], recentRepairOrders: recent,
      } },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/1FMCU9GN8RUA43672?tab=data" /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Vehicle service records' })).toBeVisible()
    expect(screen.getByText('7 repair orders reported')).toBeVisible()
    expect(screen.getByText('Oil and filter service')).toBeVisible()
    expect(screen.getByText('Tire inspection/service')).toBeVisible()
    expect(screen.queryByText('123456')).not.toBeInTheDocument()
    expect(screen.queryByText('00001')).not.toBeInTheDocument()
  })

  it('uses AutoCheck service and inspection evidence for a non-Ford vehicle', () => {
    const vehicle = {
      vin: '1GNEVGKW2PJ285653', make: 'Chevrolet',
      autoCheckReport: {
        dataState: 'current', checks: [{ label: 'Service / Repair', status: 'No Issue', detail: '13 Service Records Reported' }],
        recentInspection: { date: '2026-09-10', types: ['Vehicle Inspected', 'Multiple Point Vehicle Inspection'] },
      },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/1GNEVGKW2PJ285653?tab=data" /></MemoryRouter>)
    expect(screen.getByText('13 Service Records Reported')).toBeVisible()
    expect(screen.getByText('09/10/2026')).toBeVisible()
    expect(screen.getByText('Vehicle Inspected · Multiple Point Vehicle Inspection')).toBeVisible()
    expect(serviceEvidenceSummary(vehicle)).toBe('AutoCheck inspection · 09/10/2026')
  })
})
