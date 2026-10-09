import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { VehicleRecord } from '../../types'
import { sourceDisplayText } from '../../lib/source-text'
import { sourceDistanceText } from '../../lib/source-distance'
import { formatDate, formatNumber } from '../inventory/inventory-utils'
import { formatSourceDateText, oasisActionLabel } from '../inventory/vehicle-resource-catalog'
import { resolveVehicleInService } from '../inventory/vehicle-in-service'
import { FlowLedgerHeading } from '../../design-system'

export function ServiceVehicleContext({ vehicle, recordsHref }: { vehicle: VehicleRecord; recordsHref: string }) {
  const oasis = vehicle.fordOasis
  const warranty = vehicle.warrantyCheck?.fordOasis
  const inService = resolveVehicleInService(vehicle)
  const actions = oasis?.openFieldServiceActions ?? []
  const months = oasis?.monthsInService ?? warranty?.monthsInService
  const facts = [
    ['In-service', inService.date ? formatDate(inService.date) : null],
    ['Built', oasis?.buildDate ? formatDate(oasis.buildDate) : null],
    ['Months in service', months != null ? formatNumber(months) : null],
    ['Mileage at sale', oasis?.saleMileage != null ? `${formatNumber(oasis.saleMileage)} mi` : null],
    ['Released', oasis?.releaseDate ? formatDate(oasis.releaseDate) : null],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]))
  const technical = [
    ['Engine calibration', oasis?.engineCalibration], ['Axle ratio', oasis?.axleRatio],
    ['Axle code', oasis?.axleCode], ['Tire', oasis?.tire], ['Wheel size', oasis?.wheelSize],
    ['Gross vehicle weight', oasis?.grossVehicleWeight], ['SYNC version', oasis?.syncVersion], ['Paint code', oasis?.paintCode],
    ['Engine', oasis?.engine !== vehicle.engine ? oasis?.engine : null],
    ['Transmission', oasis?.transmission !== vehicle.transmission ? oasis?.transmission : null],
    ['Drive type', oasis?.driveType !== vehicle.drivetrain ? oasis?.driveType : null],
    ['Fuel type', oasis?.fuelType !== vehicle.fuelType ? oasis?.fuelType : null],
    ['Body style', oasis?.bodyStyle !== (vehicle.bodyStyle ?? vehicle.bodyType) ? oasis?.bodyStyle : null],
    ['Paint color', oasis?.paintColor !== vehicle.exteriorColor ? oasis?.paintColor : null],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]?.trim()))
  const coverage = oasis?.warrantyCoverages ?? []
  const checks = warranty?.coverages ?? []
  const extended = oasis?.extendedCoverageExpirations ?? []
  const capturedAt = oasis?.capturedAt ?? (warranty ? vehicle.warrantyCheck?.capturedAt : undefined)
  const state = oasis?.dataState ?? (warranty ? vehicle.warrantyCheck?.dataState : undefined)
  return <section className="service-reference" aria-label="Service reference">
    <FlowLedgerHeading className="service-reference-heading" level={3} variant="plain" title={<><ShieldCheck size={20} aria-hidden="true"/>Service reference</>} description="OASIS" actions={capturedAt ? <small>Captured {formatDate(capturedAt)}</small> : undefined} />
    {!oasis && !warranty ? <p>OASIS reference unavailable</p> : null}
    {state === 'stale_unverified' ? <p>Saved report · refresh at source</p> : state === 'unknown' ? <p>OASIS source status unverified</p> : state === 'incomplete' ? <p>Partial captured record</p> : null}
    <section className={actions.length ? 'service-source-alert' : 'service-reference-actions'} aria-label={actions.length ? 'Saved Ford service actions' : undefined}>
      <strong>{actions.length ? 'OASIS · ' : ''}{oasisActionLabel(oasis)}</strong>
      {actions.length ? <><ul>{actions.map((action, index) => <li key={`${action.code}-${index}`}><b>{action.code}</b>{action.description ? <> · {sourceDistanceText(formatSourceDateText(sourceDisplayText(action.description)))}</> : null}</li>)}</ul><Link to={recordsHref}>Review service actions in Records</Link></> : null}
    </section>
    <div className="service-reference-body">
    {(facts.length || technical.length) ? <div className="service-reference-vehicle">
    {facts.length ? <dl className="service-reference-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}{label === 'In-service' ? <small>{inService.source === 'autocheck' ? 'AutoCheck estimate' : 'OASIS'}</small> : null}</dd></div>)}</dl> : null}
    {technical.length ? <section className="service-reference-technical"><h4>Vehicle service data</h4><dl className="service-reference-facts">{technical.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{sourceDisplayText(value)}</dd></div>)}</dl></section> : null}
    </div> : null}
    {(coverage.length || checks.length || extended.length) ? <div className="service-reference-warranty">
    {coverage.length ? <section className="service-reference-coverage"><h4>Coverage notes</h4><ul className="service-coverage-list">{coverage.map((item, index) => <li key={index}><header><strong>{sourceDisplayText(item.type)}</strong></header>{item.description ? <p>{sourceDistanceText(formatSourceDateText(sourceDisplayText(item.description)))}</p> : null}</li>)}</ul></section> : null}
    {checks.length ? <section className="service-reference-coverage"><h4>Coverage check</h4>
      <p>Saved check; current coverage is not verified.</p>
      <dl className="service-reference-facts">
        <div><dt>Check mileage</dt><dd>{formatNumber(vehicle.warrantyCheck?.mileageEntered)} mi{vehicle.warrantyCheck?.mileageSource ? <small>{sourceDisplayText(vehicle.warrantyCheck.mileageSource)}</small> : null}</dd></div>
        {vehicle.warrantyCheck?.capturedAt ? <div><dt>Checked</dt><dd>{formatDate(vehicle.warrantyCheck.capturedAt)}</dd></div> : null}
        <div><dt>Check record</dt><dd>{vehicle.warrantyCheck?.dataState === 'current' ? 'Current saved record' : vehicle.warrantyCheck?.dataState === 'stale_unverified' ? 'Saved record · refresh at source' : vehicle.warrantyCheck?.dataState === 'incomplete' ? 'Partial captured record' : 'Freshness unverified'}</dd></div>
      </dl>
      {vehicle.warrantyCheck?.sourceLabel ? <p>{sourceDisplayText(vehicle.warrantyCheck.sourceLabel)}</p> : null}
      <ul className="service-coverage-list">{checks.map((item, index) => <li key={index}><header><strong>{sourceDisplayText(item.type)}</strong><span>At check: {item.status}</span></header><p>{sourceDistanceText(formatSourceDateText(sourceDisplayText(item.termText)))}</p><dl><div><dt>Mileage remaining</dt><dd>{sourceDistanceText(sourceDisplayText(item.remainingMilesText))}</dd></div><div><dt>Time remaining</dt><dd>{sourceDisplayText(item.remainingTimeText)}</dd></div></dl>{item.note ? <p>{sourceDistanceText(formatSourceDateText(sourceDisplayText(item.note)))}</p> : null}</li>)}</ul>
    </section> : null}
    {extended.length ? <section className="service-reference-coverage"><h4>Captured extended coverage dates</h4><ul>{extended.map((line, index) => <li key={index}>{sourceDistanceText(formatSourceDateText(sourceDisplayText(line)))}</li>)}</ul></section> : null}
    </div> : null}
    </div>
  </section>
}
