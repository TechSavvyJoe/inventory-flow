import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { premiumVehicle } from './premium-test-helpers'
import { ProviderEvidence } from '../../src/features/inventory/ProviderEvidence'
import { ServiceHistory } from '../../src/features/inventory/ServiceHistory'
import { VehicleDocuments } from '../../src/features/inventory/VehicleDocuments'
import { vehicleOperationalStatus } from '../../src/features/inventory/InventoryTable'
import { matchesInventoryQuickView } from '../../src/features/inventory/inventory-quick-views'
import type { OperationalProviderRecord, ProviderServiceReport } from '../../src/types'
import { calculatedWarrantyMiles } from '../../extension/sidepanel/lib/vehicle-rules-core.mjs'

afterEach(cleanup)
const source: OperationalProviderRecord = { vin: 'TESTDATAHWELL0001', provider: 'demo-crm', sourceLabel: 'Synthetic CRM', capturedAt: '2026-08-30T14:00:00Z', dataState: 'current', readOnly: true, complete: true, holdState: 'held' }
const report: ProviderServiceReport = { vin: source.vin, provider: 'carfax', sourceLabel: 'Synthetic CARFAX', capturedAt: source.capturedAt, dataState: 'current', historyStatus: 'reported', entries: [{ date: '2026-07-12', odometer: 21000, odometerUnit: 'mi', services: ['Synthetic oil and filter service'] }] }

describe('provider-neutral vehicle evidence', () => {
  it('shows source holds in Held and excludes No hold without relabeling DealerMail', () => {
    const vehicle = premiumVehicle({ operationalEvidence: { records: [source] }, dealerMail: { dataState: 'unavailable', hasActiveHold: null } })
    const context = { scope: 'group' as const, homeStore: { id: 'howell', name: 'Howell' } }
    expect(matchesInventoryQuickView(vehicle, 'held', context)).toBe(true)
    expect(matchesInventoryQuickView(vehicle, 'no-hold', context)).toBe(false)
    expect(vehicleOperationalStatus(vehicle).label).toBe('Imported hold observed')
    expect(vehicle.dealerMail.hasActiveHold).toBeNull()
    render(<ProviderEvidence vehicle={vehicle} />)
    expect(screen.getByText('Synthetic CRM')).toBeInTheDocument()
    expect(screen.queryByText('DealerMail')).not.toBeInTheDocument()
  })
  it('keeps retained holds findable while clearly unverified, and avoids connection claims for empty evidence', () => {
    const vehicle = premiumVehicle({ operationalEvidence: { records: [{ ...source, dataState: 'stale_unverified' }] } })
    expect(vehicleOperationalStatus(vehicle).label).toBe('Hold status not verified')
    render(<ProviderEvidence vehicle={vehicle} />)
    expect(screen.getByText('Retained report · unverified')).toBeInTheDocument()
    cleanup()
    render(<ProviderEvidence vehicle={premiumVehicle({ operationalEvidence: { records: [] } })} />)
    expect(screen.getByRole('region', { name: 'Imported inventory evidence' })).toHaveTextContent('No imported observations supplied. Inventory Flow controls remain available.')
  })
  it('displays supplied CARFAX service events without declaring Ready or complete lifetime history', () => {
    render(<ServiceHistory vehicle={premiumVehicle({ fordOasis: null, serviceHistory: { reports: [report] } })} />)
    const records = screen.getByRole('region', { name: 'Synthetic CARFAX service records' })
    expect(records).toHaveTextContent('Synthetic oil and filter service')
    expect(records).toHaveTextContent('21,000 mi')
    expect(screen.getByText(/Recorded visits do not confirm current reconditioning or Ready status/)).toBeInTheDocument()
    expect(screen.queryByText('Service ready')).not.toBeInTheDocument()
  })
  it('does not invent rows from not-reported reports or hide alternate source history', () => {
    render(<ServiceHistory vehicle={premiumVehicle({ serviceHistory: { reports: [report, { ...report, provider: 'autocheck', sourceLabel: 'Synthetic AutoCheck', historyStatus: 'not_reported', entries: [] }] } })} />)
    expect(screen.getByText('Synthetic AutoCheck · 0 reported events')).toBeInTheDocument()
    expect(screen.getByText('No service events reported by this source.')).toBeInTheDocument()
    expect(screen.getAllByText('Synthetic oil and filter service')).toHaveLength(1)
  })
  it('preserves every supplied CARFAX factory coverage row without inventing missing balances or report links', () => {
    render(<VehicleDocuments vehicle={premiumVehicle({ mileage: 25000, fordOasis: null, autoCheckReport: null, windowSticker: null, factoryEquipment: null, warrantyCheck: {
      dataState: 'current', mileageEntered: 21000, autoCheck: null, fordOasis: null,
      carfax: { coverages: [
        { type: 'Basic Warranty', termText: 'Unknown', remainingMilesText: 'Unknown', remainingTimeText: 'Unknown', status: 'EXPIRED' },
        { type: 'Powertrain', termText: '5 years / 60000 miles', termMiles: 60000, remainingMilesText: '39000 miles', remainingTimeText: '18 months', status: 'ACTIVE' },
        { type: 'Corrosion', termText: 'Unknown', remainingMilesText: 'Unknown', remainingTimeText: 'Unknown', status: 'N/A' },
      ] },
    } })} />)
    expect(screen.getByText('CARFAX estimate')).toBeInTheDocument()
    const coverage = within(screen.getByRole('table', { name: 'Remaining factory warranty by coverage' }))
    expect(coverage.getByText('Basic Warranty')).toBeInTheDocument()
    expect(coverage.getByText('Powertrain')).toBeInTheDocument()
    expect(coverage.getByText('Corrosion')).toBeInTheDocument()
    expect(coverage.getByText('39000 miles')).toBeInTheDocument()
    expect(coverage.getByText('18 months')).toBeInTheDocument()
    expect(coverage.getByRole('columnheader', { name: 'Calculated miles left' })).toBeInTheDocument()
    expect(coverage.getByText('35,000 mi')).toBeInTheDocument()
    expect(within(coverage.getByRole('row', { name: /Corrosion/ })).getAllByText('Unknown')).toHaveLength(4)
    expect(screen.getByText(/Title, ownership and manufacturer restrictions may affect eligibility/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /CARFAX|AutoCheck/ })).not.toBeInTheDocument()
  })
  it.each([
    [{ termMiles: 60000 }, 25000, 35000],
    [{ termMiles: 60000 }, 65000, 0],
    [{ termMiles: 60000 }, 0, 60000],
    [{ termMiles: null }, 25000, null],
    [{ termMiles: 60000 }, null, null],
    [{ termMiles: 60000, unlimitedMiles: true }, 25000, null],
    [{ termMiles: -1 }, 25000, null],
    [{ termMiles: 60000 }, -1, null],
    [{ termMiles: Infinity }, 25000, null],
  ])('calculates mileage only from a valid explicit limit and current odometer (%j, %s)', (coverage, mileage, expected) => {
    expect(calculatedWarrantyMiles(coverage, mileage)).toBe(expected)
  })
})
