import type { InventoryVehicle } from './types'
import { providerHoldLabel } from './provider-evidence-utils'
export { importedHoldSummary } from './provider-evidence-utils'
import './ProviderEvidence.css'

const DISPOSITIONS = { sold_pending: 'Sold pending', delivered: 'Delivered', other: 'Other', not_observed: 'Not observed', unknown: 'Unverified' }

export function ProviderEvidence({ vehicle }: { vehicle: InventoryVehicle }) {
  if (!vehicle.operationalEvidence) return null
  const records = vehicle.inventoryDecision?.evidence ?? vehicle.operationalEvidence.records
  return <section className="provider-evidence" aria-label="Imported inventory evidence">
    <header><h4>Imported inventory evidence</h4><span>Read-only</span></header>
    {records.length ? <ul>{records.map(record => <li key={record.provider}>
      <div><strong>{record.sourceLabel}</strong><span>{providerHoldLabel(record)}</span></div>
      <div>{record.reportedDisposition && <span>{DISPOSITIONS[record.reportedDisposition]}</span>}
        {record.dataState !== 'current' || !record.complete ? <small>{record.dataState === 'stale_unverified' ? 'Retained report · unverified' : record.dataState === 'incomplete' || !record.complete ? 'Incomplete report' : 'Unverified report'}</small> : <small>Current report</small>}
        {'comparison' in record && record.comparison === 'conflict' ? <strong className="provider-evidence-warning">Records disagree</strong> : null}
      </div>
    </li>)}</ul> : <p>No imported observations supplied. Manual controls remain available.</p>}
    <p>Staff decisions and source observations are separate. No observed hold is not an availability promise.</p>
  </section>
}
