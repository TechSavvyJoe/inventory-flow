import type { StoreName, UserRole } from '../../types'

const INVENTORY_SEARCH_STATE_KEY = 'inventorySearchRequest'

export interface InventorySearchRequest {
  query: string
  accessContext: string
}

export interface InventorySearchNavigation {
  pathname: '/inventory'
  search: '?scope=group'
  state: {
    [INVENTORY_SEARCH_STATE_KEY]: InventorySearchRequest
  }
}

export function inventorySearchAccessContext(role: UserRole, homeStore: StoreName): string {
  return `${role}:${homeStore}`
}

export function createInventorySearchNavigation(
  query: string,
  accessContext: string,
): InventorySearchNavigation {
  return {
    pathname: '/inventory',
    search: '?scope=group',
    state: {
      [INVENTORY_SEARCH_STATE_KEY]: {
        query: query.trim(),
        accessContext,
      },
    },
  }
}

export function hasInventorySearchRequest(state: unknown): boolean {
  return Boolean(
    state &&
      typeof state === 'object' &&
      Object.prototype.hasOwnProperty.call(state, INVENTORY_SEARCH_STATE_KEY),
  )
}

export function readInventorySearchRequest(
  state: unknown,
  expectedAccessContext: string,
): InventorySearchRequest | null {
  if (!state || typeof state !== 'object') return null

  const request = (state as Record<string, unknown>)[INVENTORY_SEARCH_STATE_KEY]
  if (!request || typeof request !== 'object') return null

  const query = (request as Record<string, unknown>).query
  const accessContext = (request as Record<string, unknown>).accessContext
  if (typeof query !== 'string' || accessContext !== expectedAccessContext) return null

  return {
    query: query.trim(),
    accessContext: expectedAccessContext,
  }
}

export function stripLegacyInventorySearchQuery(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('q')
  const nextSearch = params.toString()
  return nextSearch ? `?${nextSearch}` : ''
}
