import { RotateCcw, TriangleAlert } from 'lucide-react'
import { FlowButton } from '../design-system'

export function ErrorState({ message, retry, accessStatus }: { message: string; retry: () => void; accessStatus?: 401 | 403 | null }) {
  return (
    <div className="error-state" role="alert">
      <TriangleAlert aria-hidden="true" />
      <div>
        <strong>{accessStatus === 401 ? 'Sign in to continue' : accessStatus === 403 ? 'Workspace access needs to be checked' : 'The latest inventory and hold data could not be loaded'}</strong>
        <p>{message}</p>
        <FlowButton
          type="button"
          variant="secondary"
          iconBefore={<RotateCcw aria-hidden="true" />}
          onClick={accessStatus ? () => window.location.reload() : retry}
        >
          {accessStatus === 401 ? 'Reload to sign in' : accessStatus === 403 ? 'Reload to check access' : 'Retry'}
        </FlowButton>
      </div>
    </div>
  )
}
