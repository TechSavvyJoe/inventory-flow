import { useLocation } from 'react-router-dom'
import './RouteLoadingState.css'

const ROUTE_LABELS: ReadonlyArray<readonly [prefix: string, label: string]> = [
  ['/inventory', 'inventory workspace'],
  ['/transfers', 'vehicle moves'],
  ['/attention', 'action center'],
  ['/updates', 'inventory updates'],
  ['/service', 'service status'],
  ['/overview', 'inventory overview'],
  ['/manager', 'manager workspace'],
]

function routeLabel(pathname: string): string {
  if (pathname === '/') return 'inventory workspace'
  return ROUTE_LABELS.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'workspace'
}

export function RouteLoadingState() {
  const { pathname } = useLocation()
  const label = routeLabel(pathname)

  return (
    <section
      className="route-loading-state"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
    >
      <div className="route-loading-state__heading">
        <span className="route-loading-state__mark" aria-hidden="true">
          <span />
        </span>
        <div>
          <strong>Preparing {label}</strong>
          <p>Keeping your current store, filters, and work in place.</p>
        </div>
      </div>

      <div className="route-loading-state__preview" aria-hidden="true">
        <span className="route-loading-state__rail" />
        <span className="route-loading-state__line route-loading-state__line--wide" />
        <span className="route-loading-state__line route-loading-state__line--short" />
        <span className="route-loading-state__card" />
        <span className="route-loading-state__card" />
        <span className="route-loading-state__card" />
      </div>
    </section>
  )
}
