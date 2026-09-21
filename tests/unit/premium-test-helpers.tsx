import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { InventoryExperienceV2 } from '../../src/features/inventory/InventoryExperienceV2'
import { VehicleWorkspaceV2 } from '../../src/features/inventory/VehicleWorkspaceV2'
import { createMockVehicle } from './testHelpers'
import type { InventoryExperienceProps, InventoryVehicle, VehicleWorkspaceProps } from '../../src/features/inventory/types'

export const premiumStore = { id: 'howell', name: 'Howell' }
export const premiumMetrics = { publicUnits: 3, currentHolds: 1, awayFromHome: 0, returnOverdue: 0 }
export function premiumVehicle(overrides: Partial<InventoryVehicle> = {}) {
  return createMockVehicle({ id: 'TESTDATAHWELL0001', vin: 'TESTDATAHWELL0001', stockNumber: 'SYNTHETIC-001', movement: null, ...overrides })
}
export function showPremiumVehicle(vehicle = premiumVehicle(), props: Partial<VehicleWorkspaceProps> = {}) {
  return render(<MemoryRouter><VehicleWorkspaceV2 vehicle={vehicle} homeStore={premiumStore} onClose={vi.fn()} {...props} /></MemoryRouter>)
}
export function showPremiumInventory(vehicles = [premiumVehicle()], props: Partial<InventoryExperienceProps> = {}) {
  return render(<MemoryRouter><InventoryExperienceV2 vehicles={vehicles} homeStore={premiumStore} metrics={premiumMetrics} searchPersistenceKey="manager:Howell:synthetic" {...props} /></MemoryRouter>)
}
