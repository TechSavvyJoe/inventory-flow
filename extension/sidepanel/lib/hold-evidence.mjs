// A current, complete positive observation is useful evidence that a hold was
// reported. It never changes what the separate DealerMail projection says.
export function currentProviderHoldReports(vehicle) {
  return (vehicle.operationalEvidence?.records ?? vehicle.inventoryDecision?.evidence ?? []).filter((record) =>
    record.provider !== 'legacy-dealermail' && record.dataState === 'current'
      && record.complete === true && record.holdState === 'held')
}

export function unverifiedProviderHoldReports(vehicle) {
  return (vehicle.operationalEvidence?.records ?? vehicle.inventoryDecision?.evidence ?? []).filter((record) =>
    record.provider !== 'legacy-dealermail'
      && (record.observedHoldState === 'held' || (record.dataState !== 'current' && record.holdState === 'held'))
      && !(record.dataState === 'current' && record.complete === true && record.holdState === 'held'))
}

export function hasCompleteCurrentNoHoldEvidence(vehicle) {
  const records = vehicle.inventoryDecision?.evidence ?? vehicle.operationalEvidence?.records ?? []
  return records.length > 0 && records.every((record) =>
    record.dataState === 'current' && record.complete === true && record.holdState === 'not_observed')
}

export function hasCurrentProviderHold(vehicle) {
  return currentProviderHoldReports(vehicle).length > 0
}

export function hasPositiveHoldSignal(vehicle) {
  return vehicle.hold?.hasActiveHold === true || vehicle.hold?.lastKnownActiveHold === true
    || vehicle.manualHold?.state === 'active' || hasCurrentProviderHold(vehicle)
    || unverifiedProviderHoldReports(vehicle).length > 0
}
