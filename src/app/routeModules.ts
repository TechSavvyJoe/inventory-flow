import { createElement, lazy, type ComponentType } from 'react'
import { useLocation } from 'react-router-dom'

// ============================================================================
// Version Fallback Detection Seam
// ============================================================================

export function isV1Requested(search?: string): boolean {
  if (typeof window === 'undefined' && !search) return false
  const queryString = search !== undefined ? search : (typeof window !== 'undefined' ? window.location.search : '')
  const params = new URLSearchParams(queryString)
  return params.get('v') === '1' || params.get('version') === '1'
}

// ============================================================================
// V1 Baseline Route Loaders
// ============================================================================

export const loadInventoryPageV1 = () =>
  import('../features/inventory/InventoryPage').then((module) => ({ default: module.InventoryPage }))
export const loadTransfersPageV1 = () =>
  import('../features/transfers/TransfersPage').then((module) => ({ default: module.TransfersPage }))
export const loadServicePageV1 = () =>
  import('../features/service/ServicePage').then((module) => ({ default: module.ServicePage }))

// ============================================================================
// V2 Redesign Route Loaders (with graceful fallback to V1 during rollout)
// ============================================================================

export const loadInventoryPageV2 = () =>
  import('../features/inventory/InventoryPageV2')
    .then((module) => ({ default: module.InventoryPageV2 }))
    .catch((err) => {
      console.warn('Falling back to V1 InventoryPage:', err)
      return loadInventoryPageV1()
    })
export const loadTransfersPageV2 = () =>
  import('../features/transfers/TransfersPageV2')
    .then((module) => ({ default: module.TransfersPageV2 }))
    .catch((err) => {
      console.warn('Falling back to V1 TransfersPage:', err)
      return loadTransfersPageV1()
    })
export const loadServicePageV2 = () =>
  import('../features/service/ServicePageV2')
    .then((module) => ({ default: module.ServicePageV2 }))
    .catch((err) => {
      console.warn('Falling back to V1 ServicePage:', err)
      return loadServicePageV1()
    })

// Shared Route Loaders (Untouched between V1 and V2)
const loadAttentionPage = () => import('../features/attention/AttentionPage')
const loadManagerPage = () => import('../features/manager/ManagerPage')
const loadInventoryUpdatesPage = () => import('../features/attention/InventoryUpdatesPage')
const loadAdminPage = () => import('../features/admin/AdminPage')

// Contract Route Loaders (satisfies PROJECT.md Route Modules Contract)
export const loadInventoryPage = (): Promise<{ default: ComponentType<{ homeMode?: boolean }> }> =>
  (isV1Requested() ? loadInventoryPageV1() : loadInventoryPageV2())
export const loadTransfersPage = (): Promise<{ default: ComponentType }> =>
  (isV1Requested() ? loadTransfersPageV1() : loadTransfersPageV2())
export const loadServicePage = (): Promise<{ default: ComponentType }> =>
  (isV1Requested() ? loadServicePageV1() : loadServicePageV2())

function warmRoute(loader: () => Promise<unknown>): void {
  // The route boundary owns any user-facing load failure once React renders
  // the lazy module. Intentional preloading must not create an unhandled
  // rejection before that boundary is mounted.
  void loader().catch(() => undefined)
}

// Lazy instances
const LazyInventoryPageV1 = lazy(loadInventoryPageV1)
const LazyInventoryPageV2 = lazy(loadInventoryPageV2)
const LazyTransfersPageV1 = lazy(loadTransfersPageV1)
const LazyTransfersPageV2 = lazy(loadTransfersPageV2)
const LazyServicePageV1 = lazy(loadServicePageV1)
const LazyServicePageV2 = lazy(loadServicePageV2)

// ============================================================================
// Dynamic Routing Components for App.tsx
// ============================================================================

export function InventoryPage(props: { homeMode?: boolean }) {
  const location = useLocation()
  const isV1 = isV1Requested(location.search)
  const Component = isV1 ? LazyInventoryPageV1 : LazyInventoryPageV2
  return createElement(Component, props)
}

export function TransfersPage() {
  const location = useLocation()
  const isV1 = isV1Requested(location.search)
  const Component = isV1 ? LazyTransfersPageV1 : LazyTransfersPageV2
  return createElement(Component)
}

export function ServicePage() {
  const location = useLocation()
  const isV1 = isV1Requested(location.search)
  const Component = isV1 ? LazyServicePageV1 : LazyServicePageV2
  return createElement(Component)
}

export const AttentionPage = lazy(() => loadAttentionPage().then((module) => ({ default: module.AttentionPage })))
export const ManagerPage = lazy(() => loadManagerPage().then((module) => ({ default: module.ManagerPage })))
export const InventoryUpdatesPage = lazy(() => loadInventoryUpdatesPage().then((module) => ({ default: module.InventoryUpdatesPage })))
export const AdminPage = lazy(() => loadAdminPage().then((module) => ({ default: module.AdminPage })))

export function preloadRoute(pathname: string, search?: string): void {
  const isV1 = isV1Requested(search)
  if (pathname === '/' || pathname.startsWith('/inventory')) {
    warmRoute(isV1 ? loadInventoryPageV1 : loadInventoryPageV2)
  } else if (pathname.startsWith('/transfers')) {
    warmRoute(isV1 ? loadTransfersPageV1 : loadTransfersPageV2)
  } else if (pathname.startsWith('/service')) {
    warmRoute(isV1 ? loadServicePageV1 : loadServicePageV2)
  } else if (pathname.startsWith('/attention')) {
    warmRoute(loadAttentionPage)
  } else if (pathname.startsWith('/manager')) {
    warmRoute(loadManagerPage)
  } else if (pathname.startsWith('/updates')) {
    warmRoute(loadInventoryUpdatesPage)
  } else if (pathname.startsWith('/admin')) {
    warmRoute(loadAdminPage)
  }
}
