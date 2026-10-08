/** One displayed date: a captured OASIS start takes precedence over an estimate. */
export interface VehicleInServiceInput {
  fordOasis?: { warrantyStartDate?: string | null } | null;
  autoCheckReport?: { estimatedInServiceDate?: string | null } | null;
  warrantyCheck?: {
    fordOasis?: { warrantyStartDate?: string | null } | null;
    autoCheck?: { inServiceDate?: string | null } | null;
    carfax?: { inServiceDate?: string | null } | null;
  } | null;
}

export function resolveVehicleInService(vehicle: VehicleInServiceInput) {
  const oasis = vehicle.fordOasis?.warrantyStartDate?.trim()
    || vehicle.warrantyCheck?.fordOasis?.warrantyStartDate?.trim();
  const estimate = vehicle.autoCheckReport?.estimatedInServiceDate?.trim()
    || vehicle.warrantyCheck?.autoCheck?.inServiceDate?.trim();
  if (oasis) return { date: oasis, source: 'oasis' as const, label: 'Warranty in-service · OASIS' };
  if (estimate) return { date: estimate, source: 'autocheck' as const, label: 'In-service · AutoCheck estimate' };
  const carfax = vehicle.warrantyCheck?.carfax?.inServiceDate?.trim();
  if (carfax) return { date: carfax, source: 'carfax' as const, label: 'In-service · CARFAX estimate' };
  return { date: null, source: null, label: 'Warranty in-service' };
}
