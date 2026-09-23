/** SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
 * The eight generated demo illustrations, not photographs of inventory VINs.
 * A shared allowlist keeps the app fixture and browser preview consistent.
 * Production photo URL validation does not import or use this mapping.
 */
export const SYNTHETIC_VEHICLE_PHOTOS = Object.freeze({
  TESTDATAHWELL0001: '/demo-vehicles/f150.jpg',
  TESTDATAHWELL0002: '/demo-vehicles/bronco-sport.jpg',
  TESTDATAFWELL0001: '/demo-vehicles/escape.jpg',
  TESTDATAFWELL0002: '/demo-vehicles/maverick.jpg',
  TESTDATADETRT0001: '/demo-vehicles/explorer.jpg',
  TESTDATADETRT0002: '/demo-vehicles/silverado.jpg',
  TESTDATALNCN00001: '/demo-vehicles/nautilus.jpg',
  TESTDATALNCN00002: '/demo-vehicles/corsair.jpg',
})

export function syntheticVehiclePhotoPath(vin) {
  return typeof vin === 'string' && Object.hasOwn(SYNTHETIC_VEHICLE_PHOTOS, vin) ? SYNTHETIC_VEHICLE_PHOTOS[vin] : null
}

/** Only the synthetic browser preview may use this same-origin fallback. */
export function syntheticPreviewPhotos(vehicle, { host, workspace } = {}) {
  if (host !== 'preview' || workspace?.demo !== true) return []
  const path = syntheticVehiclePhotoPath(vehicle?.vin)
  if (!path) return []
  try {
    const origin = new URL(workspace.origin)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return []
    return [new URL(path, origin.origin).href]
  } catch { return [] }
}
