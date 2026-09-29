import { lazy } from 'react'

// One loader per route chunk, shared by React.lazy and preloadRoute so a warmed
// chunk is the one the route renders. RouteLoadBoundary owns load failures; a
// legacy `?v=1` link is simply ignored.
const loaders = {
  inventory: () => import('../features/inventory/InventoryPage').then(module => ({ default: module.InventoryPage })),
  transfers: () => import('../features/transfers/TransfersPage').then(module => ({ default: module.TransfersPage })),
  service: () => import('../features/service/ServicePage').then(module => ({ default: module.ServicePage })),
  attention: () => import('../features/attention/AttentionPage').then(module => ({ default: module.AttentionPage })),
  overview: () => import('../features/overview/OverviewPage').then(module => ({ default: module.OverviewPage })),
  updates: () => import('../features/attention/InventoryUpdatesPage').then(module => ({ default: module.InventoryUpdatesPage })),
  admin: () => import('../features/admin/AdminPage').then(module => ({ default: module.AdminPage })),
}

export const InventoryPage = lazy(loaders.inventory)
export const TransfersPage = lazy(loaders.transfers)
export const ServicePage = lazy(loaders.service)
export const AttentionPage = lazy(loaders.attention)
export const OverviewPage = lazy(loaders.overview)
export const InventoryUpdatesPage = lazy(loaders.updates)
export const AdminPage = lazy(loaders.admin)

export function preloadRoute(pathname: string): void {
  const route = pathname === '/' ? 'inventory' : pathname.split('/')[1]
  const loader = Object.hasOwn(loaders, route) ? loaders[route as keyof typeof loaders] : undefined
  // Best effort: a failed preload must not become an unhandled rejection
  // before the route's boundary is mounted to report it.
  if (loader) void loader().catch(() => undefined)
}
