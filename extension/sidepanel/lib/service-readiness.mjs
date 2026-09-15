// Wire IDs remain compatible with the app ledger; only three workflow states are shown.
export function serviceWorkflowStatus(service) {
  if (service?.status === 'in_service') return 'in_service'
  return service?.status === 'serviced' ? 'serviced' : 'needs_service'
}
