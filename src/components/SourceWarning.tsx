import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { formatDate } from '../lib/format'
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
        <strong>{critical ? 'Inventory needs review' : 'Some inventory details may be out of date'}</strong>
        <p>{meta.reportDate ? `Showing published data from ${formatDate(meta.reportDate)} until the next refresh. ` : null}Confirm holds and availability with the home store before promising a vehicle.</p>
      </div>
    </section>
  )
}
