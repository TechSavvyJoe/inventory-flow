import { Check, Wrench } from 'lucide-react'
import type { ServiceReadiness } from '../../types'
import { serviceStatusLabel, serviceWorkflowStatus } from '../../lib/service-readiness'
import './service-status-link.css'

export function ServiceStatusLink({ vin, service, detailed = false }: { vin: string; service?: ServiceReadiness | null; detailed?: boolean }) {
  const status = serviceWorkflowStatus(service)
  const label = serviceStatusLabel(service)
  const StatusIcon = status === 'serviced' ? Check : Wrench
  return <a href={`/service?vin=${encodeURIComponent(vin)}`} className={`inventory-service-link inventory-service-link--${status}${detailed ? ' is-detailed' : ''}`} onClick={event => event.stopPropagation()} title={status === 'serviced' && !service?.completedAt ? 'Ready is recorded; no service completion date was captured' : 'Open vehicle service workflow'} aria-label={`${label}. Open service status for VIN ${vin}`}>
    <StatusIcon size={14} aria-hidden="true"/><span>{label}{detailed && service?.completedAt && status === 'serviced' ? ` · ${service.completedAt}` : detailed && service?.serviceEnteredAt && status === 'in_service' ? ` · Since ${service.serviceEnteredAt}` : ''}</span>
  </a>
}
