import type { StoreName, UserRole } from '../types'

const INVENTORY_SEARCH_STATE_KEY = 'inventorySearchRequest'

export interface InventorySearchRequest {
  query: string
  accessContext: string
}

export interface InventorySearchNavigation {
  pathname: '/inventory'
  search: '?scope=home'
  state: {
    [INVENTORY_SEARCH_STATE_KEY]: InventorySearchRequest
  }
}

export function inventorySearchAccessContext(role: UserRole, homeStore: StoreName, user?: string): string {
  return `${role}:${homeStore}${user ? `:${user}` : ''}`
}

export function createInventorySearchNavigation(
  query: string,
  accessContext: string,
): InventorySearchNavigation {
  return {
    pathname: '/inventory',
    search: '?scope=home',
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

export interface WorkspaceReturnLocation {
  pathname: string
  search?: string
  hash?: string
}

export function currentWorkspaceReturnPath(location: WorkspaceReturnLocation): string {
  return `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`
}

export function vehicleWorkspacePath(
  vin: string,
  { tab, returnTo }: { tab?: string; returnTo?: string } = {},
): string {
  const params = new URLSearchParams({ scope: 'group', vin })
  if (tab) params.set('tab', tab)
  if (returnTo) params.set('returnTo', returnTo)
  return `/inventory?${params.toString()}`
}

export function withWorkspaceReturnPath(path: string, returnTo?: string): string {
  if (!readWorkspaceReturnPath(returnTo ?? null) || !readWorkspaceReturnPath(path)) return path
  const [pathAndSearch, hash = ''] = path.split('#', 2)
  const [pathname, rawSearch = ''] = pathAndSearch.split('?', 2)
  const params = new URLSearchParams(rawSearch)
  params.set('returnTo', returnTo!)
  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`
}

export function workspaceReturnLabel(path: string | null, fallback = 'Back to inventory'): string {
  const safe = readWorkspaceReturnPath(path)
  if (!safe) return fallback
  const url = new URL(safe, 'https://inventory.invalid')
  if (url.pathname === '/inventory' || url.pathname === '/') return url.searchParams.has('vin') ? 'Back to vehicle' : 'Back to inventory'
  if (url.pathname === '/service') return 'Back to service'
  if (url.pathname === '/transfers/new') return 'Back to move form'
  if (url.pathname === '/transfers') return url.searchParams.has('id') ? 'Back to move' : 'Back to vehicle moves'
  if (url.pathname === '/attention') return 'Back to Action center'
  if (url.pathname === '/updates') return 'Back to inventory updates'
  if (url.pathname === '/overview') return 'Back to inventory overview'
  if (url.pathname === '/manager') return 'Back to group operations'
  if (url.pathname === '/admin') return 'Back to Control center'
  return fallback
}

// The destination is created by this app. Refuse protocol-relative or external
// values, and backslashes or control characters browsers can reinterpret as a
// scheme or host, so a copied URL cannot turn a close or cancel control into a
// redirect. Every caller reads a return path through here.
export function readWorkspaceReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)) return null
  return value
}
