import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, ChevronDown, ClipboardCheck, ExternalLink, Gauge } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { FordServiceHistoryVisitRecord, FordServiceRepairOrderRecord, VehicleRecord } from '../../types'
import { formatDate, formatDateTime, formatMileage } from '../inventory/inventory-utils'
import { fordServiceHistoryUrl, officialVehicleDocumentUrl } from '../inventory/vehicle-document-utils'
import { sourceDisplayText } from '../../lib/source-text'

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
  return service
}

function visitSummary(services: string[]): string {
  if (!services.length) return 'Dealer service visit recorded'
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
    {services.length ? <ul aria-label="Completed service items">{services.map((service) => <li key={service}>{serviceOutcome(service)}</li>)}</ul> : null}
  </li>
}

export function serviceEvidenceSummary(vehicle: VehicleRecord): string | null {
  const fordFamily = /^(ford|lincoln|linc)$/i.test(String(vehicle.make || '').trim())
  if (fordFamily) {
    const history = vehicle.fordOasis?.serviceHistory
    const inspection = history?.recentInspection
    if (inspection) return `${inspection.inspection.type || 'Ford inspection'} · ${formatDate(inspection.closeDate)}`
    if (history?.repairOrderCount) return `${history.repairOrderCount} Ford service visits reported`
    return history?.historyCaptured ? 'No Ford service visits reported' : null
  }
  const inspection = vehicle.autoCheckReport?.recentInspection
  if (inspection) return `AutoCheck inspection · ${formatDate(inspection.date)}`
  return serviceRecordText(vehicle)
}

export function SourceServiceHistory({ vehicle, recordsHref }: { vehicle: VehicleRecord; recordsHref: string }) {
  const fordFamily = /^(ford|lincoln|linc)$/i.test(String(vehicle.make || '').trim())
  const history = vehicle.fordOasis?.serviceHistory
  const visits = fordVisits(vehicle)
  const [showEarlierVisits, setShowEarlierVisits] = useState(false)
  const autoCheck = vehicle.autoCheckReport
  const autoCheckService = serviceRecordText(vehicle)
  const autoCheckInspection = autoCheck?.recentInspection
  const hasAutoCheckService = Boolean(autoCheckService || autoCheckInspection)
  const sourceUrl = fordFamily ? fordServiceHistoryUrl(vehicle.vin) : officialVehicleDocumentUrl(autoCheck?.url, 'autocheck', vehicle.listingUrl)

  return <section className="service-source-history" aria-labelledby="source-service-history-title">
    <header className="service-source-history-heading">
      <div><h3 id="source-service-history-title">Vehicle service records</h3><p>{fordFamily ? 'Ford dealer repair history' : 'AutoCheck history'}</p></div>
      <span>{fordFamily ? 'FORD' : 'AUTOCHECK'}</span>
    </header>
    {fordFamily ? <>
      {history ? <div className="service-source-history-summary">
        <strong>{history.repairOrderCount ? `${history.repairOrderCount} service visits reported` : 'No service visits reported'}</strong>
        <span>{visits.filter((visit) => visit.services?.length).length ? `${visits.filter((visit) => visit.services?.length).length} visits with work documented` : 'Dealer repair timeline'}</span>
      </div> : <p className="service-source-history-empty">Ford has not reported a dealer service history for this vehicle.</p>}
      {visits.length ? <>
        <ol className="service-source-orders">{visits.slice(0, 2).map((visit, index) => <FordVisit key={`${visit.openDate}-${visit.closeDate}-${visit.odometer ?? index}`} visit={visit} />)}</ol>
        {visits.length > 2 ? <>
          <button className="service-source-history-expand" type="button" aria-expanded={showEarlierVisits} onClick={() => setShowEarlierVisits((open) => !open)}>
            <ClipboardCheck size={15} aria-hidden="true" />
            <span>{showEarlierVisits ? 'Hide earlier visits' : `Show ${visits.length - 2} earlier service visits`}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <AnimatePresence initial={false}>{showEarlierVisits ? <motion.ol className="service-source-orders service-source-orders--earlier" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
            {visits.slice(2).map((visit, index) => <FordVisit key={`${visit.openDate}-${visit.closeDate}-${visit.odometer ?? index + 2}`} visit={visit} />)}
          </motion.ol> : null}</AnimatePresence>
        </> : null}
      </> : null}
      {history?.checkedAt ? <p className="service-source-history-meta">Checked {formatDateTime(history.checkedAt)}</p> : null}
    </> : <>
      {hasAutoCheckService ? <div className="service-autocheck-history">
        {autoCheckService ? <p><strong>{autoCheckService}</strong></p> : null}
        {autoCheckInspection ? <dl><div><dt>Most recent inspection</dt><dd>{formatDate(autoCheckInspection.date)}</dd></div><div><dt>Recorded as</dt><dd>{autoCheckInspection.types.map(sourceDisplayText).join(' · ')}</dd></div></dl> : <p>No inspection event was identified in the captured report.</p>}
      </div> : <p className="service-source-history-empty">No AutoCheck service or inspection detail was captured.</p>}
    </>}
    <nav className="service-source-history-actions" aria-label="Service record actions">
      <Link to={recordsHref}>View in Records</Link>
      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Open source <ExternalLink size={14} aria-hidden="true" /></a> : null}
    </nav>
  </section>
}
