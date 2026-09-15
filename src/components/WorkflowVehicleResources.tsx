import { useNavigate } from 'react-router-dom'
import { VehicleResourceCards } from '../features/inventory/VehicleResourceCards'
import type { VehicleRecord } from '../types'

/** The same named resources as the SRP/VDP, kept within the vehicle context. */
export function WorkflowVehicleResources({ vehicle }: { vehicle?: VehicleRecord }) {
  const navigate = useNavigate()
  if (!vehicle) return null
  return <div className="workflow-resource-row"><VehicleResourceCards vehicle={vehicle} variant="inline" onOpenSection={tab => navigate(`/inventory?scope=group&vin=${encodeURIComponent(vehicle.vin)}&tab=${tab}`)} /></div>
}
