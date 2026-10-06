import { vehicleWorkspacePath, withWorkspaceReturnPath } from '../../lib/inventory-navigation'
import { STORE_NAMES, type AppDispositionCode, type OverviewBoardFlow, type OverviewException, type ServiceWorkflowStatus, type StoreName } from '../../types'

/**
 * Every href the Overview renders (OVERVIEW_SPEC §8.4). Links carry only
 * codes, store names, VINs and transfer ids — never customer text — and every
 * list they open reads its parameters once on entry and strips them.
 */

export const OVERVIEW_INVENTORY_VIEWS = [
  'on-lot',
  'away',
  'visiting',
  'in-transit',
  'conflict',
  'unaccounted',
  'return-overdue',
  'aged-60',
  'aged-90',
  'holds',
  'holds-past-expected',
  'records-incomplete',
  'disposition-keep',
  'disposition-sold-pending',
  'disposition-delivered',
  'disposition-wholesale',
  'disposition-transfer-out',
  'disposition-other',
  'disposition-none',
] as const

export type OverviewInventoryView = (typeof OVERVIEW_INVENTORY_VIEWS)[number]

export type OverviewInventorySelection =
  | { view: OverviewInventoryView; store: StoreName }
  | { view: 'holds'; store: 'all' }

export const OVERVIEW_VIN_LIMIT = 50

export const OVERVIEW_RETURN_PATH = '/overview'

export function isOverviewInventoryView(value: string | null | undefined): value is OverviewInventoryView {
  return OVERVIEW_INVENTORY_VIEWS.includes(value as OverviewInventoryView)
}

export function isStoreName(value: string | null | undefined): value is StoreName {
  return STORE_NAMES.includes(value as StoreName)
}

function query(path: string, entries: Array<[string, string]>): string {
  return `${path}?${new URLSearchParams(entries).toString()}`
}

/** A store-card count: Inventory across the group, narrowed to one Overview view. */
export function inventoryViewHref(store: StoreName, view: OverviewInventoryView): string {
  return query('/inventory', [['scope', 'group'], ['store', store], ['view', view]])
}

/** All active hold signals, including ordinary holds with no attention alert. */
export function allStoreHoldsHref(): string {
  return query('/inventory', [['scope', 'group'], ['store', 'all'], ['view', 'holds']])
}

/** An exception drill-down with no single predicate: the exact VINs, at most 50. */
export function inventoryVinsHref(vins: readonly string[]): string {
  return query('/inventory', [['scope', 'group'], ['vins', vins.slice(0, OVERVIEW_VIN_LIMIT).join(',')]])
}

export function serviceStatusHref(status: ServiceWorkflowStatus, store?: StoreName): string {
  return query('/service', [['status', status], ...(store ? [['store', store] as [string, string]] : [])])
}

export function returnOverdueHref(store: StoreName): string {
  return query('/transfers', [['view', 'return-overdue'], ['store', store]])
}

export function actionCenterHref(category: 'all' | 'moves' | 'holds' | 'inventory' | 'service'): string {
  return query('/attention', [['category', category]])
}

/** The vehicle's Records tab: AutoCheck, OASIS, sticker, invoice and Ford service history. */
export function recordsHref(vin: string, returnTo = OVERVIEW_RETURN_PATH): string {
  return vehicleWorkspacePath(vin, { tab: 'data', returnTo })
}

/** The move when this viewer can see it; otherwise the vehicle's Location & movement tab. */
export function locationHref(vin: string, transferId: string | null | undefined, returnTo = OVERVIEW_RETURN_PATH): string {
  return transferId
    ? withWorkspaceReturnPath(`/transfers?id=${encodeURIComponent(transferId)}`, returnTo)
    : vehicleWorkspacePath(vin, { tab: 'movement', returnTo })
}

export function serviceVehicleHref(vin: string, returnTo = OVERVIEW_RETURN_PATH): string {
  return withWorkspaceReturnPath(`/service?vin=${encodeURIComponent(vin)}`, returnTo)
}

/** The Inventory view for one disposition code (or none recorded) by owner store. */
export function dispositionView(code: AppDispositionCode | 'none'): OverviewInventoryView {
  return `disposition-${code.replaceAll('_', '-')}` as OverviewInventoryView
}

export type BoardLeg = OverviewBoardFlow['kind']
const BOARD_LEGS: readonly BoardLeg[] = ['outbound', 'return', 'planned']

export interface BoardRoute { from: StoreName; to: StoreName; leg: BoardLeg }

/** Reads a board arrow's Moves parameters; null unless all three are valid. */
export function readBoardRoute(params: URLSearchParams): BoardRoute | null {
  const from = params.get('from')
  const to = params.get('to')
  const leg = params.get('leg') as BoardLeg | null
  return isStoreName(from) && isStoreName(to) && from !== to && leg && BOARD_LEGS.includes(leg) ? { from, to, leg } : null
}

export interface BoardRouteRecord {
  homeStore: string
  destination: string
  currentLocation: string
  requestStatus: string
  movementStatus: string
  locationConfidence: string
}

/**
 * The server's arrow rule (server/overview-summary.mjs boardFlows) applied to
 * one move, so an arrow's count and the Moves list it opens agree.
 */
export function transferMatchesBoardRoute(record: BoardRouteRecord, { from, to, leg }: BoardRoute): boolean {
  if (['declined', 'canceled', 'closed', 'delivery_confirmed'].includes(record.requestStatus) ||
      record.movementStatus === 'returned_home' || ['unknown', 'conflicting'].includes(record.locationConfidence)) return false
  const inTransit = record.currentLocation === 'In transit'
  const returning = inTransit && record.movementStatus.includes('return')
  if (leg === 'return') return returning && record.destination === from && record.homeStore === to
  if (record.homeStore !== from || record.destination !== to) return false
  if (leg === 'outbound') return !returning && (inTransit || (isStoreName(record.currentLocation) && record.currentLocation !== record.homeStore))
  return record.currentLocation === record.homeStore && ['approved', 'transport_assigned'].includes(record.requestStatus)
}

/** OVERVIEW_SPEC §11: where each exception count leads. */
export function exceptionHref(exception: Pick<OverviewException, 'kind' | 'store' | 'vins' | 'transferIds'>): string {
  switch (exception.kind) {
    case 'location_conflict': return inventoryViewHref(exception.store, 'conflict')
    case 'no_app_record':
    case 'stale_confirmation': return inventoryViewHref(exception.store, 'unaccounted')
    case 'return_overdue': return returnOverdueHref(exception.store)
    case 'hold_past_expected': return inventoryViewHref(exception.store, 'holds-past-expected')
    case 'identity_review': return actionCenterHref('inventory')
    case 'records_incomplete': return inventoryViewHref(exception.store, 'records-incomplete')
    case 'source_conflict':
    case 'service_date_order': return inventoryVinsHref(exception.vins)
    case 'listed_but_delivered': return inventoryViewHref(exception.store, 'disposition-delivered')
    case 'delivered_move_no_disposition':
      return exception.transferIds?.length === 1
        ? withWorkspaceReturnPath(`/transfers?id=${encodeURIComponent(exception.transferIds[0])}`, OVERVIEW_RETURN_PATH)
        : inventoryVinsHref(exception.vins)
  }
}

export const OVERVIEW_VIEW_LABELS: Record<OverviewInventoryView, string> = {
  'on-lot': 'On lot',
  away: 'Away from home',
  visiting: 'Visiting',
  'in-transit': 'In transit',
  conflict: 'Location needs checking',
  unaccounted: 'Unaccounted',
  'return-overdue': 'Return overdue',
  'aged-60': 'Listed 60+ days',
  'aged-90': 'Listed 90+ days',
  holds: 'Holds',
  'holds-past-expected': 'Holds past expected',
  'records-incomplete': 'Records incomplete',
  'disposition-keep': 'Disposition: Keep',
  'disposition-sold-pending': 'Disposition: Sold pending',
  'disposition-delivered': 'Disposition: Delivered',
  'disposition-wholesale': 'Disposition: Wholesale',
  'disposition-transfer-out': 'Disposition: Transfer out',
  'disposition-other': 'Disposition: Other',
  'disposition-none': 'No disposition recorded',
}

/** The Inventory entry parameters an Overview link may carry; all are stripped on entry. */
export const OVERVIEW_INVENTORY_PARAMS = ['store', 'view', 'service', 'vins'] as const

const SERVICE_PARAM_VALUES: readonly ServiceWorkflowStatus[] = ['needs_service', 'in_service', 'serviced']
const VIN_PATTERN = /^[A-Z0-9]{5,17}$/

export interface OverviewInventoryRequest {
  overviewView?: OverviewInventorySelection
  /** A store with no view narrows Inventory to that store. */
  store?: StoreName
  serviceReadiness?: ServiceWorkflowStatus
  vins?: string[]
}

export function hasOverviewInventoryParams(params: URLSearchParams): boolean {
  return OVERVIEW_INVENTORY_PARAMS.some((key) => params.has(key))
}

/** Reads the Overview's Inventory parameters. Unknown values are ignored; null when none apply. */
export function readOverviewInventoryRequest(params: URLSearchParams): OverviewInventoryRequest | null {
  const store = params.get('store')
  const view = params.get('view')
  const service = params.get('service')
  const request: OverviewInventoryRequest = {}
  if (store === 'all' && view === 'holds') request.overviewView = { view, store }
  else if (isStoreName(store) && isOverviewInventoryView(view)) request.overviewView = { view, store }
  else if (isStoreName(store)) request.store = store
  if (SERVICE_PARAM_VALUES.includes(service as ServiceWorkflowStatus)) request.serviceReadiness = service as ServiceWorkflowStatus
  const vins = [...new Set((params.get('vins') ?? '').split(',').map((vin) => vin.trim().toUpperCase()).filter((vin) => VIN_PATTERN.test(vin)))]
    .slice(0, OVERVIEW_VIN_LIMIT)
  if (vins.length) request.vins = vins
  return Object.keys(request).length ? request : null
}

export function withoutOverviewInventoryParams(search: string): string {
  const params = new URLSearchParams(search)
  for (const key of OVERVIEW_INVENTORY_PARAMS) params.delete(key)
  const next = params.toString()
  return next ? `?${next}` : ''
}
