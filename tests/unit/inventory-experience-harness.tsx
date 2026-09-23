import { useState } from 'react'
import { InventoryExperience } from '../../src/features/inventory/InventoryExperience'
import type { InventoryExperienceProps, InventoryScope } from '../../src/features/inventory/types'

export type InventoryExperienceHarnessProps = Omit<InventoryExperienceProps, 'scope' | 'onScopeChange' | 'selectedVehicleId' | 'onSelectedVehicleChange'> & {
  initialScope?: InventoryScope
  initialSelectedVehicleId?: string | null
  onScopeChange?: InventoryExperienceProps['onScopeChange']
  onSelectedVehicleChange?: InventoryExperienceProps['onSelectedVehicleChange']
}

/**
 * InventoryPage owns scope and the open vehicle (URL, then workspace memory).
 * Tests that render the list directly stand in for it with plain state, and
 * still observe every change through the optional callbacks.
 */
export function InventoryExperienceHarness({ initialScope = 'home', initialSelectedVehicleId = null, onScopeChange, onSelectedVehicleChange, ...props }: InventoryExperienceHarnessProps) {
  const [scope, setScope] = useState<InventoryScope>(initialScope)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(initialSelectedVehicleId)
  return <InventoryExperience {...props}
    scope={scope}
    onScopeChange={next => { setScope(next); onScopeChange?.(next) }}
    selectedVehicleId={selectedVehicleId}
    onSelectedVehicleChange={next => { setSelectedVehicleId(next); onSelectedVehicleChange?.(next) }} />
}
