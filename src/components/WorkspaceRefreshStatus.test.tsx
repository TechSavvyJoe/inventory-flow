import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRefreshStatus } from './WorkspaceRefreshStatus'
import { ErrorState } from './ErrorState'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('workspace recovery messages', () => {
  it('keeps a confirmed save distinct from the failed refresh and offers an accessible retry', () => {
    const retry = vi.fn()
    render(<WorkspaceRefreshStatus error="Connection lost" lastCheckedAt="2026-09-19T13:00:00.000Z" loading={false} savedChangesPending retry={retry} />)
    expect(screen.getByRole('status')).toHaveTextContent('Your changes were saved. Refresh is still needed.')
    expect(screen.getByRole('status')).toHaveTextContent('Showing your last checked workspace from')
    expect(screen.getByRole('status')).toHaveTextContent('Connection lost')
    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('prevents repeat retry clicks during refresh', () => {
    render(<WorkspaceRefreshStatus error="Offline" lastCheckedAt={null} loading savedChangesPending={false} retry={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
    expect(screen.getByRole('status')).not.toHaveTextContent('Your changes were saved')
  })

  it.each([401, 403] as const)('reloads the page to recover from HTTP %i rather than retrying an expired API session', (status) => {
    const reload = vi.fn()
    const retry = vi.fn()
    render(<ErrorState message="Access changed" accessStatus={status} retry={retry} />)
    const originalWindow = window
    vi.stubGlobal('window', new Proxy(originalWindow, {
      get(target, key) { return key === 'location' ? { reload } : Reflect.get(target, key) },
    }))
    fireEvent.click(screen.getByRole('button', { name: status === 401 ? 'Reload to sign in' : 'Reload to check access' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })

  it('retries an initial load failure without reloading the page', () => {
    const retry = vi.fn()
    render(<ErrorState message="Offline" retry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
