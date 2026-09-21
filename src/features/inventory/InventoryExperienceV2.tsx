import { useCallback, useState } from 'react'
import { useWorkspaceState } from '../../lib/workspace-memory'
import { InventoryExperience } from './InventoryExperience'
import { VehicleWorkspaceV2 } from './VehicleWorkspaceV2'
import { CustomerShortlistDrawer } from './CustomerShortlistDrawer'
import { ShortlistContext, useCustomerShortlist } from './useCustomerShortlist'
import type { InventoryExperienceProps, InventoryVehicle } from './types'

/** Keep filtering, sorting, mobile rows, loading and focus behavior in one place. */
export function InventoryExperienceV2(props: InventoryExperienceProps) {
  const shortlist = useCustomerShortlist(props.searchPersistenceKey ?? `inventory:${props.homeStore.id}`, props.vehicles)
  const [onlyShortlisted, setOnlyShortlisted] = useWorkspaceState(props.searchPersistenceKey, 'inventory.shortlistOnly', false)
  const [internalSelected, setInternalSelected] = useState<string | null>(props.defaultSelectedVehicleId ?? null)
  const onSelectedVehicleChange = useCallback((id: string | null) => {
    setInternalSelected(id)
    props.onSelectedVehicleChange?.(id)
  }, [props.onSelectedVehicleChange])
  const vehicleFilter = useCallback((vehicle: InventoryVehicle) =>
    (!props.vehicleFilter || props.vehicleFilter(vehicle)) && (!onlyShortlisted || shortlist.isShortlisted(vehicle)),
  [onlyShortlisted, props.vehicleFilter, shortlist.isShortlisted])
  return <ShortlistContext.Provider value={shortlist}>
    <InventoryExperience {...props}
      selectedVehicleId={props.selectedVehicleId !== undefined ? props.selectedVehicleId : internalSelected}
      onSelectedVehicleChange={onSelectedVehicleChange}
      WorkspaceComponent={VehicleWorkspaceV2} vehicleFilter={vehicleFilter}
      toolbarAccessory={<>{props.toolbarAccessory}{shortlist.count > 0 || onlyShortlisted ? <button type="button" className="button button-secondary"
        aria-pressed={onlyShortlisted} onClick={() => setOnlyShortlisted(!onlyShortlisted)}>
        Shortlist ({shortlist.count})
      </button> : null}</>}
      footerAccessory={<>{props.footerAccessory}<CustomerShortlistDrawer entries={shortlist.entries}
        onRemove={shortlist.remove} onClear={shortlist.clear}
        onSelectVehicle={vehicle => onSelectedVehicleChange(vehicle.id)} /></>}
    />
  </ShortlistContext.Provider>
}
