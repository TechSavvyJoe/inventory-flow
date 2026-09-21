import { Heart } from 'lucide-react'
import { VehicleWorkspace } from './VehicleWorkspace'
import { useCustomerShortlist } from './useCustomerShortlist'
import type { VehicleWorkspaceProps } from './types'

/** Premium additions share the authoritative vehicle record and workflow UI. */
export function VehicleWorkspaceV2(props: VehicleWorkspaceProps) {
  const shortlist = useCustomerShortlist()
  const selected = shortlist.isShortlisted(props.vehicle)
  return <VehicleWorkspace {...props} workspaceAccessory={<>
    {props.workspaceAccessory}
    <button type="button" aria-pressed={selected}
      aria-label={`${selected ? 'Remove' : 'Add'} ${props.vehicle.stockNumber} ${selected ? 'from' : 'to'} shortlist`}
      onClick={() => shortlist.toggle(props.vehicle)}>
      <Heart size={18} aria-hidden="true" fill={selected ? 'currentColor' : 'none'} />
      {selected ? 'Shortlisted' : 'Add to shortlist'}
    </button>
  </>} />
}
