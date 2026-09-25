import { STORE_NAMES } from '../../types'
import { resolveCurrentLocation, sameStore } from './inventory-utils'
import type { InventoryScope, InventoryStore, InventoryVehicle } from './types'

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
  return hold.lastKnownActiveHold === true || (hold.dataState === 'current' && hold.hasActiveHold === true)
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
    const observedNoHold = (hold.dataState === 'current' && hold.hasActiveHold === false) ||
      (hold.dataState === 'stale' && hold.lastKnownNoHold === true)
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
