import { AlertTriangle, ShieldAlert } from 'lucide-react'
import type { SourceMeta } from '../types'

export function SourceWarning({ meta }: { meta: SourceMeta }) {
  const freshnessIssue = meta.publicFreshness !== 'current' || meta.dealerMailFreshness !== 'current'
  if (!freshnessIssue) return null

  const critical = meta.publicFreshness === 'incomplete' || meta.dealerMailFreshness === 'incomplete'
  const Icon = critical ? ShieldAlert : AlertTriangle
  return (
    <section className={`source-warning${critical ? ' is-critical' : ''}`} aria-live="polite">
      <Icon aria-hidden="true" />
      <div>
        <strong>{critical ? 'Inventory update incomplete' : 'Some inventory details may be out of date'}</strong>
        <p>Previously confirmed vehicles remain visible with their last update time. Missing data never releases a hold or confirms that a vehicle is available.</p>
        {meta.warnings.length ? (
          <details>
            <summary>View update details</summary>
            <ul>{meta.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </details>
        ) : null}
      </div>
    </section>
  )
}
