import { ExternalLink, Gauge } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { FordServiceRepairOrderRecord, VehicleRecord } from '../../types'
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

function serviceRecordText(vehicle: VehicleRecord): string | null {
  const check = vehicle.autoCheckReport?.checks?.find((item) => /service|repair/i.test(item.label))
  const detail = sourceDisplayText(check?.detail)
  if (detail) return detail
  const status = sourceDisplayText(check?.status)
  return status && !/^no issue$/i.test(status) && /record|service|repair/i.test(status) ? status : null
}

function FordOrder({ order }: { order: FordServiceRepairOrderRecord }) {
  const services = order.services.length
    ? order.services
    : order.inspection.status === 'confirmed' && order.inspection.type
      ? [order.inspection.type]
      : []
  return <li className="service-source-order">
    <header>
      <strong>{formatDate(order.openDate)}<span aria-hidden="true"> → </span>{formatDate(order.closeDate)}</strong>
      {order.odometer != null ? <span><Gauge size={14} aria-hidden="true" />{formatMileage(order.odometer)}</span> : null}
    </header>
    {services.length ? <ul aria-label="Work recorded">{services.map((service) => <li key={service}>{sourceDisplayText(service)}</li>)}</ul> : order.summary ? <p>{sourceDisplayText(order.summary)}</p> : <p>Service work recorded</p>}
  </li>
}

export function serviceEvidenceSummary(vehicle: VehicleRecord): string | null {
  const fordFamily = /^(ford|lincoln|linc)$/i.test(String(vehicle.make || '').trim())
  if (fordFamily) {
    const history = vehicle.fordOasis?.serviceHistory
    const inspection = history?.recentInspection
    if (inspection) return `${inspection.inspection.type || 'Ford inspection'} · ${formatDate(inspection.closeDate)}`
    if (history?.repairOrderCount) return `${history.repairOrderCount} Ford repair orders reported`
    return history?.historyCaptured ? 'No Ford repair orders reported' : null
  }
  const inspection = vehicle.autoCheckReport?.recentInspection
  if (inspection) return `AutoCheck inspection · ${formatDate(inspection.date)}`
  return serviceRecordText(vehicle)
}

export function SourceServiceHistory({ vehicle, recordsHref }: { vehicle: VehicleRecord; recordsHref: string }) {
  const fordFamily = /^(ford|lincoln|linc)$/i.test(String(vehicle.make || '').trim())
  const history = vehicle.fordOasis?.serviceHistory
  const orders = fordOrders(vehicle)
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
        <strong>{history.repairOrderCount ? `${history.repairOrderCount} repair orders reported` : 'No repair orders reported'}</strong>
        <span>{orders.length ? `${orders.length} recent detailed ${orders.length === 1 ? 'record' : 'records'}` : 'No detailed record available'}</span>
      </div> : <p className="service-source-history-empty">Ford service history has not been captured for this vehicle.</p>}
      {orders.length ? <ol className="service-source-orders">{orders.map((order) => <FordOrder key={order.repairOrderNumber} order={order} />)}</ol> : null}
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
