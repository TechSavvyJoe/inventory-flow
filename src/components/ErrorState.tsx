import { RotateCcw, TriangleAlert } from 'lucide-react'
import { FlowButton } from '../design-system'

export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <TriangleAlert aria-hidden="true" />
      <div>
        <strong>The latest inventory and hold data could not be loaded</strong>
        <p>{message}</p>
        <FlowButton
          type="button"
          variant="secondary"
          iconBefore={<RotateCcw aria-hidden="true" />}
          onClick={retry}
        >
          Retry
        </FlowButton>
      </div>
    </div>
  )
}
