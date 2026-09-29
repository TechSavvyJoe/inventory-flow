import {
  STORE_NAMES,
  type BootstrapData,
  type OverviewException,
  type OverviewStoreCounts,
  type OverviewSummary,
  type OverviewVehicleFacts,
  type SourceFreshness,
  type StoreName,
  type VehicleRecord,
} from '../../types'

/**
 * Pure selectors over the server's Overview projection (OVERVIEW_SPEC §7.4).
 * They join `overview.vehicleFacts` to `data.vehicles` by VIN, filter and
 * order; they never re-derive a count the server already published.
 */

export type OverviewScope = 'home' | 'group'
export type StoreCounts = OverviewStoreCounts & { store: StoreName }

export interface OverviewRow {
  vehicle: VehicleRecord
  facts: OverviewVehicleFacts
}

export type WhereFilter = 'away' | 'unaccounted' | 'holds' | 'waiting'

export const WHERE_FILTERS: ReadonlyArray<{ value: WhereFilter; label: string }> = [
  { value: 'away', label: 'Away from home' },
  { value: 'unaccounted', label: 'Unaccounted' },
  { value: 'holds', label: 'Holds' },
  { value: 'waiting', label: 'Waiting for service' },
]

/** The largest list the page renders before "Show all" stops growing. */
export const OVERVIEW_ROW_LIMIT = 50

/** Stores in reading order: the viewer's home store first; one store in My store scope. */
export function scopeStores(homeStore: StoreName, scope: OverviewScope): StoreName[] {
  return scope === 'home' ? [homeStore] : [homeStore, ...STORE_NAMES.filter((store) => store !== homeStore)]
}

export function storeCards(overview: OverviewSummary, stores: readonly StoreName[]): StoreCounts[] {
  return stores.flatMap((store) => overview.stores.filter((entry) => entry.store === store))
}

export function overviewRows(data: BootstrapData, overview: OverviewSummary): OverviewRow[] {
  return data.vehicles.flatMap((vehicle) => {
    const facts = overview.vehicleFacts[vehicle.vin]
    return facts ? [{ vehicle, facts }] : []
  })
}

/** The store a hold is counted under: the DealerMail (CRM) store, as the Action center counts it. */
function holdStore(vehicle: VehicleRecord): StoreName {
  return vehicle.crmStore ?? vehicle.homeStore
}

function whereMatches({ vehicle, facts }: OverviewRow, filter: WhereFilter, stores: ReadonlySet<StoreName>): boolean {
  switch (filter) {
    case 'away': return stores.has(vehicle.homeStore) && facts.custody !== 'on_lot'
    case 'unaccounted': return stores.has(vehicle.homeStore) && Boolean(facts.unaccounted)
    case 'holds': return stores.has(holdStore(vehicle)) && facts.holdActive === true
    case 'waiting': return stores.has(facts.service.store ?? vehicle.homeStore) && facts.service.status === 'needs_service'
  }
}

function whereOrder(left: OverviewRow, right: OverviewRow, filter: WhereFilter): number {
  if (filter === 'waiting') {
    return (right.facts.service.waitingDays ?? -1) - (left.facts.service.waitingDays ?? -1) ||
      left.vehicle.vehicleName.localeCompare(right.vehicle.vehicleName, 'en-US')
  }
  return Number(right.facts.returnOverdue === true) - Number(left.facts.returnOverdue === true) ||
    Number(Boolean(right.facts.unaccounted)) - Number(Boolean(left.facts.unaccounted)) ||
    (right.facts.daysAway ?? -1) - (left.facts.daysAway ?? -1) ||
    left.vehicle.vehicleName.localeCompare(right.vehicle.vehicleName, 'en-US')
}

/** "Where is my inventory": the scope's vehicles matching one filter, most urgent first. */
export function whereRows(rows: readonly OverviewRow[], filter: WhereFilter, stores: readonly StoreName[]): OverviewRow[] {
  const inScope = new Set(stores)
  return rows.filter((row) => whereMatches(row, filter, inScope)).sort((left, right) => whereOrder(left, right, filter))
}

export function whereCounts(rows: readonly OverviewRow[], stores: readonly StoreName[]): Record<WhereFilter, number> {
  const inScope = new Set(stores)
  return Object.fromEntries(WHERE_FILTERS.map(({ value }) => [value, rows.filter((row) => whereMatches(row, value, inScope)).length])) as Record<WhereFilter, number>
}

/**
 * Return-home verification for one home store, derived from facts (no server
 * list): vehicles on their return leg, and vehicles received home recently.
 */
export function returnVerification(rows: readonly OverviewRow[], store: StoreName): { returning: OverviewRow[]; received: OverviewRow[] } {
  const home = rows.filter(({ vehicle }) => vehicle.homeStore === store)
  return {
    returning: home.filter(({ facts }) => facts.custody === 'in_transit' && facts.returnLeg === 'return'),
    received: home
      .filter(({ facts }) => Boolean(facts.receivedHomeAt))
      .sort((left, right) => (right.facts.receivedHomeAt ?? '').localeCompare(left.facts.receivedHomeAt ?? '', 'en-US')),
  }
}

export function exceptionRows(overview: OverviewSummary, stores: readonly StoreName[]): OverviewException[] {
  const inScope = new Set(stores)
  return overview.exceptions.filter((exception) => inScope.has(exception.store) && exception.count > 0)
}

export interface AgedWaitingRow {
  vin: string
  vehicle?: VehicleRecord
  facts?: OverviewVehicleFacts
  store: StoreName | null
  waitingDays: number
  arrivalBasis: 'intake' | 'listing_date' | 'unknown'
}

export function agedWaitingRows(data: BootstrapData, overview: OverviewSummary, stores: readonly StoreName[]): AgedWaitingRow[] {
  const inScope = new Set(stores)
  const vehicles = new Map(data.vehicles.map((vehicle) => [vehicle.vin, vehicle]))
  return (overview.service?.agedWaiting ?? []).flatMap((entry) => {
    const vehicle = vehicles.get(entry.vin)
    const store = entry.store ?? vehicle?.homeStore ?? null
    if (!store || !inScope.has(store)) return []
    return [{ ...entry, vehicle, facts: overview.vehicleFacts[entry.vin] }]
  })
}

/** The shell's freshness words: "Current", "Refresh incomplete", "Check data". */
export function freshnessWord(state: SourceFreshness | undefined): string {
  if (state === 'current') return 'Current'
  if (state === 'incomplete') return 'Refresh incomplete'
  return 'Check data'
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
