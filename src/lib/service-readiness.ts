import type { ServiceWorkflowStatus } from '../types'

export const SERVICE_STATUS_OPTIONS: ReadonlyArray<{ value: ServiceWorkflowStatus; label: string }> = [
  { value: 'needs_service', label: 'Waiting for service' },
  { value: 'in_service', label: 'In service' },
  { value: 'serviced', label: 'Ready' },
]

/** Missing legacy metadata uses the existing-inventory baseline, never an invented completion. */
export function serviceWorkflowStatus(service?: { status?: string } | null): ServiceWorkflowStatus {
  if (service?.status === 'unknown' || service?.status === 'needs_service') return 'needs_service'
  return service?.status === 'in_service' ? 'in_service' : 'serviced'
}

export function serviceStatusLabel(service?: { status?: string } | null): string {
  return SERVICE_STATUS_OPTIONS.find((option) => option.value === serviceWorkflowStatus(service))!.label
}
