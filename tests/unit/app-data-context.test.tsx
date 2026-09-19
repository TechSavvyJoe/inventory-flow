import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDataProvider, useAppData } from '../../src/app/AppDataContext'
import type { BootstrapData } from '../../src/types'

const apiMocks = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  appendTransferEvent: vi.fn(),
  createTransfer: vi.fn(),
}))

vi.mock('../../src/lib/api', () => apiMocks)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

function bootstrap(reportDate: string): BootstrapData {
  return {
    meta: {
      reportDate,
      completedAt: `${reportDate}T13:00:00.000Z`,
      timezone: 'America/New_York',
      publicFreshness: 'current',
      dealerMailFreshness: 'current',
      publicCount: 0,
      crmCount: 0,
      heldVinCount: 0,
      publicChangeCounts: {
        newArrival: 0,
        removed: 0,
        priceChange: 0,
        mileageChange: 0,
        websiteStatusChange: 0,
        stockCorrection: 0,
        storeTransfer: 0,
      },
      holdChangeStatus: 'baseline',
      warnings: [],
    },
    stores: [],
    vehicles: [],
    transfers: [],
    attention: [],
    publicChanges: [],
  }
}

function ContextProbe() {
  const { data, loading, error, homeStore, setHomeStore, role, setRole, currentUser } = useAppData()
  return (
    <div>
      <output data-testid="context">{`${role}:${homeStore}`}</output>
      <output data-testid="data">{data?.meta.reportDate || 'none'}</output>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="error">{error || 'none'}</output>
      <output data-testid="user">{currentUser}</output>
      <button type="button" onClick={() => setRole('porter')}>Use porter role</button>
      <button type="button" onClick={() => setHomeStore('Lincoln')}>Use Lincoln store</button>
      <button type="button" onClick={() => setHomeStore('Ford Detroit')}>Use Ford Detroit store</button>
    </div>
  )
}

describe('AppDataProvider access-context isolation', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() })
    window.localStorage.clear()
    apiMocks.getBootstrap.mockReset()
    apiMocks.appendTransferEvent.mockReset()
    apiMocks.createTransfer.mockReset()
  })

  afterEach(() => cleanup())

  it('hides prior-store data immediately while the new store bootstrap is pending', async () => {
    const howell = deferred<BootstrapData>()
    const lincoln = deferred<BootstrapData>()
    apiMocks.getBootstrap.mockImplementation((store: string) =>
      store === 'Lincoln' ? lincoln.promise : howell.promise,
    )

    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Howell', 'manager'))
    await act(async () => howell.resolve(bootstrap('2026-08-29')))
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('2026-08-29'))

    fireEvent.click(screen.getByRole('button', { name: 'Use Lincoln store' }))

    expect(screen.getByTestId('context')).toHaveTextContent('manager:Lincoln')
    expect(screen.getByTestId('data')).toHaveTextContent('none')
    expect(screen.getByTestId('loading')).toHaveTextContent('true')
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Lincoln', 'manager'))

    await act(async () => lincoln.resolve(bootstrap('2026-08-30')))
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('2026-08-30'))
  })

  it('does not let an out-of-order prior-role response replace the active role data', async () => {
    const manager = deferred<BootstrapData>()
    const porter = deferred<BootstrapData>()
    apiMocks.getBootstrap.mockImplementation((_store: string, role: string) =>
      role === 'porter' ? porter.promise : manager.promise,
    )

    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Howell', 'manager'))

    fireEvent.click(screen.getByRole('button', { name: 'Use porter role' }))
    expect(screen.getByTestId('context')).toHaveTextContent('porter:Howell')
    expect(screen.getByTestId('data')).toHaveTextContent('none')
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Howell', 'porter'))

    await act(async () => porter.resolve(bootstrap('2026-08-30')))
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('2026-08-30'))

    await act(async () => manager.resolve(bootstrap('2026-08-28')))
    expect(screen.getByTestId('context')).toHaveTextContent('porter:Howell')
    expect(screen.getByTestId('data')).toHaveTextContent('2026-08-30')
    expect(screen.getByTestId('error')).toHaveTextContent('none')
  })

  it('aligns the UI with the canonical identity returned by the server', async () => {
    const authenticated = {
      ...bootstrap('2026-08-30'),
      access: {
        user: 'Authenticated Employee',
        role: 'sales' as const,
        store: 'Fowlerville' as const,
        canViewPrivateEvidence: true,
        canCreateTransfer: true,
      },
    }
    apiMocks.getBootstrap.mockResolvedValue(authenticated)

    render(<AppDataProvider><ContextProbe /></AppDataProvider>)

    await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('sales:Fowlerville'))
    expect(screen.getByTestId('user')).toHaveTextContent('Authenticated Employee')
    expect(window.localStorage.getItem('maxey-role')).toBe('sales')
    expect(window.localStorage.getItem('maxey-home-store')).toBe('Fowlerville')
    expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Fowlerville', 'sales')
  })

  it('does not restore a removed legacy transport role from browser preview storage', async () => {
    window.localStorage.setItem('maxey-role', 'porter')
    apiMocks.getBootstrap.mockResolvedValue(bootstrap('2026-08-30'))

    render(<AppDataProvider><ContextProbe /></AppDataProvider>)

    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Howell', 'manager'))
    expect(screen.getByTestId('context')).toHaveTextContent('manager:Howell')
  })

  it('keeps a group manager on the server-approved working store instead of snapping back to the membership home store', async () => {
    window.localStorage.setItem('maxey-role', 'group_manager')
    const howell = {
      ...bootstrap('2026-08-30'),
      access: {
        user: 'Authenticated Group Manager',
        role: 'group_manager' as const,
        authenticatedRole: 'group_manager' as const,
        store: 'Howell' as const,
        authenticatedStore: 'Howell' as const,
        canPreviewRoles: true,
        canPreviewStores: true,
        rolePreviewActive: false,
        storePreviewActive: false,
        canViewPrivateEvidence: true,
        canCreateTransfer: true,
      },
    }
    const detroit = {
      ...howell,
      access: {
        ...howell.access,
        store: 'Ford Detroit' as const,
        storePreviewActive: true,
      },
    }
    apiMocks.getBootstrap.mockImplementation((store: string) => Promise.resolve(store === 'Ford Detroit' ? detroit : howell))

    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('group_manager:Howell'))

    fireEvent.click(screen.getByRole('button', { name: 'Use Ford Detroit store' }))

    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Ford Detroit', 'group_manager'))
    await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('group_manager:Ford Detroit'))
    expect(window.localStorage.getItem('maxey-home-store')).toBe('Ford Detroit')
    expect(apiMocks.getBootstrap.mock.calls.at(-1)).toEqual(['Ford Detroit', 'group_manager'])
  })

  it('still boots and switches store/role when storage access throws on every call', async () => {
    // `readHomeStore`/`readRole` run inside AppDataProvider's own `useState`
    // initializers — above where any error boundary in the tree sits — so a
    // thrown SecurityError here (Safari private browsing, storage blocked by
    // policy) must never propagate, or the whole app fails to render with
    // nothing able to catch it.
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => {
          throw new DOMException('The operation is insecure.', 'SecurityError')
        }),
        setItem: vi.fn(() => {
          throw new DOMException('The operation is insecure.', 'SecurityError')
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      },
    })
    apiMocks.getBootstrap.mockResolvedValue(bootstrap('2026-08-30'))

    render(<AppDataProvider><ContextProbe /></AppDataProvider>)

    await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('manager:Howell'))
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('2026-08-30'))

    fireEvent.click(screen.getByRole('button', { name: 'Use Lincoln store' }))
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Lincoln', 'manager'))
    expect(screen.getByTestId('context')).toHaveTextContent('manager:Lincoln')
  })
})
