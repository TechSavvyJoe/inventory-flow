// Wire IDs remain compatible with the app ledger; only three workflow states are shown.
export function serviceWorkflowStatus(service) {
  if (service?.status === 'unknown' || service?.status === 'needs_service') return 'needs_service'
  return service?.status === 'in_service' ? 'in_service' : 'serviced'
}
