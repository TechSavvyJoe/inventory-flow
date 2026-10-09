import { ArrowRight } from 'lucide-react'
import { formatDateTime } from '../../lib/format'
import type { PlatformGroup, PlatformStoredCoverage } from './types'
import { HEALTH_LABEL } from './platformPresentation'
import './PlatformPublication.css'

const countLabel = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-US') : 'Not reported'
const RECORD_FIELDS: { key: keyof PlatformStoredCoverage['counts']; label: string }[] = [
  { key: 'vehicleCount', label: 'Published vehicle records' },
  { key: 'dealerMailRowCount', label: 'DealerMail source rows' },
  { key: 'dealerMailVinReconciledCount', label: 'DealerMail rows reconciled to VINs' },
  { key: 'resourceRecordCount', label: 'Vehicle resource records' },
  { key: 'fordInvoiceRecordCount', label: 'Ford invoice records' },
  { key: 'fordOasisRecordCount', label: 'Ford OASIS records' },
  { key: 'warrantyCheckRecordCount', label: 'Warranty check records' },
]

export function PlatformPublication({ group, busy, onConnections }: { group: PlatformGroup; busy: boolean; onConnections: () => void }) {
  const stored = group.health.coverage?.basis === 'stored_publication' ? group.health.coverage : undefined
  const dealerships = group.dealerships.filter(dealer => dealer.groupId === group.id)
  const reportDate = group.health.reportDate ?? stored?.reportDate
  const publishedAt = group.health.publishedAt ?? stored?.publishedAt
  const summary = [
    { label: 'Public inventory rows', value: stored?.counts.publicRowCount },
    { label: 'App vehicle membership', value: stored?.counts.activeInventoryCount },
    { label: 'DealerMail rows needing VIN review', value: stored?.counts.dealerMailVinReviewCount, attention: true },
    { label: 'Publication warnings', value: stored?.counts.warningCount, attention: true },
  ]
  return <section className="platform-publication" aria-label="Stored publication evidence">
    <header className="platform-panel-heading"><div><h3>Stored publication evidence</h3><p className="platform-help">{group.health.message}</p></div><span className={`platform-health--${group.health.status}`}>{HEALTH_LABEL[group.health.status] ?? 'Publication state not reported'}</span></header>
    <dl className="platform-publication-summary" aria-label="Publication totals">{summary.map(item => <div key={item.label} data-attention={item.attention && typeof item.value === 'number' && item.value > 0}><dt>{item.label}</dt><dd>{countLabel(item.value)}</dd></div>)}</dl>
    <dl className="platform-publication-facts">
      <div><dt>Stored release date</dt><dd>{reportDate ?? 'Not reported'}</dd></div>
      <div><dt>Last publication</dt><dd>{publishedAt ? <time dateTime={publishedAt}>{formatDateTime(publishedAt)}</time> : 'Not reported'}</dd></div>
      <div><dt>Database identity</dt><dd>{group.health.connected ? 'Verified for this group' : 'Not verified'}</dd></div>
      <div><dt>Employees enabled / total</dt><dd>{countLabel(group.health.activeEmployees)} / {countLabel(group.health.employees)}</dd></div>
    </dl>
    <section className="platform-publication-stores" aria-label="Publication coverage by dealership">
      <h4>Dealership coverage</h4>
      <p className="platform-help">{stored ? 'Stored publication totals, matched to each registered store key.' : 'Coverage totals have not been reported for this account.'}</p>
      <div className="platform-publication-store-head" aria-hidden="true"><span>Dealership / store key</span><span>Public rows</span><span>DealerMail rows</span><span>App membership</span></div>
      {dealerships.map(dealer => {
        const totals = stored?.stores.find(item => item.storeKey === dealer.storeKey)
        return <div className="platform-publication-store" role="group" aria-label={`Publication coverage at ${dealer.name}`} key={dealer.id}>
          <div><strong>{dealer.name}</strong><small>{dealer.storeKey}</small></div>
          <dl><div><dt>Public rows</dt><dd>{countLabel(totals?.publicCount)}</dd></div><div><dt>DealerMail rows</dt><dd>{countLabel(totals?.crmCount)}</dd></div><div><dt>App membership</dt><dd>{countLabel(totals?.activeInventoryCount)}</dd></div></dl>
        </div>
      })}
      {!dealerships.length && <p className="platform-empty-copy">Register a dealership to review its publication coverage.</p>}
      <p className="platform-help">App membership combines public and DealerMail VIN membership, excluding manager-reported deliveries. It does not establish availability, physical location or sale status. Missing totals remain unreported.</p>
    </section>
    <details className="platform-publication-records"><summary>Captured records & reconciliation</summary><dl>{RECORD_FIELDS.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{countLabel(stored?.counts[field.key])}</dd></div>)}</dl><p className="platform-help">Record counts do not establish complete field capture, current source access or warranty coverage.</p></details>
    <footer className="platform-publication-footer"><p className="platform-help">Publication health comes from the isolated database. Source sign-ins, collector execution and backups require separate verification.</p><button disabled={busy} onClick={onConnections}>Review data connections<ArrowRight aria-hidden="true"/></button></footer>
  </section>
}
