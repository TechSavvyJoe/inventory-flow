import { serviceWorkflowStatus } from '../../lib/service-readiness'
import {
  STORE_NAMES,
  type AttentionItem,
  type BootstrapData,
  type StoreName,
  type VehicleIssue,
  type VehicleRecord,
} from '../../types'

export type OverviewPopulation =
  | 'inventory'
  | 'on_lot'
  | 'away'
  | 'visiting'
  | 'in_transit'
  | 'holds'
  | 'waiting_service'
  | 'in_service'
  | 'ready'
  | 'location_review'
  | 'return_overdue'
  | 'records_incomplete'
  | 'manager_log_sold'
  | 'manager_log_delivered'
  | 'open_issues'

export interface OverviewRecordCoverage {
  captured: number
  applicable: number
  missing: string[]
}

export interface OverviewVehicleFact {
  vehicle: VehicleRecord
  homeStore: StoreName
  currentStore: StoreName | null
  currentLocation: string
  locationBasis: 'move_ledger' | 'source_reported' | 'stale_move_record' | 'conflict' | 'unknown'
  locationBasisLabel: string
  onLot: boolean
  away: boolean
  inTransit: boolean
  locationNeedsReview: boolean
  awayDays: number | null
  holdActive: boolean
  holdPastExpected: boolean
  serviceStatus: 'needs_service' | 'in_service' | 'serviced'
  serviceDays: number | null
  waitingListingDays: number | null
  returnOverdue: boolean
  records: OverviewRecordCoverage
  openIssues: VehicleIssue[]
}

export interface OverviewStoreSummary {
  store: StoreName
  populations: Record<OverviewPopulation, OverviewVehicleFact[]>
  attention: AttentionItem[]
  openIssues: VehicleIssue[]
}

export interface OverviewModel {
  facts: OverviewVehicleFact[]
  stores: OverviewStoreSummary[]
}

const ACTIVE_HOLD_STATES = new Set(['primary', 'backup', 'multiple'])
const TERMINAL_MOVEMENT_STATES = new Set(['returned_home', 'closed', 'canceled', 'declined'])
const IN_TRANSIT_STATES = new Set(['picked_up', 'in_transit', 'return_started', 'return_assigned', 'return_in_transit'])

function validStore(value: string | undefined | null): StoreName | null {
  return STORE_NAMES.includes(value as StoreName) ? value as StoreName : null
}

function dayParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function dateInTimeZone(value: string, timeZone: string): string | null {
  const direct = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
  if (direct) return direct
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}

export function overviewDaysBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const from = start ? dayParts(start) : null
  const to = end ? dayParts(end) : null
  if (!from || !to) return null
  const difference = Date.UTC(...([to[0], to[1] - 1, to[2]] as const)) - Date.UTC(...([from[0], from[1] - 1, from[2]] as const))
  return difference < 0 ? null : Math.floor(difference / 86_400_000)
}

function isBeforeDay(value: string | undefined, reportDate: string): boolean {
  const day = value?.slice(0, 10)
  return Boolean(day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < reportDate)
}

function resourceIsCurrent(resource: { dataState?: string } | null | undefined): boolean {
  return resource?.dataState === 'current'
}

export function overviewRecordCoverage(vehicle: VehicleRecord): OverviewRecordCoverage {
  const fordFamily = /^(ford|lincoln)$/i.test(vehicle.make.trim())
  const sources = [
    ['AutoCheck', resourceIsCurrent(vehicle.autoCheckReport)],
    ['Window sticker', resourceIsCurrent(vehicle.windowSticker)],
    ['Factory equipment', resourceIsCurrent(vehicle.factoryEquipment)],
    ...(fordFamily ? [
      ['OASIS', resourceIsCurrent(vehicle.fordOasis)],
      ['Ford service history', resourceIsCurrent(vehicle.fordOasis?.serviceHistory) && vehicle.fordOasis?.serviceHistory?.historyCaptured === true],
      ['Invoice', resourceIsCurrent(vehicle.fordInvoice)],
    ] as Array<[string, boolean]> : []),
  ] as Array<[string, boolean]>
  return {
    captured: sources.filter(([, captured]) => captured).length,
    applicable: sources.length,
    missing: sources.filter(([, captured]) => !captured).map(([label]) => label),
  }
}

function locationFact(vehicle: VehicleRecord) {
  const state = vehicle.movement.state?.trim() || 'source_reported'
  const confidence = vehicle.movement.locationConfidence
  const currentStore = validStore(vehicle.movement.currentLocation)
  if (confidence === 'conflicting' || state === 'location_exception') {
    return { currentStore: null, currentLocation: 'Location needs checking', basis: 'conflict' as const, label: 'Inventory Flow move records conflict' }
  }
  if (confidence === 'verified') {
    return { currentStore, currentLocation: vehicle.movement.currentLocation || 'Location not confirmed', basis: 'move_ledger' as const, label: 'Inventory Flow move ledger' }
  }
  if (confidence === 'stale') {
    return { currentStore, currentLocation: vehicle.movement.currentLocation || 'Last location not confirmed', basis: 'stale_move_record' as const, label: 'Last move confirmation is stale' }
  }
  if (confidence === 'reported' && currentStore) {
    return { currentStore, currentLocation: currentStore, basis: 'source_reported' as const, label: 'Source-reported store; physical custody not confirmed' }
  }
  return { currentStore, currentLocation: vehicle.movement.currentLocation || 'Location not confirmed', basis: 'unknown' as const, label: 'Physical location not confirmed' }
}

export function buildOverviewVehicleFact(
  vehicle: VehicleRecord,
  data: Pick<BootstrapData, 'meta' | 'vehicleIssues'>,
): OverviewVehicleFact {
  const location = locationFact(vehicle)
  const state = vehicle.movement.state?.trim() || 'source_reported'
  const hasDeparture = Boolean(vehicle.movement.departedAt) && !TERMINAL_MOVEMENT_STATES.has(state)
  const away = location.currentStore
    ? location.currentStore !== vehicle.homeStore
    : hasDeparture
  const onLot = location.currentStore === vehicle.homeStore && !IN_TRANSIT_STATES.has(state)
  const inTransit = IN_TRANSIT_STATES.has(state)
  const departureDay = vehicle.movement.departedAt
    ? dateInTimeZone(vehicle.movement.departedAt, data.meta.timezone)
    : null
  const serviceEnteredDay = vehicle.serviceReadiness?.serviceEnteredAt
    ? dateInTimeZone(vehicle.serviceReadiness.serviceEnteredAt, data.meta.timezone)
    : null
  const serviceCompletedDay = vehicle.serviceReadiness?.completedAt
    ? dateInTimeZone(vehicle.serviceReadiness.completedAt, data.meta.timezone)
    : null
  const serviceStatus = serviceWorkflowStatus(vehicle.serviceReadiness)
  const serviceEnd = serviceStatus === 'serviced' ? serviceCompletedDay : data.meta.reportDate
  const holdActive = ACTIVE_HOLD_STATES.has(vehicle.hold.state) || vehicle.hold.lastKnownActiveHold === true
  const records = overviewRecordCoverage(vehicle)
  return {
    vehicle,
    homeStore: vehicle.homeStore,
    currentStore: location.currentStore,
    currentLocation: location.currentLocation,
    locationBasis: location.basis,
    locationBasisLabel: location.label,
    onLot,
    away,
    inTransit,
    locationNeedsReview: location.basis === 'conflict' || location.basis === 'unknown' || location.basis === 'stale_move_record' || (away && location.basis === 'source_reported'),
    awayDays: away && departureDay ? overviewDaysBetween(departureDay, data.meta.reportDate) : null,
    holdActive,
    holdPastExpected: holdActive && isBeforeDay(vehicle.hold.expectedDate, data.meta.reportDate),
    serviceStatus,
    serviceDays: serviceStatus !== 'needs_service' && serviceEnteredDay ? overviewDaysBetween(serviceEnteredDay, serviceEnd) : null,
    waitingListingDays: serviceStatus === 'needs_service' && vehicle.publicListing === 'listed' ? vehicle.daysListed ?? null : null,
    returnOverdue: away && isBeforeDay(vehicle.movement.returnDueAt, data.meta.reportDate),
    records,
    openIssues: (data.vehicleIssues ?? []).filter(issue => issue.vin === vehicle.vin && issue.status !== 'completed'),
  }
}

function population(facts: OverviewVehicleFact[], store: StoreName): Record<OverviewPopulation, OverviewVehicleFact[]> {
  const inventory = facts.filter(fact => fact.homeStore === store)
  const openIssueFacts = facts.flatMap(fact => {
    const openIssues = fact.openIssues.filter(issue => issue.reportStore === store)
    return openIssues.length ? [{ ...fact, openIssues }] : []
  })
  return {
    inventory,
    on_lot: inventory.filter(fact => fact.onLot),
    away: inventory.filter(fact => fact.away),
    visiting: facts.filter(fact => fact.homeStore !== store && fact.currentStore === store),
    in_transit: inventory.filter(fact => fact.inTransit),
    holds: inventory.filter(fact => fact.holdActive),
    waiting_service: facts.filter(fact => (fact.vehicle.serviceReadiness?.store ?? fact.homeStore) === store && fact.serviceStatus === 'needs_service'),
    in_service: facts.filter(fact => (fact.vehicle.serviceReadiness?.store ?? fact.homeStore) === store && fact.serviceStatus === 'in_service'),
    ready: facts.filter(fact => (fact.vehicle.serviceReadiness?.store ?? fact.homeStore) === store && fact.serviceStatus === 'serviced'),
    location_review: inventory.filter(fact => fact.locationNeedsReview),
    return_overdue: inventory.filter(fact => fact.returnOverdue),
    records_incomplete: inventory.filter(fact => fact.records.captured < fact.records.applicable),
    manager_log_sold: inventory.filter(fact => Boolean(fact.vehicle.managerDisposition?.soldManagerLog)),
    manager_log_delivered: inventory.filter(fact => fact.vehicle.managerDisposition?.deliveredManagerLog === true),
    open_issues: openIssueFacts,
  }
}

function attentionStore(item: AttentionItem): StoreName | null {
  return validStore(item.actionStore ?? item.store)
}

export function buildOverviewModel(data: BootstrapData): OverviewModel {
  const facts = data.vehicles.map(vehicle => buildOverviewVehicleFact(vehicle, data))
  const stores = STORE_NAMES.map(store => ({
    store,
    populations: population(facts, store),
    attention: data.attention.filter(item => item.status !== 'resolved' && attentionStore(item) === store),
    openIssues: (data.vehicleIssues ?? []).filter(issue => issue.status !== 'completed' && issue.reportStore === store),
  }))
  return { facts, stores }
}

export function overviewMedian(values: Array<number | null>): number | null {
  const sorted = values.filter((value): value is number => value !== null).sort((left, right) => left - right)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}
