// Ford OASIS vehicle-configuration text facts the release may carry. The
// importer (server/importer.mjs) and the Worker's release validator
// (cloudflare/src/release-validation.mjs) import this one list so a field the
// importer normalizes can never be refused by the Worker and stop the daily
// publish. Keep it portable: the Cloudflare Worker bundles this module.
export const OASIS_VEHICLE_TEXT_FIELDS = Object.freeze([
  'bodyStyle', 'driveType', 'paintColor', 'paintCode', 'engine', 'engineCalibration',
  'transmission', 'axleRatio', 'axleCode', 'grossVehicleWeight', 'wheelSize', 'tire',
  'syncVersion', 'fuelType',
])

// Printed length bound shared by both validators.
export const OASIS_VEHICLE_TEXT_MAX_LENGTH = 160
