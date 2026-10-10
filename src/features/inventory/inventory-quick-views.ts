import { hasProviderHold, providerHoldState } from './provider-evidence-utils'
import { STORE_NAMES } from '../../types'
import { resolveCurrentLocation, sameStore } from './inventory-utils'
import type { InventoryFilters, InventoryScope, InventoryStore, InventoryVehicle } from './types'

export type QuickView = 'all' | 'no-hold' | 'held' | 'offsite' | 'moving' | 'new' | 'price'
export interface InventoryQuickViewContext { scope: InventoryScope; homeStore: InventoryStore }

const GROUP_STORES = STORE_NAMES.map(name => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name }))
const TRANSIT_STATES = new Set(['in_transit', 'picked_up', 'return_in_transit', 'returning'])
const UNKNOWN_LOCATION = /^(?:unknown|unconfirmed|location not confirmed|location needs checking|not recorded|not provided)$/i

function inTransit(vehicle: InventoryVehicle): boolean {
  return [vehicle.movement?.state, vehicle.movement?.custodyStatus, vehicle.movement?.requestStatus]
    .some(state => TRANSIT_STATES.has(state ?? ''))
}

function hasHold(vehicle: InventoryVehicle): boolean {
  const hold = vehicle.dealerMail
  return hasProviderHold(vehicle) || vehicle.manualHold?.state === 'active' || hold.lastKnownActiveHold === true || (hold.dataState === 'current' && hold.hasActiveHold === true)
}

/** Home inventory includes its owned units and positively located visitors. */
export function inventoryInLocationScope(vehicle: InventoryVehicle, scope: InventoryScope, homeStore: InventoryStore): boolean {
  return scope === 'group' || sameStore(vehicle.location.homeStore, homeStore) || sameStore(resolveCurrentLocation(vehicle).store, homeStore)
}

/** Apply alongside inventoryInLocationScope; views never promise availability. */
export function matchesInventoryQuickView(vehicle: InventoryVehicle, view: QuickView, context: InventoryQuickViewContext): boolean {
  if (view === 'held') return hasHold(vehicle)
  if (view === 'moving') return Boolean(vehicle.movement && (vehicle.movement.state || vehicle.movement.requestId))
  if (view === 'new') return /new arrival|new today/i.test(vehicle.changeSummary ?? '')
  if (view === 'price') return /price/i.test(vehicle.changeSummary ?? '')
  if (view === 'all') return true

  const location = resolveCurrentLocation(vehicle)
  if (vehicle.location.conflict || location.provenance === 'unknown' || UNKNOWN_LOCATION.test(location.label.trim())) return false
  if (view === 'no-hold') {
    const hold = vehicle.dealerMail
    const observedNoHold = vehicle.operationalEvidence ? providerHoldState(vehicle) === false :
      (hold.dataState === 'current' && hold.hasActiveHold === false) || (hold.dataState === 'stale' && hold.lastKnownNoHold === true)
    const atStore = context.scope === 'home'
      ? sameStore(location.store, context.homeStore)
      : GROUP_STORES.some(store => sameStore(location.store, store))
    return observedNoHold && !hasHold(vehicle) && atStore && !inTransit(vehicle) &&
      vehicle.dealerMail.loaner?.active !== true && vehicle.managerDisposition?.sold !== true
  }

  // Offsite is relative to ownership, not to the employee's chosen group
  // store. A visitor at this location is not one of this store's offsite units.
  if (context.scope === 'home' && !sameStore(vehicle.location.homeStore, context.homeStore)) return false
  if (inTransit(vehicle)) return true
  if (location.store) return !sameStore(location.store, vehicle.location.homeStore)
  // The ledger's explicit transit location remains useful when its transfer
  // link is withheld. Arbitrary workshop text has no structured store identity
  // or offsite flag, so do not infer that it is outside the home store.
  return location.provenance === 'app-confirmed' && Boolean(vehicle.location.appConfirmedAt) &&
    location.label.trim().toLowerCase() === 'in transit'
}

/**
 * Hold and movement are independent facets. Quick views only provide
 * convenient entry points into those facets; selecting one must not erase the
 * other.
 */
export interface InventoryViewState { quickView: QuickView; filters: InventoryFilters }

export function filterPanelHoldValue({ quickView, filters }: InventoryViewState): InventoryFilters['dealerMail'] {
  return filters.dealerMail === 'all' && quickView === 'held' ? 'held' : filters.dealerMail
}

export function filterPanelMovementValue({ quickView, filters }: InventoryViewState): InventoryFilters['movement'] {
  return filters.movement === 'all' && quickView === 'moving' ? 'active' : filters.movement
}

export function selectHoldFilter(state: InventoryViewState, value: InventoryFilters['dealerMail']): InventoryViewState {
  const quickView = state.quickView === 'held' || (state.quickView === 'no-hold' && (value === 'held' || value === 'unverified')) ? 'all' : state.quickView
  return { quickView, filters: { ...state.filters, dealerMail: value } }
}

export function selectMovementFilter(state: InventoryViewState, value: InventoryFilters['movement']): InventoryViewState {
  return { quickView: state.quickView === 'moving' ? 'all' : state.quickView, filters: { ...state.filters, movement: value } }
}

export function selectQuickView(state: InventoryViewState, view: QuickView): InventoryViewState {
  if (view === 'held') {
    const quickView = state.quickView === 'no-hold' ? 'all' : state.quickView === 'held' ? 'all' : state.quickView
    return { quickView, filters: { ...state.filters, dealerMail: 'held' } }
  }
  if (view === 'moving') {
    return { quickView: state.quickView === 'moving' ? 'all' : state.quickView, filters: { ...state.filters, movement: 'active' } }
  }
  if (view === 'all') return { quickView: 'all', filters: { ...state.filters, dealerMail: 'all' } }
  if (view === 'no-hold') return { quickView: view, filters: { ...state.filters, dealerMail: 'all' } }
  return { quickView: view, filters: state.filters }
}

export function toggleSecondaryQuickView(state: InventoryViewState, view: Extract<QuickView, 'moving' | 'new' | 'price'>): InventoryViewState {
  if (view === 'moving') {
    return { quickView: state.quickView === 'moving' ? 'all' : state.quickView,
      filters: { ...state.filters, movement: state.filters.movement === 'active' ? 'all' : 'active' } }
  }
  return { ...state, quickView: state.quickView === view ? 'all' : view }
}
