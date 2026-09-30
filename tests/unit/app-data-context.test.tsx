import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDataProvider, useAppData } from '../../src/app/AppDataContext'
import { apiAccessGeneration, recordConfirmedMutation, reportAccessFailure } from '../../src/lib/apiSession'
import type { BootstrapData, TransferRecord, TransferRequestInput } from '../../src/types'

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

let context: ReturnType<typeof useAppData>

function ContextProbe() {
  context = useAppData()
  const { data, loading, error, homeStore, setHomeStore, role, setRole, currentUser } = context
  return (
    <div>
      <output data-testid="context">{`${role}:${homeStore}`}</output>
      <output data-testid="data">{data?.meta.reportDate || 'none'}</output>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="error">{error || 'none'}</output>
      <output data-testid="user">{currentUser}</output>
      <button type="button" onClick={() => setRole('porter')}>Use porter role</button>
      <button type="button" onClick={() => setHomeStore('Howell')}>Use Howell store</button>
      <button type="button" onClick={() => setHomeStore('Lincoln')}>Use Lincoln store</button>
      <button type="button" onClick={() => setHomeStore('Ford Detroit')}>Use Ford Detroit store</button>
    </div>
  )
}

describe('AppDataProvider access-context isolation', () => {
  it('clears mounted employee drafts and API generations when same-name memberships switch', async () => {
    const a: BootstrapData = { ...bootstrap('2026-09-30'), access:{ user:'Synthetic Same Name', userId:'synthetic-owner-a', role:'manager', store:'Howell', canViewPrivateEvidence:true, canCreateTransfer:true } }
    apiMocks.getBootstrap.mockResolvedValueOnce(a).mockResolvedValueOnce({ ...a, access:{ ...a.access!, userId:'synthetic-owner-b' } })
    function EmployeeDraft() {
      context = useAppData()
      const [draft, setDraft] = useState('')
      return <label>Private customer draft<input value={draft} onChange={event => setDraft(event.target.value)} /></label>
    }
    render(<AppDataProvider><EmployeeDraft /></AppDataProvider>)
    await waitFor(() => expect(context.currentUserId).toBe('synthetic-owner-a'))
    fireEvent.change(screen.getByRole('textbox', { name:'Private customer draft' }), { target:{ value:'Previous owner draft' } })
    const priorGeneration = apiAccessGeneration()
    await act(async () => { await context.refresh() })
    expect(context.currentUserId).toBe('synthetic-owner-b')
    expect(context.currentUser).toBe('Synthetic Same Name')
    expect(screen.getByRole('textbox', { name:'Private customer draft' })).toHaveValue('')
    expect(apiAccessGeneration()).toBeGreaterThan(priorGeneration)
  })

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() })
    window.localStorage.clear()
    apiMocks.getBootstrap.mockReset()
    apiMocks.appendTransferEvent.mockReset()
    apiMocks.createTransfer.mockReset()
  })

  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

  it('hides prior-store data immediately while the new store bootstrap is pending', async () => {
    const howell = deferred<BootstrapData>()
    const lincoln = deferred<BootstrapData>()
    apiMocks.getBootstrap.mockImplementation((store: string) =>
      store === 'Lincoln' ? lincoln.promise : howell.promise,
    )

    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Howell', 'manager', expect.any(AbortSignal)))
    await act(async () => howell.resolve(bootstrap('2026-08-29')))
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('2026-08-29'))

    fireEvent.click(screen.getByRole('button', { name: 'Use Lincoln store' }))

    expect(screen.getByTestId('context')).toHaveTextContent('manager:Lincoln')
    expect(screen.getByTestId('data')).toHaveTextContent('none')
    expect(screen.getByTestId('loading')).toHaveTextContent('true')
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Lincoln', 'manager', expect.any(AbortSignal)))

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
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Howell', 'manager', expect.any(AbortSignal)))

    fireEvent.click(screen.getByRole('button', { name: 'Use porter role' }))
    expect(screen.getByTestId('context')).toHaveTextContent('porter:Howell')
    expect(screen.getByTestId('data')).toHaveTextContent('none')
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Howell', 'porter', expect.any(AbortSignal)))

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
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Fowlerville', 'sales', expect.any(AbortSignal)))
  })

  it('does not restore a removed legacy transport role from browser preview storage', async () => {
    window.localStorage.setItem('maxey-role', 'porter')
    apiMocks.getBootstrap.mockResolvedValue(bootstrap('2026-08-30'))

    render(<AppDataProvider><ContextProbe /></AppDataProvider>)

    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Howell', 'manager', expect.any(AbortSignal)))
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

    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Ford Detroit', 'group_manager', expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('group_manager:Ford Detroit'))
    expect(window.localStorage.getItem('maxey-home-store')).toBe('Ford Detroit')
    expect(apiMocks.getBootstrap.mock.calls.at(-1)).toEqual(['Ford Detroit', 'group_manager', expect.any(AbortSignal)])
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
    await waitFor(() => expect(apiMocks.getBootstrap).toHaveBeenCalledWith('Lincoln', 'manager', expect.any(AbortSignal)))
    expect(screen.getByTestId('context')).toHaveTextContent('manager:Lincoln')
  })

  it('keeps the last checked workspace through a transient refresh failure and recovers on retry', async () => {
    apiMocks.getBootstrap.mockResolvedValueOnce(bootstrap('2026-08-30'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(context.data).not.toBeNull())
    const lastChecked = context.lastCheckedAt
    const failed = deferred<BootstrapData>()
    apiMocks.getBootstrap.mockReturnValueOnce(failed.promise)
    let refreshing!: Promise<void>
    act(() => { refreshing = context.refresh() })
    expect(context.loading).toBe(true)
    expect(context.data?.meta.reportDate).toBe('2026-08-30')
    await act(async () => { failed.reject(new TypeError('Connection lost')); await refreshing })
    expect(context.data?.meta.reportDate).toBe('2026-08-30')
    expect(context.lastCheckedAt).toBe(lastChecked)
    expect(context.error).toBe('Connection lost')
    expect(context.loading).toBe(false)
    expect(context.accessErrorStatus).toBeNull()
    apiMocks.getBootstrap.mockResolvedValueOnce(bootstrap('2026-08-31'))
    await act(async () => { await context.refresh() })
    expect(context.data?.meta.reportDate).toBe('2026-08-31')
    expect(context.error).toBeNull()
  })

  it('shows an initial failure without inventing a cached workspace', async () => {
    apiMocks.getBootstrap.mockRejectedValue(new TypeError('Offline'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(context.error).toBe('Offline'))
    expect(context.data).toBeNull()
    expect(context.lastCheckedAt).toBeNull()
    expect(context.loading).toBe(false)
  })

  it.each([401, 403] as const)('clears protected data on a bootstrap HTTP %i failure and stops automatic reads', async (status) => {
    apiMocks.getBootstrap.mockResolvedValueOnce(bootstrap('2026-08-30'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(context.data).not.toBeNull())
    apiMocks.getBootstrap.mockRejectedValueOnce(Object.assign(new Error('Access changed'), { status }))
    await act(async () => { await context.refresh() })
    expect(context.data).toBeNull()
    expect(context.lastCheckedAt).toBeNull()
    expect(context.accessErrorStatus).toBe(status)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000)
    fireEvent.focus(window)
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(2)
  })

  it('clears protected data when a detail request loses access and rejects a late bootstrap result', async () => {
    apiMocks.getBootstrap.mockResolvedValueOnce(bootstrap('2026-08-30'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(context.data).not.toBeNull())
    const late = deferred<BootstrapData>()
    apiMocks.getBootstrap.mockReturnValueOnce(late.promise)
    act(() => { void context.refresh() })
    const signal = apiMocks.getBootstrap.mock.calls.at(-1)?.[2] as AbortSignal
    act(() => reportAccessFailure({ status: 401, role: 'manager', store: 'Howell', message: 'Sign in again' }))
    expect(context.data).toBeNull()
    expect(signal.aborted).toBe(true)
    await act(async () => late.resolve(bootstrap('2026-09-01')))
    expect(context.data).toBeNull()
    expect(context.error).toBe('Sign in again')
  })

  it('ignores an access failure belonging to a previous store', async () => {
    apiMocks.getBootstrap.mockResolvedValue(bootstrap('2026-08-30'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(context.data).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Use Lincoln store' }))
    await waitFor(() => expect(context.loading).toBe(false))
    act(() => reportAccessFailure({ status: 403, role: 'manager', store: 'Howell', message: 'Old request denied' }))
    expect(context.data).not.toBeNull()
    expect(context.accessErrorStatus).toBeNull()
  })

  it('deduplicates overlapping refreshes and cancels the read when the context changes', async () => {
    const read = deferred<BootstrapData>()
    apiMocks.getBootstrap.mockReturnValue(read.promise)
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => { first = context.refresh(); second = context.refresh() })
    expect(first).toBe(second)
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(1)
    const signal = apiMocks.getBootstrap.mock.calls[0][2] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Use Lincoln store' }))
    expect(signal.aborted).toBe(true)
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(2)
    await act(async () => read.resolve(bootstrap('2026-08-30')))
    expect(context.homeStore).toBe('Lincoln')
  })

  it('keeps a confirmed save successful when the follow-up read fails and cancels a pre-save read', async () => {
    apiMocks.getBootstrap.mockResolvedValueOnce(bootstrap('2026-08-30'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(context.data).not.toBeNull())
    const preSave = deferred<BootstrapData>()
    apiMocks.getBootstrap.mockReturnValueOnce(preSave.promise).mockRejectedValueOnce(new Error('Refresh unavailable'))
    act(() => { void context.refresh() })
    const signal = apiMocks.getBootstrap.mock.calls.at(-1)?.[2] as AbortSignal
    const saved = { id: 'synthetic-saved-transfer' } as TransferRecord
    apiMocks.createTransfer.mockResolvedValueOnce(saved)
    let result: TransferRecord | undefined
    await act(async () => { result = await context.submitTransfer({} as TransferRequestInput) })
    expect(result).toBe(saved)
    expect(signal.aborted).toBe(true)
    expect(context.error).toBe('Refresh unavailable')
    expect(context.savedChangesPending).toBe(true)
    expect(context.data?.meta.reportDate).toBe('2026-08-30')
    await act(async () => preSave.resolve(bootstrap('2026-08-29')))
    expect(context.data?.meta.reportDate).toBe('2026-08-30')
    apiMocks.getBootstrap.mockResolvedValueOnce(bootstrap('2026-08-31'))
    await act(async () => { await context.refresh() })
    expect(context.savedChangesPending).toBe(false)
  })

  it('starts a new read for a confirmed service save even when an earlier read is pending', async () => {
    const stale = deferred<BootstrapData>()
    apiMocks.getBootstrap.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(bootstrap('2026-08-31'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    const signal = apiMocks.getBootstrap.mock.calls[0][2] as AbortSignal
    recordConfirmedMutation()
    await act(async () => { await context.refresh() })
    expect(signal.aborted).toBe(true)
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(2)
    await act(async () => stale.resolve(bootstrap('2026-08-29')))
    expect(context.data?.meta.reportDate).toBe('2026-08-31')
  })

  it('does not let a save from an old context start a read for the new context', async () => {
    apiMocks.getBootstrap.mockResolvedValue(bootstrap('2026-08-30'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(context.data).not.toBeNull())
    const save = deferred<TransferRecord>()
    apiMocks.createTransfer.mockReturnValueOnce(save.promise)
    let pending!: Promise<TransferRecord>
    act(() => { pending = context.submitTransfer({} as TransferRequestInput) })
    fireEvent.click(screen.getByRole('button', { name: 'Use Lincoln store' }))
    await waitFor(() => expect(context.loading).toBe(false))
    await act(async () => { save.resolve({ id: 'synthetic-transfer' } as TransferRecord); await pending })
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(2)
    expect(context.homeStore).toBe('Lincoln')
  })

  it('refreshes on foreground return at most once per minute and does not poll hidden pages', async () => {
    const now = Date.now()
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    apiMocks.getBootstrap.mockResolvedValue(bootstrap('2026-08-30'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(context.data).not.toBeNull())
    fireEvent.focus(window)
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(1)
    dateNow.mockReturnValue(now + 60_000)
    visibility.mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.focus(window)
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(1)
    visibility.mockReturnValue('visible')
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'))
      fireEvent.focus(window)
      fireEvent(window, new Event('online'))
    })
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(2)
    dateNow.mockReturnValue(now + 120_000)
    await act(async () => { fireEvent.focus(window) })
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(3)
  })

  it('checks a visible workspace once a minute and cancels the timer and active read on unmount', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    apiMocks.getBootstrap.mockResolvedValue(bootstrap('2026-08-30'))
    const mounted = render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await act(async () => { await Promise.resolve() })
    expect(context.data).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999) })
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(2)
    visibility.mockReturnValue('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(2)
    const stalled = deferred<BootstrapData>()
    apiMocks.getBootstrap.mockReturnValue(stalled.promise)
    visibility.mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    const signal = apiMocks.getBootstrap.mock.calls.at(-1)?.[2] as AbortSignal
    mounted.unmount()
    expect(signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(3)
  })


  it('ignores an old mutation rejection after leaving and returning to the same role and store', async () => {
    apiMocks.getBootstrap.mockResolvedValue(bootstrap('2026-08-30'))
    render(<AppDataProvider><ContextProbe /></AppDataProvider>)
    await waitFor(() => expect(context.data).not.toBeNull())
    const oldSave = deferred<TransferRecord>()
    apiMocks.createTransfer.mockReturnValueOnce(oldSave.promise)
    const pending = context.submitTransfer({} as TransferRequestInput)
    const outcome = expect(pending).rejects.toMatchObject({ status: 401 })
    fireEvent.click(screen.getByRole('button', { name: 'Use Lincoln store' }))
    await waitFor(() => expect(context.loading).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Use Howell store' }))
    await waitFor(() => expect(context.loading).toBe(false))
    await act(async () => { oldSave.reject(Object.assign(new Error('Old session expired'), { status: 401 })); await outcome })
    expect(context.data).not.toBeNull()
    expect(context.accessErrorStatus).toBeNull()
    expect(apiMocks.getBootstrap).toHaveBeenCalledTimes(3)
  })

})
