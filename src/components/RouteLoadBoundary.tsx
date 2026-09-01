import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

interface BoundaryProps {
  children: ReactNode
  resetKey: string
}

interface BoundaryState {
  failed: boolean
}

class RouteLoadErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The requested Inventory Flow screen could not be loaded.', error, info.componentStack)
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <section className="route-load-error" role="alert">
        <span className="route-load-error__mark" aria-hidden="true">!</span>
        <div>
          <strong>This screen could not be opened</strong>
          <p>Your current data was not changed. Refresh the screen to reconnect and try again.</p>
          <button type="button" className="button button-secondary" onClick={() => window.location.reload()}>
            Refresh screen
          </button>
        </div>
      </section>
    )
  }
}

export function RouteLoadBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  return (
    <RouteLoadErrorBoundary resetKey={`${location.pathname}${location.search}`}>
      {children}
    </RouteLoadErrorBoundary>
  )
}
