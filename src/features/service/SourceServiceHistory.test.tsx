import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('shows a useful Ford service timeline without exposing repair-order or dealer identifiers', async () => {
    const user = userEvent.setup()
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
        repairOrderTimeline: [
          { openDate: '09/01/2026', closeDate: '09/03/2026', odometer: 28100, services: recent[0].services },
          { openDate: '05/10/2026', closeDate: '05/10/2026', odometer: 28100, services: recent[1].services },
          { openDate: '02/11/2026', closeDate: '02/12/2026', odometer: 25000 },
          { openDate: '11/10/2025', closeDate: '11/12/2025', odometer: 22000 },
        ],
      } },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/1FMCU9GN8RUA43672?tab=data" /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Vehicle service records' })).toBeVisible()
    expect(screen.getByText('7 service visits reported')).toBeVisible()
    expect(screen.getByText('2 visits with work documented')).toBeVisible()
    expect(screen.getByText('Oil and filter changed')).toBeVisible()
    expect(screen.getByText('Tires inspected or serviced')).toBeVisible()
    expect(screen.queryByText(/11\/10\/2025/)).not.toBeInTheDocument()
    expect(screen.getByText('Ford reported these visits by date and mileage; itemized work was not available from the source.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'View 2 additional reported visits' }))
    await waitFor(() => expect(screen.getByText(/11\/10\/2025/)).toBeVisible())
    expect(screen.queryByText('Dealer service visit recorded')).not.toBeInTheDocument()
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
      serviceReadiness: {
        status: 'serviced',
        readinessEvidence: { source: 'autocheck', inspectionDate: '2026-09-10', types: ['Vehicle Inspected', 'Multiple Point Vehicle Inspection'] },
      },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/1GNEVGKW2PJ285653?tab=data" /></MemoryRouter>)
    expect(screen.getByText('13 Service Records Reported')).toBeVisible()
    expect(screen.getByText('09/10/2026')).toBeVisible()
    expect(screen.getByText('Vehicle Inspected · Multiple Point Vehicle Inspection')).toBeVisible()
    expect(serviceEvidenceSummary(vehicle)).toBe('AutoCheck inspection · 09/10/2026')
  })

  it('keeps a pre-intake AutoCheck inspection in the full report without presenting it as current service work', () => {
    const vehicle = {
      vin: '3GCPYBEH3LG376449', make: 'Chevrolet',
      autoCheckReport: {
        dataState: 'current', checks: [{ label: 'Service / Repair', status: 'No Issue', detail: '21 Service Records Reported' }],
        recentInspection: { date: '2025-09-15', types: ['Vehicle Inspected'] },
      },
      serviceReadiness: { status: 'needs_service', readinessEvidence: null },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/3GCPYBEH3LG376449?tab=data" /></MemoryRouter>)
    expect(screen.getByText('21 Service Records Reported')).toBeVisible()
    expect(screen.getByText(/Historic AutoCheck inspection details remain available/i)).toBeVisible()
    expect(screen.queryByText('09/15/2025')).not.toBeInTheDocument()
    expect(serviceEvidenceSummary(vehicle)).toBe('21 Service Records Reported')
  })
})
