import type { ServiceWorkflowStatus } from '../types'

export const SERVICE_STATUS_OPTIONS: ReadonlyArray<{ value: ServiceWorkflowStatus; label: string }> = [
  { value: 'needs_service', label: 'Waiting for service' },
  { value: 'in_service', label: 'In service' },
  { value: 'serviced', label: 'Ready' },
]

/** Missing metadata is unconfirmed work, never an invented Ready decision. */
export function serviceWorkflowStatus(service?: { status?: string } | null): ServiceWorkflowStatus {
  if (service?.status === 'in_service') return 'in_service'
  return service?.status === 'serviced' ? 'serviced' : 'needs_service'
}

export function serviceStatusLabel(service?: { status?: string } | null): string {
  return SERVICE_STATUS_OPTIONS.find((option) => option.value === serviceWorkflowStatus(service))!.label
}
