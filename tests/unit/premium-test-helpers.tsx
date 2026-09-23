import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { VehicleWorkspace } from '../../src/features/inventory/VehicleWorkspace'
import { InventoryExperienceHarness, type InventoryExperienceHarnessProps } from './inventory-experience-harness'
import { createMockVehicle } from './testHelpers'
import type { InventoryVehicle, VehicleWorkspaceProps } from '../../src/features/inventory/types'

export const premiumStore = { id: 'howell', name: 'Howell' }
export function premiumVehicle(overrides: Partial<InventoryVehicle> = {}) {
  return createMockVehicle({ id: 'TESTDATAHWELL0001', vin: 'TESTDATAHWELL0001', stockNumber: 'SYNTHETIC-001', movement: null, ...overrides })
}
export function showPremiumVehicle(vehicle = premiumVehicle(), props: Partial<VehicleWorkspaceProps> = {}) {
  return render(<MemoryRouter><VehicleWorkspace vehicle={vehicle} homeStore={premiumStore} onClose={vi.fn()} {...props} /></MemoryRouter>)
}
export function showPremiumInventory(vehicles = [premiumVehicle()], props: Partial<InventoryExperienceHarnessProps> = {}) {
  return render(<MemoryRouter><InventoryExperienceHarness vehicles={vehicles} homeStore={premiumStore} searchPersistenceKey="manager:Howell:synthetic" {...props} /></MemoryRouter>)
}
