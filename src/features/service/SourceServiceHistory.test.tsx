import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { FordServiceRepairOrderRecord, ProviderServiceReport, VehicleRecord } from '../../types'
import { SourceServiceHistory, serviceEvidenceSummary } from './SourceServiceHistory'

afterEach(cleanup)

function order(number: string, openDate: string, closeDate: string, services: string[]): FordServiceRepairOrderRecord {
  return {
    repairOrderNumber: number, dealerCode: '00001', openDate, closeDate, odometer: 28100,
    detailComplete: true, inspection: { status: 'not_identified' }, parts: [], laborOperations: [], services,
  }
}

function providerReport(overrides: Partial<ProviderServiceReport> = {}): ProviderServiceReport {
  return {
    vin: 'TESTDATASERVICE01', provider: 'carfax', sourceLabel: 'CARFAX', capturedAt: '2026-09-21T20:45:00.000Z',
    dataState: 'current', historyStatus: 'reported',
    entries: [{ date: '2026-09-10', odometer: 28100, odometerUnit: 'mi', services: ['Oil and filter changed'] }],
    ...overrides,
  }
}

describe('source service history', () => {
  it.each(['Chevrolet', 'Ford'])('shows CARFAX-only service evidence for %s independently of service readiness and OEM history', (make) => {
    const vehicle = { vin: 'TESTDATAHWELL0002', make, serviceHistory: { reports: [providerReport({ vin: 'TESTDATAHWELL0002' })] }, serviceReadiness: { status: 'needs_service' } } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/TESTDATASERVICE01?tab=data" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'CARFAX service records' })).toBeVisible()
    expect(screen.getByText('Oil and filter changed')).toBeVisible()
    expect(screen.getByText('Current report')).toBeVisible()
    expect(screen.getByText('History reports may be incomplete. Recorded visits do not confirm current reconditioning or Ready status.')).toBeVisible()
    expect(screen.queryByText('No AutoCheck service or inspection detail was captured.')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View in Records' })).toHaveAttribute('href', '/inventory/vehicle/TESTDATASERVICE01?tab=data')
    if (make === 'Ford') {
      expect(screen.queryByText('Ford has not reported a dealer service history for this vehicle.')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open Ford history' })).toHaveAttribute('href', expect.stringContaining('ford'))
    }
    expect(serviceEvidenceSummary(vehicle)).toBe('CARFAX · 1 reported event')
    expect(vehicle.serviceReadiness?.status).toBe('needs_service')
  })

  it('prioritizes current provider events and keeps retained history explicitly unverified', async () => {
    const vehicle = { vin: 'TESTDATASERVICE01', make: 'Chevrolet', serviceHistory: { reports: [
      providerReport({ provider: 'autocheck', sourceLabel: 'AutoCheck', dataState: 'stale_unverified', entries: [{ date: '2026-09-01', services: ['Battery replaced'] }] }),
      providerReport(),
    ] } } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/TESTDATASERVICE01?tab=data" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'CARFAX service records' })).toBeVisible()
    expect(screen.getByText('Battery replaced')).not.toBeVisible()
    const retainedDisclosure = screen.getByText('AutoCheck · 1 reported events · Retained report · unverified')
    expect(retainedDisclosure).toBeVisible()
    await userEvent.setup().click(retainedDisclosure)
    expect(screen.getByText('Battery replaced')).toBeVisible()
    expect(screen.getByText('Retained report · unverified')).toBeVisible()
    expect(serviceEvidenceSummary(vehicle)).toBe('CARFAX · 1 reported event')
  })

  it('uses a retained report with events before a current report without events, without hiding its state', () => {
    const vehicle = { vin: 'TESTDATASERVICE01', make: 'Chevrolet', serviceHistory: { reports: [
      providerReport({ provider: 'autocheck', sourceLabel: 'AutoCheck', entries: [], historyStatus: 'not_reported' }),
      providerReport({ dataState: 'stale_unverified' }),
    ] } } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/TESTDATASERVICE01?tab=data" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'CARFAX service records' })).toBeVisible()
    expect(screen.getByText('Retained report · unverified')).toBeVisible()
    expect(serviceEvidenceSummary(vehicle)).toBe('CARFAX · 1 reported event · Retained report · unverified')
  })

  it.each(['stale_unverified', 'current'] as const)('prefers current CARFAX evidence over retained outer Ford data with %s inner history', (innerState) => {
    const vehicle = { vin: 'TESTDATASERVICE01', make: 'Ford', serviceHistory: { reports: [providerReport()] },
      fordOasis: { dataState: 'stale_unverified', serviceHistory: { dataState: innerState, repairOrderCount: 3, historyCaptured: true,
        recentRepairOrders: [order('SYNTHETIC', '09/11/2026', '09/12/2026', ['Battery service'])],
      } },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/TESTDATASERVICE01?tab=data" /></MemoryRouter>)
    expect(screen.getByText('CARFAX service history')).toBeVisible()
    expect(screen.getByRole('region', { name: 'CARFAX service records' })).toBeVisible()
    expect(screen.getByText('3 service visits reported')).toBeVisible()
    const attribution = screen.getByRole('heading', { name: 'Ford OASIS service history · Retained report · unverified' })
    expect(attribution).toBeVisible()
    const work = screen.getByRole('list', { name: 'Completed service items' })
    expect(work).toBeVisible()
    expect(attribution.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Retained report · unverified')).toBeVisible()
    expect(serviceEvidenceSummary(vehicle)).toBe('CARFAX · 1 reported event')
    expect(serviceEvidenceSummary({ ...vehicle, serviceHistory: undefined })).toBe('3 Ford service visits reported · Retained report · unverified')
  })

  it('keeps current OEM history primary while retaining independent CARFAX evidence', async () => {
    const vehicle = { vin: 'TESTDATAHWELL0002', make: 'Ford', serviceHistory: { reports: [providerReport()] },
      fordOasis: { dataState: 'current', serviceHistory: { dataState: 'current', repairOrderCount: 2, historyCaptured: true,
        recentRepairOrders: [order('SYNTHETIC', '09/11/2026', '09/12/2026', ['Battery service'])],
      } },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/TESTDATAHWELL0002?tab=data" /></MemoryRouter>)
    expect(screen.getByText('Ford dealer repair history')).toBeVisible()
    expect(screen.getByText('Battery service completed')).toBeVisible()
    expect(screen.getByText('Oil and filter changed')).not.toBeVisible()
    await userEvent.setup().click(screen.getByText('CARFAX · 1 reported events'))
    expect(screen.getByRole('region', { name: 'CARFAX service records' })).toBeVisible()
    expect(screen.getByText('Oil and filter changed')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute('href', expect.stringContaining('ford'))
    expect(serviceEvidenceSummary(vehicle)).toBe('2 Ford service visits reported')
  })

  it.each([
    ['current', 'not_reported', 'No service events reported', 'Current report'],
    ['incomplete', 'unavailable', 'Service history unavailable', 'Incomplete report'],
    ['unknown', 'unavailable', 'Service history unavailable', 'Unverified report'],
  ] as const)('labels empty %s provider evidence truthfully', (dataState, historyStatus, summary, label) => {
    const vehicle = { vin: 'TESTDATASERVICE01', make: 'Chevrolet', serviceHistory: { reports: [providerReport({ dataState, historyStatus, entries: [] })] } } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/TESTDATASERVICE01?tab=data" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'CARFAX service records' })).toBeVisible()
    expect(screen.getByText(label)).toBeVisible()
    expect(screen.getByText(historyStatus === 'not_reported' ? 'No service events reported by this source.' : 'Service history unavailable from this source.')).toBeVisible()
    expect(serviceEvidenceSummary(vehicle)).toBe(`CARFAX · ${summary}${dataState === 'current' ? '' : ` · ${label}`}`)
  })

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

  it('preserves qualifying AutoCheck inspection evidence alongside current CARFAX history', () => {
    const vehicle = {
      vin: 'TESTDATAHWELL0002', make: 'Chevrolet',
      serviceHistory: { reports: [providerReport()] },
      autoCheckReport: { dataState: 'current', recentInspection: { date: '2026-09-12', types: ['Multiple Point Vehicle Inspection'] } },
      serviceReadiness: { status: 'serviced', readinessEvidence: { source: 'autocheck', inspectionDate: '2026-09-12', types: ['Multiple Point Vehicle Inspection'] } },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/TESTDATAHWELL0002?tab=data" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'CARFAX service records' })).toBeVisible()
    expect(screen.getByText('Oil and filter changed')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'AutoCheck service and inspection evidence' })).toBeVisible()
    expect(screen.getByText('Inspection since intake')).toBeVisible()
    expect(screen.getByText('09/12/2026')).toBeVisible()
    expect(screen.getByText('Multiple Point Vehicle Inspection')).toBeVisible()
    expect(screen.queryByText('No AutoCheck service or inspection detail was captured.')).not.toBeInTheDocument()
    expect(screen.queryByText('No inspection since intake was identified in the captured report.')).not.toBeInTheDocument()
    expect(serviceEvidenceSummary(vehicle)).toBe('AutoCheck inspection · 09/12/2026')
    expect(screen.getByText('History reports may be incomplete. Recorded visits do not confirm current reconditioning or Ready status.')).toBeVisible()
    expect(vehicle.serviceReadiness?.status).toBe('serviced')
  })

  it('keeps historical AutoCheck inspection evidence separate from current CARFAX history and readiness', () => {
    const vehicle = {
      vin: 'TESTDATAHWELL0002', make: 'Chevrolet', serviceHistory: { reports: [providerReport()] },
      autoCheckReport: { dataState: 'current', recentInspection: { date: '2025-09-15', types: ['Vehicle Inspected'] } },
      serviceReadiness: { status: 'needs_service', readinessEvidence: null },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/TESTDATAHWELL0002?tab=data" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'CARFAX service records' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'AutoCheck service and inspection evidence' })).toBeVisible()
    expect(screen.getByText(/Historic AutoCheck inspection details remain available/i)).toBeVisible()
    expect(screen.queryByText('Inspection since intake')).not.toBeInTheDocument()
    expect(screen.queryByText('09/15/2025')).not.toBeInTheDocument()
    expect(screen.queryByText('No inspection since intake was identified in the captured report.')).not.toBeInTheDocument()
    expect(serviceEvidenceSummary(vehicle)).toBe('CARFAX · 1 reported event')
    expect(vehicle.serviceReadiness?.status).toBe('needs_service')
  })

  it('attributes legacy AutoCheck service-only evidence alongside CARFAX history', () => {
    const vehicle = {
      vin: 'TESTDATAHWELL0002', make: 'Chevrolet', serviceHistory: { reports: [providerReport()] },
      autoCheckReport: { dataState: 'current', checks: [{ label: 'Service / Repair', status: 'No Issue', detail: '13 Service Records Reported' }] },
      serviceReadiness: { status: 'needs_service', readinessEvidence: null },
    } as VehicleRecord
    render(<MemoryRouter><SourceServiceHistory vehicle={vehicle} recordsHref="/inventory/vehicle/TESTDATAHWELL0002?tab=data" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'CARFAX service records' })).toBeVisible()
    const attribution = screen.getByRole('heading', { name: 'AutoCheck service and inspection evidence' })
    expect(attribution).toBeVisible()
    const records = screen.getByText('13 Service Records Reported')
    expect(records).toBeVisible()
    expect(attribution.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('No inspection since intake was identified in the captured report.')).not.toBeInTheDocument()
    expect(serviceEvidenceSummary(vehicle)).toBe('CARFAX · 1 reported event')
    expect(vehicle.serviceReadiness?.status).toBe('needs_service')
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
