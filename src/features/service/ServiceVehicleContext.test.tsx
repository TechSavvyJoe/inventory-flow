import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { VehicleRecord } from '../../types'
import { ServiceVehicleContext } from './ServiceVehicleContext'

afterEach(cleanup)
function show(overrides: Partial<VehicleRecord> = {}) {
  const vehicle = { vin: 'TESTDATAHWELL0001', ...overrides } as VehicleRecord
  return render(<MemoryRouter><ServiceVehicleContext vehicle={vehicle} recordsHref="/inventory?vin=TESTDATAHWELL0001&tab=data" /></MemoryRouter>)
}
describe('Service vehicle reference', () => {
  it('does not turn missing OASIS or legacy empty actions into a clean result', () => {
    const view = show()
    expect(screen.getByText('OASIS reference unavailable')).toBeVisible()
    expect(screen.getByText('Service action result not captured')).toBeVisible()
    view.unmount()
    show({ fordOasis: { openFieldServiceActions: [] } })
    expect(screen.getByText('Service action result not captured')).toBeVisible()
    expect(screen.queryByText(/No open service/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Saved Ford service actions' })).not.toBeInTheDocument()
  })
  it('shows confirmed zero only for a dated complete capture', () => {
    show({ fordOasis: { dataState: 'current', capturedAt: '2024-01-01', openActionsCaptured: true, openFieldServiceActions: [] } })
    expect(screen.getByText('No open service actions listed')).toBeVisible()
  })
  it('retains every partial positive action and Records reference when the source is unavailable', () => {
    show({ fordOasis: { dataState: 'unknown', openActionsCaptured: false, openFieldServiceActions: [
      { code: 'DEMO-1', description: 'Inspect only if condition A is present' },
      { code: 'DEMO-2', description: 'Additional service program, not a recall' },
    ] } })
    expect(screen.getByRole('region', { name: 'Saved Ford service actions' })).toHaveTextContent('At least 2 open service actions · result incomplete')
    expect(screen.getByText(/Inspect only if condition A/)).toBeVisible()
    expect(screen.getByText(/Additional service program/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Review service actions in Records' })).toHaveAttribute('href', '/inventory?vin=TESTDATAHWELL0001&tab=data')
    expect(screen.getByText('OASIS source status unverified')).toBeVisible()
  })
  it('shows printed source dates and zero values, with captured coverage kept read-only', () => {
    show({ fordOasis: { warrantyStartDate: '14-MAR-2024', buildDate: '01-FEB-2024', releaseDate: '2024-02-10', monthsInService: 0, saleMileage: 0,
      warrantyCoverages: [{ type: 'Powertrain', description: 'Conditional coverage &amp; source restrictions apply' }], extendedCoverageExpirations: ['Ends 14-MAR-2030'] },
      autoCheckReport: { estimatedInServiceDate: '2024-04-01' } })
    expect(screen.getByText('In-service')).toBeVisible()
    expect(screen.getByText('03/14/2024')).toBeVisible()
    expect(screen.getByText('02/01/2024')).toBeVisible()
    expect(screen.getByText('0 mi')).toBeVisible()
    expect(screen.queryByText('04/01/2024')).not.toBeInTheDocument()
    expect(screen.getByText('Conditional coverage & source restrictions apply')).toBeVisible()
    expect(screen.getByText('Ends 03/14/2030')).toBeVisible()
  })
  it('converts source kilometre distances in captured service and warranty details for display', () => {
    show({ fordOasis: { openFieldServiceActions: [{ code: 'SYN-1', description: 'Inspect at 12,000 km' }], warrantyCoverages: [{ type: 'Powertrain', description: 'Coverage through 100,000 km' }] },
      warrantyCheck: { dataState: 'current', mileageEntered: 12000, fordOasis: { warrantyStartDate: '', monthsInService: 0, coverages: [{ type: 'Basic', termText: '60 months/100,000 km', status: 'ACTIVE', remainingMilesText: '12,000 km', remainingTimeText: '12 months', note: 'Inspect at 8,000 km' }] } } })
    expect(screen.getAllByText(/7,456 mi \(12,000 km in the source\)/)).toHaveLength(2)
    expect(screen.getAllByText(/62,137 mi \(100,000 km in the source\)/)).toHaveLength(2)
    expect(screen.getByText(/4,971 mi \(8,000 km in the source\)/)).toBeVisible()
  })
  it('shows captured technical data and differing OASIS values without duplicate header facts', () => {
    show({ engine: 'Inventory engine', transmission: 'Matching transmission', drivetrain: 'AWD', bodyStyle: 'SUV', exteriorColor: 'Blue', fuelType: 'Gasoline',
      fordOasis: { engine: 'Different captured engine', transmission: 'Matching transmission', driveType: 'AWD', bodyStyle: 'SUV', paintColor: 'Blue', fuelType: 'Gasoline',
        engineCalibration: 'DEMO-CAL', axleRatio: 'Captured ratio', axleCode: 'DEMO-AXLE', tire: 'Captured tire', wheelSize: 'Captured wheel', grossVehicleWeight: 'Captured weight', syncVersion: 'DEMO-SYNC', paintCode: 'DEMO-PAINT' } })
    for (const text of ['Vehicle service data', 'Different captured engine', 'DEMO-CAL', 'Captured ratio', 'DEMO-AXLE', 'Captured tire', 'Captured wheel', 'Captured weight', 'DEMO-SYNC', 'DEMO-PAINT']) expect(screen.getByText(text)).toBeVisible()
    for (const text of ['Matching transmission', 'AWD', 'SUV', 'Blue', 'Gasoline']) expect(screen.queryByText(text)).not.toBeInTheDocument()
  })
  it('labels AutoCheck fallback as estimated and preserves captured warranty-check coverage', () => {
    show({ fordOasis: { warrantyCoverages: [{ type: 'Raw source type', description: 'Distinct raw source condition' }] }, autoCheckReport: { estimatedInServiceDate: '2024-04-01' }, warrantyCheck: { capturedAt: '2024-05-01', dataState: 'stale_unverified', mileageSource: 'Captured odometer basis', mileageEntered: 123, fordOasis: { warrantyStartDate: '', monthsInService: 5,
      coverages: [{ type: 'Basic', termText: '36 months', status: 'EXPIRED', remainingMilesText: '0 miles', remainingTimeText: 'Expired', note: 'Captured condition' }] } } })
    expect(screen.getByText('Distinct raw source condition')).toBeVisible()
    expect(screen.getByText('Captured odometer basis')).toBeVisible()
    expect(screen.getByText('05/01/2024')).toBeVisible()
    expect(screen.getByText('Saved record · refresh at source')).toBeVisible()
    expect(screen.getByText('AutoCheck estimate')).toBeVisible()
    expect(screen.getByText('04/01/2024')).toBeVisible()
    for (const text of ['Basic', '36 months', 'At check: EXPIRED', '0 miles', 'Expired', 'Captured condition']) expect(screen.getByText(text)).toBeVisible()
  })
})
