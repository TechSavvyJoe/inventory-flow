import { useLocation, useNavigate } from 'react-router-dom'
import { VehicleResourceCards } from '../features/inventory/VehicleResourceCards'
import { currentWorkspaceReturnPath, vehicleWorkspacePath } from '../features/inventory/inventory-navigation'
import type { VehicleRecord } from '../types'

/** The same named resources as the SRP/VDP, kept within the vehicle context. */
export function WorkflowVehicleResources({ vehicle }: { vehicle?: VehicleRecord }) {
  const navigate = useNavigate()
  const location = useLocation()
  if (!vehicle) return null
  return <div className="workflow-resource-row"><VehicleResourceCards vehicle={vehicle} variant="inline" onOpenSection={tab => navigate(vehicleWorkspacePath(vehicle.vin, { tab, returnTo: currentWorkspaceReturnPath(location) }))} /></div>
}
