// Store is independent from the inventory view. In particular, opening Held
// must never silently widen a salesperson's working store to the whole group.
import { STORES } from './config.mjs'

export function resolveStoreScope(scope, workingStore) {
  if (scope === 'all') return null
  return scope === 'home' ? workingStore || null : scope
}

export function matchesInventoryView(vehicle, view) {
  if (view === 'held') return vehicle.hold?.hasActiveHold === true || vehicle.hold?.lastKnownActiveHold === true
  if (view === 'moving') return Boolean(vehicle.movement)
  return true
}

export function scopeMatches(matches, { storeScope = 'home', workingStore, view = 'inventory' } = {}) {
  const store = resolveStoreScope(storeScope, workingStore)
  return matches.filter(({ vehicle }) => (!store || vehicle.homeStore === store) && matchesInventoryView(vehicle, view))
}

export function scopeCounts(matches, { storeScope = 'home', workingStore } = {}) {
  const local = scopeMatches(matches, { storeScope, workingStore })
  return { inventory: local.length, held: local.filter(({ vehicle }) => matchesInventoryView(vehicle, 'held')).length, moving: local.filter(({ vehicle }) => matchesInventoryView(vehicle, 'moving')).length }
}

// Preserve the selected sorting/search order inside each store, while always
// leading with the user's store when they deliberately open all stores.
export function groupMatchesByStore(matches, workingStore) {
  const groups = new Map()
  for (const match of matches) {
    const store = match.vehicle.homeStore || 'Store not provided'
    if (!groups.has(store)) groups.set(store, [])
    groups.get(store).push(match)
  }
  const order = [workingStore, ...STORES].filter(Boolean)
  const priority = (store) => { const index = order.indexOf(store); return index < 0 ? order.length : index }
  return [...groups.entries()].sort(([a], [b]) => priority(a) - priority(b) || a.localeCompare(b, 'en-US')).map(([store, items]) => ({ store, matches: items }))
}
