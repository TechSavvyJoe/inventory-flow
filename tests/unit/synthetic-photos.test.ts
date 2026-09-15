// @ts-nocheck -- repository-safe demo fixtures run in Node.
import { describe, expect, it } from 'vitest'
import { withSyntheticIllustrations, withSyntheticVehicleIllustration } from '../../fixtures/synthetic-photos.mjs'
describe('synthetic preview illustrations', () => {
  it('uses the same illustration in the inventory list and detailed vehicle response', () => {
    const vehicle = { vin: 'TESTDATAHWELL0001', serviceReadiness: { status: 'serviced', completedAt: null } }
    const list = withSyntheticIllustrations({ vehicles: [vehicle] })
    expect(list.vehicles[0]).toEqual(withSyntheticVehicleIllustration(vehicle))
    expect(list.vehicles[0].imageUrl).toBe('/demo-vehicles/f150.png')
    expect(list.vehicles[0].serviceReadiness.completedAt).toBeNull()
  })
  it('does not replace a non-fixture vehicle photo or mutate its input', () => {
    const vehicle = { vin: 'NOT-A-DEMO-VIN', imageUrl: 'https://example.test/original.jpg' }
    expect(withSyntheticVehicleIllustration(vehicle)).toBe(vehicle)
    expect(withSyntheticIllustrations({ vehicles: [vehicle] }).vehicles[0].imageUrl).toBe(vehicle.imageUrl)
  })
})
