import { lazy } from 'react'

const loadInventoryPage = () => import('../features/inventory/InventoryPage')
const loadTransfersPage = () => import('../features/transfers/TransfersPage')
const loadAttentionPage = () => import('../features/attention/AttentionPage')
const loadManagerPage = () => import('../features/manager/ManagerPage')

function warmRoute(loader: () => Promise<unknown>): void {
  // The route boundary owns any user-facing load failure once React renders
  // the lazy module. Intentional preloading must not create an unhandled
  // rejection before that boundary is mounted.
  void loader().catch(() => undefined)
}

export const InventoryPage = lazy(() =>
  loadInventoryPage().then((module) => ({ default: module.InventoryPage })),
)
export const TransfersPage = lazy(() =>
  loadTransfersPage().then((module) => ({ default: module.TransfersPage })),
)
export const AttentionPage = lazy(() =>
  loadAttentionPage().then((module) => ({ default: module.AttentionPage })),
)
export const ManagerPage = lazy(() =>
  loadManagerPage().then((module) => ({ default: module.ManagerPage })),
)

export function preloadRoute(pathname: string): void {
  if (pathname === '/' || pathname.startsWith('/inventory')) {
    warmRoute(loadInventoryPage)
  } else if (pathname.startsWith('/transfers')) {
    warmRoute(loadTransfersPage)
  } else if (pathname.startsWith('/attention')) {
    warmRoute(loadAttentionPage)
  } else if (pathname.startsWith('/manager')) {
    warmRoute(loadManagerPage)
  }
}
