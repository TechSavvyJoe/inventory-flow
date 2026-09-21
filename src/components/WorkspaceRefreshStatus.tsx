import { RefreshCw, TriangleAlert } from 'lucide-react'
import { FlowButton } from '../design-system'
import { formatDateTime } from '../lib/format'

export function WorkspaceRefreshStatus({ error, loading, lastCheckedAt, savedChangesPending, retry }: {
  error: string
  loading: boolean
  lastCheckedAt: string | null
  savedChangesPending: boolean
  retry: () => void
}) {
  return (
    <div className="source-warning workspace-refresh-status" role="status">
      <TriangleAlert aria-hidden="true" />
      <div>
        <strong>{savedChangesPending ? 'Your changes were saved. Refresh is still needed.' : 'The latest update could not be loaded.'}</strong>
        <p>{lastCheckedAt ? `Showing your last checked workspace from ${formatDateTime(lastCheckedAt)}.` : 'Showing your last checked workspace.'} {error}</p>
        <FlowButton variant="secondary" type="button" iconBefore={<RefreshCw aria-hidden="true" />} disabled={loading} onClick={retry}>
          {loading ? 'Refreshing…' : 'Retry update'}
        </FlowButton>
      </div>
    </div>
  )
}
