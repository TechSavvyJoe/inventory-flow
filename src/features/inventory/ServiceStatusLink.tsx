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
  const detailParts = detailed && autoCheckEvidence ? [`AutoCheck ${formatDate(autoCheckEvidence.inspectionDate)}`]
    : detailed && fordEvidence ? [
      `Started ${formatDate(fordEvidence.inServiceDate)}`,
      `Ready ${formatDate(fordEvidence.readyDate || fordEvidence.inspectionDate)}`,
    ]
      : detailed && service?.completedAt && status === 'serviced' ? [formatDate(service.completedAt)]
        : detailed && service?.serviceEnteredAt && status === 'in_service' ? [`Since ${formatDate(service.serviceEnteredAt)}`] : []
  const evidenceDescription = detailParts.join('; ')
  const title = autoCheckEvidence ? `Ready from a qualifying AutoCheck post-intake inspection${evidenceDescription ? `. ${evidenceDescription}` : ''}`
    : fordEvidence ? `Ready from a qualifying Ford service-history inspection after intake${evidenceDescription ? `. ${evidenceDescription}` : ''}`
      : status === 'serviced' && !service?.completedAt ? 'Ready is recorded; no completion date is available' : 'Open vehicle service workflow'
  const accessibleLabel = labelPrefix ? `${labelPrefix}: ${label}` : `${label}. Open service status for VIN ${vin}`
  return <WorkspaceLink to={`/service?vin=${encodeURIComponent(vin)}`} preserveOrigin className={`inventory-service-link inventory-service-link--${status}${detailed ? ' is-detailed' : ''}`} onClick={event => event.stopPropagation()} title={title} aria-label={accessibleLabel}>
    <StatusIcon size={14} aria-hidden="true"/><span className="inventory-service-link__content"><span>{labelPrefix ? <span className="inventory-service-link__prefix">{labelPrefix}: </span> : null}{label}</span>{detailParts.length ? <small className="inventory-service-link__detail">{detailParts.map(part => <span key={part}>{part}</span>)}</small> : null}</span>
  </WorkspaceLink>
}
