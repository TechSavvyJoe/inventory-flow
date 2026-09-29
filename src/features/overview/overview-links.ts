import { vehicleWorkspacePath, withWorkspaceReturnPath } from '../../lib/inventory-navigation'
import { STORE_NAMES, type OverviewException, type ServiceWorkflowStatus, type StoreName } from '../../types'

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
] as const

export type OverviewInventoryView = (typeof OVERVIEW_INVENTORY_VIEWS)[number]

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

/** OVERVIEW_SPEC §11: where each exception count leads. */
export function exceptionHref(exception: Pick<OverviewException, 'kind' | 'store' | 'vins'>): string {
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
}

/** The Inventory entry parameters an Overview link may carry; all are stripped on entry. */
export const OVERVIEW_INVENTORY_PARAMS = ['store', 'view', 'service', 'vins'] as const

const SERVICE_PARAM_VALUES: readonly ServiceWorkflowStatus[] = ['needs_service', 'in_service', 'serviced']
const VIN_PATTERN = /^[A-Z0-9]{5,17}$/

export interface OverviewInventoryRequest {
  overviewView?: { view: OverviewInventoryView; store: StoreName }
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
  if (isStoreName(store) && isOverviewInventoryView(view)) request.overviewView = { view, store }
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
