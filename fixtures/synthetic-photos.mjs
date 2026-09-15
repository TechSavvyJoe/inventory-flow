/** SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
 * Generated model illustrations, not photographs of any inventory VIN.
 * Applied only by start-synthetic-demo; production image validation is unchanged.
 */
import { syntheticVehiclePhotoPath } from '../extension/sidepanel/lib/synthetic-photos.mjs'
export function withSyntheticIllustrations(data) {
  return { ...data, vehicles: data.vehicles.map(withSyntheticVehicleIllustration) }
}
export function withSyntheticVehicleIllustration(vehicle) {
  const imageUrl = syntheticVehiclePhotoPath(vehicle?.vin)
  if (!imageUrl) return vehicle
  return { ...vehicle, imageUrl, imageUrls: [imageUrl], photoCount: 1 }
}
