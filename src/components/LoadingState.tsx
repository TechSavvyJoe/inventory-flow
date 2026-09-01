export function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span className="loading-mark" aria-hidden="true" />
      <div>
        <strong>Loading verified inventory</strong>
        <p>Loading the latest inventory, holds, locations, and moves.</p>
      </div>
    </div>
  )
}
