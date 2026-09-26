export type VehicleDetailLoadState = 'loading' | 'refreshing' | 'ready' | 'stale' | 'failed' | 'unavailable'

export function VehicleDetailStatus({ state, onRetry }: { state?: VehicleDetailLoadState; onRetry?: () => void }) {
  if (!state || state === 'ready') return null
  return <div className="source-warning" role="status" aria-live="polite">
    <span>{state === 'loading' ? 'Loading the full vehicle record…' : state === 'refreshing'
      ? 'Updating the full vehicle record…' : state === 'stale'
        ? 'The full record could not refresh. Previously loaded details are shown with current inventory status.' : state === 'unavailable'
          ? 'The full record is not available for this account. The authorized inventory summary is shown.'
          : 'The full record could not load. The inventory summary is still available.'}</span>
    {(state === 'failed' || state === 'stale') && onRetry ? <button type="button" className="inv-btn" onClick={onRetry}>Retry full record</button> : null}
  </div>
}
