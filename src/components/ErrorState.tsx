import { RotateCcw, TriangleAlert } from 'lucide-react'

export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <TriangleAlert aria-hidden="true" />
      <div>
      <strong>The latest inventory and hold data could not be loaded</strong>
        <p>{message}</p>
        <button type="button" className="button button-secondary" onClick={retry}>
          <RotateCcw aria-hidden="true" /> Retry
        </button>
      </div>
    </div>
  )
}
