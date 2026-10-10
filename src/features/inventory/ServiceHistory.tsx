import type { InventoryVehicle } from './types'
import type { ProviderServiceReport } from '../../types'
import { formatDate } from './inventory-utils'
import './ServiceHistory.css'

export function serviceReportStateLabel(report: Pick<ProviderServiceReport, 'dataState'>): string {
  return report.dataState === 'current' ? 'Current report' : report.dataState === 'stale_unverified' ? 'Retained report · unverified' : report.dataState === 'incomplete' ? 'Incomplete report' : 'Unverified report'
}

export function rankedServiceReports(reports: ProviderServiceReport[]): ProviderServiceReport[] {
  return [...reports].sort((a,b) => {
    const rank = (r: ProviderServiceReport) => (r.entries.length ? 0 : 10) + (r.dataState === 'current' ? 0 : 5) + (r.provider === 'oem' ? 0 : 1)
    return rank(a)-rank(b)
  })
}

function HistoryReport({ report }: { report: ProviderServiceReport }) {
  return <section className="provider-service-report" aria-label={`${report.sourceLabel} service records`}>
    <header><strong>{report.sourceLabel}</strong><small>{serviceReportStateLabel(report)}</small></header>
    {report.entries.length ? <ol>{[...report.entries].sort((a,b) => b.date.localeCompare(a.date, 'en-US')).map((entry,index) => <li key={`${entry.date}-${index}`}>
      <div><time dateTime={entry.date}>{formatDate(entry.date)}</time>{entry.odometer != null ? <span>{entry.odometer.toLocaleString('en-US')} {entry.odometerUnit ?? 'odometer'}</span> : null}</div>
      <ul>{entry.services.map((service,index) => <li key={index}>{service}</li>)}</ul>
    </li>)}</ol> : <p>{report.historyStatus === 'not_reported' ? 'No service events reported by this source.' : 'Service history unavailable from this source.'}</p>}
  </section>
}

export function ProviderServiceHistoryReports({ reports, hasOemHistory = false }: { reports: ProviderServiceReport[]; hasOemHistory?: boolean }) {
  if (!reports.length) return null
  const ranked = rankedServiceReports(reports)
  return <article className="inventory-vehicle-document provider-service-history" aria-label="Reported service history">
    <header><h3>Reported service history</h3><span>{reports.reduce((sum,r) => sum+r.entries.length,0)} reported events</span></header>
    <p>History reports may be incomplete. Recorded visits do not confirm current reconditioning or Ready status.</p>
    {ranked.map((report,index) => index === 0 && !hasOemHistory ? <HistoryReport key={`${report.provider}-${report.sourceLabel}`} report={report} /> :
      <details key={`${report.provider}-${report.sourceLabel}`}><summary>{report.sourceLabel} · {report.entries.length} reported events{report.dataState !== 'current' ? ` · ${serviceReportStateLabel(report)}` : ''}</summary><HistoryReport report={report} /></details>)}
  </article>
}

export function ServiceHistory({ vehicle }: { vehicle: InventoryVehicle }) {
  const hasOemHistory = vehicle.fordOasis?.dataState === 'current' && vehicle.fordOasis.serviceHistory?.dataState === 'current' && Boolean(vehicle.fordOasis.serviceHistory.repairOrderTimeline?.length || vehicle.fordOasis.serviceHistory.latestRepairOrder?.services.length)
  return <ProviderServiceHistoryReports reports={vehicle.serviceHistory?.reports ?? []} hasOemHistory={hasOemHistory} />
}
