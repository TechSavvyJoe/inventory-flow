import { CalendarDays, ChevronDown, ClipboardCheck, ExternalLink, Gauge, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { FordServiceHistoryVisitRecord, FordServiceRepairOrderRecord, SourceFreshness, VehicleRecord } from '../../types'
import { formatDate, formatDateTime, formatMileage } from '../inventory/inventory-utils'
import { fordServiceHistoryUrl, officialVehicleDocumentUrl } from '../inventory/vehicle-document-utils'
import { sourceDisplayText } from '../../lib/source-text'
import { qualifyingAutoCheckInspection } from '../../lib/service-inspection-evidence'
import { ProviderServiceHistoryReports, rankedServiceReports, serviceReportStateLabel } from '../inventory/ServiceHistory'
import { SourceWordmark, type SourceWordmarkBrand } from '../../components/SourceWordmark'

function fordOrders(vehicle: VehicleRecord): FordServiceRepairOrderRecord[] {
  const history = vehicle.fordOasis?.serviceHistory
  if (!history) return []
  const orders = history.recentRepairOrders?.length
    ? history.recentRepairOrders
    : history.latestRepairOrder
      ? [history.latestRepairOrder]
      : []
  return [...new Map(orders.map((order) => [order.repairOrderNumber, order])).values()]
}

function fordVisits(vehicle: VehicleRecord): FordServiceHistoryVisitRecord[] {
  const history = vehicle.fordOasis?.serviceHistory
  if (!history) return []
  if (history.repairOrderTimeline?.length) return history.repairOrderTimeline
  return fordOrders(vehicle).map((order) => ({
    openDate: order.openDate,
    closeDate: order.closeDate,
    ...(order.odometer != null ? { odometer: order.odometer } : {}),
    ...(order.services.length ? { services: order.services } : {}),
  }))
}

function serviceRecordText(vehicle: VehicleRecord): string | null {
  const check = vehicle.autoCheckReport?.checks?.find((item) => /service|repair/i.test(item.label))
  const detail = sourceDisplayText(check?.detail)
  if (detail) return detail
  const status = sourceDisplayText(check?.status)
  return status && !/^no issue$/i.test(status) && /record|service|repair/i.test(status) ? status : null
}

function serviceOutcome(service: string): string {
  const normalized = service.toLowerCase()
  if (normalized === 'oil and filter service') return 'Oil and filter changed'
  if (normalized === 'engine air filter') return 'Engine air filter replaced'
  if (normalized === 'cabin air filter') return 'Cabin air filter replaced'
  if (normalized === 'wiper blades') return 'Wiper blades replaced'
  if (normalized === 'tire inspection/service') return 'Tires inspected or serviced'
  if (normalized === 'brake inspection/service') return 'Brakes inspected or serviced'
  if (normalized === 'diagnostic self-test') return 'Diagnostic scan completed'
  if (normalized === 'battery service') return 'Battery service completed'
  if (normalized === 'wheel alignment') return 'Wheel alignment completed'
  if (normalized === 'fluid service') return 'Fluid service completed'
  if (normalized === 'wheel hub / axle repair') return 'Wheel hub or axle repair completed'
  if (normalized === 'suspension service') return 'Suspension service completed'
  if (normalized === 'starting / charging system repair') return 'Starting or charging repair completed'
  if (normalized === 'engine repair') return 'Engine repair completed'
  if (normalized === 'cooling system service') return 'Cooling system service completed'
  if (normalized === 'transmission service') return 'Transmission service completed'
  if (normalized === 'fuel system service') return 'Fuel system service completed'
  if (normalized === 'ignition system service') return 'Ignition system service completed'
  if (normalized === 'exhaust system service') return 'Exhaust system service completed'
  if (normalized === 'climate-control service') return 'Climate-control service completed'
  return service
}

function serviceTone(service: string): 'maintenance' | 'safety' | 'repair' {
  const normalized = service.toLowerCase()
  if (/brake|tire|inspection|diagnostic/.test(normalized)) return 'safety'
  if (/repair|suspension|transmission|fuel system|ignition|exhaust|climate-control|cooling system|hub|axle|charging/.test(normalized)) return 'repair'
  return 'maintenance'
}

function visitSummary(services: string[]): string {
  const completed = services.map(serviceOutcome)
  const maintenance = completed.filter((item) => !/inspection/i.test(item))
  if (maintenance.length) return `Work completed: ${maintenance.join(' · ')}`
  return `Inspection completed: ${completed.join(' · ')}`
}

function FordVisit({ visit }: { visit: FordServiceHistoryVisitRecord }) {
  const services = (visit.services ?? []).map(sourceDisplayText).filter((service): service is string => Boolean(service))
  return <li className="service-source-order">
    <header>
      <span className="service-source-order-date"><CalendarDays size={15} aria-hidden="true" /><strong>{formatDate(visit.openDate)}<span aria-hidden="true"> → </span>{formatDate(visit.closeDate)}</strong></span>
      {visit.odometer != null ? <span><Gauge size={14} aria-hidden="true" />{formatMileage(visit.odometer)}</span> : null}
    </header>
    <p>{visitSummary(services)}</p>
    {services.length ? <ul aria-label="Completed service items">{services.map((service) => <li className={`service-source-service service-source-service--${serviceTone(service)}`} key={service}>{serviceOutcome(service)}</li>)}</ul> : null}
  </li>
}

function FordRecordedVisit({ visit }: { visit: FordServiceHistoryVisitRecord }) {
  return <li className="service-source-order service-source-order--recorded">
    <header>
      <span className="service-source-order-date"><CalendarDays size={15} aria-hidden="true" /><strong>{formatDate(visit.openDate)}<span aria-hidden="true"> → </span>{formatDate(visit.closeDate)}</strong></span>
      {visit.odometer != null ? <span><Gauge size={14} aria-hidden="true" />{formatMileage(visit.odometer)}</span> : null}
    </header>
  </li>
}

function providerEvidenceSummary(vehicle: VehicleRecord): string | null {
  const report = rankedServiceReports(vehicle.serviceHistory?.reports ?? [])[0]
  if (!report) return null
  const detail = report.entries.length
    ? `${report.entries.length} reported event${report.entries.length === 1 ? '' : 's'}`
    : report.historyStatus === 'not_reported' ? 'No service events reported' : 'Service history unavailable'
  const state = report.dataState === 'current' ? '' : ` · ${serviceReportStateLabel(report)}`
  return `${report.sourceLabel} · ${detail}${state}`
}

function fordHistoryState(vehicle: VehicleRecord): SourceFreshness {
  const outerState = vehicle.fordOasis?.dataState
  // Retained or unverified OASIS cannot promote a nested history to current.
  return outerState && outerState !== 'current' ? outerState : vehicle.fordOasis?.serviceHistory?.dataState ?? 'unknown'
}

export function serviceEvidenceSummary(vehicle: VehicleRecord): string | null {
  const fordFamily = /^(ford|lincoln|linc)$/i.test(String(vehicle.make || '').trim())
  const providerSummary = providerEvidenceSummary(vehicle)
  if (fordFamily) {
    const history = vehicle.fordOasis?.serviceHistory
    const historyState = fordHistoryState(vehicle)
    const historyStateLabel = serviceReportStateLabel({ dataState: historyState })
    const evidence = vehicle.serviceReadiness?.status === 'serviced' && vehicle.serviceReadiness.readinessEvidence?.source === 'ford_service_history'
      ? vehicle.serviceReadiness.readinessEvidence
      : null
    if (evidence?.inspectionDate) return `${evidence.types?.[0] || 'Certified Blue Oval inspection'} · ${formatDate(evidence.inspectionDate)}`
    if (history?.repairOrderCount && historyState === 'current') return `${history.repairOrderCount} Ford service visits reported`
    if (providerSummary) return providerSummary
    if (history?.repairOrderCount) return `${history.repairOrderCount} Ford service visits reported · ${historyStateLabel}`
    return history?.historyCaptured ? `No Ford service visits reported${historyState === 'current' ? '' : ` · ${historyStateLabel}`}` : null
  }
  const inspection = qualifyingAutoCheckInspection(vehicle.serviceReadiness, vehicle.autoCheckReport)
  if (inspection) return `AutoCheck inspection · ${formatDate(inspection.date)}`
  return providerSummary ?? serviceRecordText(vehicle)
}

export function SourceServiceHistory({ vehicle, recordsHref }: { vehicle: VehicleRecord; recordsHref: string }) {
  const fordFamily = /^(ford|lincoln|linc)$/i.test(String(vehicle.make || '').trim())
  const history = vehicle.fordOasis?.serviceHistory
  const historyState = fordHistoryState(vehicle)
  const visits = fordVisits(vehicle)
  const documentedVisits = visits.filter((visit) => visit.services?.length)
  const recordedOnlyVisits = visits.filter((visit) => !visit.services?.length)
  const [showRecordedVisits, setShowRecordedVisits] = useState(false)
  const autoCheck = vehicle.autoCheckReport
  const autoCheckService = serviceRecordText(vehicle)
  const autoCheckInspection = qualifyingAutoCheckInspection(vehicle.serviceReadiness, autoCheck)
  const hasHistoricalAutoCheckInspection = Boolean(autoCheck?.recentInspection)
  const hasAutoCheckService = Boolean(autoCheckService || autoCheckInspection || hasHistoricalAutoCheckInspection)
  const reports = vehicle.serviceHistory?.reports ?? []
  const hasOemHistory = fordFamily && historyState === 'current' && Boolean(history?.repairOrderCount || visits.length)
  const primaryReport = rankedServiceReports(reports)[0]
  const providerFirst = Boolean(primaryReport && !hasOemHistory)
  const sourceBrand: SourceWordmarkBrand | null = providerFirst
    ? primaryReport?.provider === 'autocheck' || primaryReport?.provider === 'carfax' ? primaryReport.provider : null
    : fordFamily ? 'ford' : 'autocheck'
  const sourceName = providerFirst ? primaryReport?.sourceLabel : fordFamily ? 'FORD' : 'AUTOCHECK'
  const sourceUrl = fordFamily ? fordServiceHistoryUrl(vehicle.vin) : officialVehicleDocumentUrl(autoCheck?.url, 'autocheck', vehicle.listingUrl)

  return <section className="service-source-history" aria-labelledby="source-service-history-title">
    <header className="service-source-history-heading">
      <div className="service-source-history-title"><span className="service-source-history-icon" aria-hidden="true"><Wrench size={17} /></span><div><h3 id="source-service-history-title">Vehicle service records</h3><p>{providerFirst ? `${primaryReport?.sourceLabel} service history` : fordFamily ? 'Ford dealer repair history' : 'AutoCheck history'}</p></div></div>
      <span className="service-source-history-source"><SourceWordmark brand={sourceBrand} label={sourceName ?? ''} /></span>
    </header>
    {providerFirst ? <div className="service-autocheck-history"><ProviderServiceHistoryReports reports={reports} /></div> : null}
    {fordFamily ? <>
      {providerFirst && history ? <h4 className="service-source-history-meta">Ford OASIS service history · {serviceReportStateLabel({ dataState: historyState })}</h4> : null}
      {history ? <div className="service-source-history-summary">
        <strong>{history.repairOrderCount ? `${history.repairOrderCount} service visits reported` : history.historyCaptured ? 'No service visits reported' : 'Ford service history unavailable'}</strong>
        <span className={documentedVisits.length ? 'service-source-history-summary--documented' : ''}>{documentedVisits.length ? `${documentedVisits.length} visits with work documented` : recordedOnlyVisits.length ? 'Visit dates and mileage on file' : 'Ford repair history'}</span>
      </div> : reports.length ? null : <p className="service-source-history-empty">Ford has not reported a dealer service history for this vehicle.</p>}
      {visits.length ? <>
        {documentedVisits.length ? <ol className="service-source-orders">{documentedVisits.map((visit, index) => <FordVisit key={`${visit.openDate}-${visit.closeDate}-${visit.odometer ?? index}`} visit={visit} />)}</ol> : null}
        {recordedOnlyVisits.length ? <>
          <p className="service-source-history-recorded-note">Ford reported these visits by date and mileage; itemized work was not available from the source.</p>
          <button className="service-source-history-expand" type="button" aria-expanded={showRecordedVisits} onClick={() => setShowRecordedVisits((open) => !open)}>
            <ClipboardCheck size={15} aria-hidden="true" />
            <span>{showRecordedVisits ? 'Hide additional reported visits' : `View ${recordedOnlyVisits.length} additional reported visit${recordedOnlyVisits.length === 1 ? '' : 's'}`}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {showRecordedVisits ? <ol className="service-source-orders service-source-orders--earlier">
            {recordedOnlyVisits.map((visit, index) => <FordRecordedVisit key={`${visit.openDate}-${visit.closeDate}-${visit.odometer ?? index}`} visit={visit} />)}
          </ol> : null}
        </> : null}
      </> : null}
      {history ? <p className="service-source-history-meta">{serviceReportStateLabel({ dataState: historyState })}{history.checkedAt ? ` · Checked ${formatDateTime(history.checkedAt)}` : ''}</p> : null}
    </> : <>
      {hasAutoCheckService ? <div className="service-autocheck-history">
        {reports.length ? <h4 className="service-source-history-meta">AutoCheck service and inspection evidence</h4> : null}
        {autoCheckService ? <p><strong>{autoCheckService}</strong></p> : null}
        {autoCheckInspection ? <dl><div><dt>Inspection since intake</dt><dd>{formatDate(autoCheckInspection.date)}</dd></div><div><dt>Recorded as</dt><dd>{autoCheckInspection.types.map(sourceDisplayText).join(' · ')}</dd></div></dl> : hasHistoricalAutoCheckInspection ? <p className="service-autocheck-history-note">Historic AutoCheck inspection details remain available in the full report and are not used for this vehicle's current service status.</p> : reports.length ? null : <p className="service-autocheck-history-note">No inspection since intake was identified in the captured report.</p>}
      </div> : reports.length ? null : <p className="service-source-history-empty">No AutoCheck service or inspection detail was captured.</p>}
    </>}
    {reports.length && !providerFirst ? <div className="service-autocheck-history"><ProviderServiceHistoryReports reports={reports} hasOemHistory={hasOemHistory} /></div> : null}
    <nav className="service-source-history-actions" aria-label="Service record actions">
      <Link to={recordsHref}>View in Records</Link>
      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{providerFirst ? fordFamily ? 'Open Ford history' : 'Open AutoCheck report' : 'Open source'} <ExternalLink size={14} aria-hidden="true" /></a> : null}
    </nav>
  </section>
}
