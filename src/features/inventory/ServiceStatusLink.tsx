import { formatDate } from '../../lib/format'
import { Check, Wrench } from 'lucide-react'
import { WorkspaceLink } from '../../components/WorkspaceLink'
import type { ServiceReadiness } from '../../types'
import { serviceStatusLabel, serviceWorkflowStatus } from '../../lib/service-readiness'
import './service-status-link.css'

export function ServiceStatusLink({ vin, service, detailed = false, labelPrefix }: { vin: string; service?: ServiceReadiness | null; detailed?: boolean; labelPrefix?: string }) {
  const status = serviceWorkflowStatus(service)
  const label = serviceStatusLabel(service)
  const StatusIcon = status === 'serviced' ? Check : Wrench
  const autoCheckEvidence = status === 'serviced' && service?.readinessEvidence?.source === 'autocheck' ? service.readinessEvidence : null
  const fordEvidence = status === 'serviced' && service?.readinessEvidence?.source === 'ford_service_history' ? service.readinessEvidence : null
  const detail = detailed && autoCheckEvidence ? ` · AutoCheck inspected ${formatDate(autoCheckEvidence.inspectionDate)}`
    : detailed && fordEvidence ? ` · Ford service ${formatDate(fordEvidence.inServiceDate)} · ready ${formatDate(fordEvidence.readyDate || fordEvidence.inspectionDate)}`
    : detailed && service?.completedAt && status === 'serviced' ? ` · ${formatDate(service.completedAt)}`
      : detailed && service?.serviceEnteredAt && status === 'in_service' ? ` · Since ${formatDate(service.serviceEnteredAt)}` : ''
  const title = autoCheckEvidence ? 'Ready from a qualifying AutoCheck post-intake inspection'
    : fordEvidence ? 'Ready from a qualifying Ford service-history inspection after intake'
      : status === 'serviced' && !service?.completedAt ? 'Ready is recorded; no completion date is available' : 'Open vehicle service workflow'
  return <WorkspaceLink to={`/service?vin=${encodeURIComponent(vin)}`} preserveOrigin className={`inventory-service-link inventory-service-link--${status}${detailed ? ' is-detailed' : ''}`} onClick={event => event.stopPropagation()} title={title} aria-label={labelPrefix ? `${labelPrefix}: ${label}` : `${label}. Open service status for VIN ${vin}`}>
    <StatusIcon size={14} aria-hidden="true"/><span>{labelPrefix ? <span className="inventory-service-link__prefix">{labelPrefix}: </span> : null}{label}{detail}</span>
  </WorkspaceLink>
}
