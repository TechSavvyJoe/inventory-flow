import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { appendAttentionEvent, appendTransferEvent, createTransfer, getBootstrap } from '../lib/api'
import { apiAccessGeneration, confirmedMutationRevision, invalidateApiAccess, isOperationDenial, setBootstrapPreviewIntent, subscribeAccessFailures } from '../lib/apiSession'
import { clearWorkspaceMemory } from '../lib/workspace-memory'
import { confirmUnsavedWork } from '../lib/useUnsavedChanges'
import { clearCustomerShortlist } from '../features/inventory/useCustomerShortlist'
import { clearRecentSearches } from '../features/inventory/InventoryPredictiveSearch'
import {
  STORE_NAMES,
  type AttentionEventInput,
  type AttentionItem,
  type BootstrapData,
  type StoreName,
  type TransferEventInput,
  type TransferRecord,
  type TransferRequestInput,
  type UserRole,
} from '../types'

interface AppDataContextValue {
  data: BootstrapData | null
  loading: boolean
  error: string | null
  accessErrorStatus: 401 | 403 | null
  lastCheckedAt: string | null
  savedChangesPending: boolean
  homeStore: StoreName
  setHomeStore: (store: StoreName) => void
  role: UserRole
  setRole: (role: UserRole) => void
  currentUser: string
  currentUserId: string | null
  refresh: () => Promise<void>
  submitTransfer: (input: TransferRequestInput) => Promise<TransferRecord>
  addTransferEvent: (transferId: string, input: TransferEventInput) => Promise<TransferRecord>
  addAttentionEvent: (attentionId: string, input: AttentionEventInput) => Promise<AttentionItem>
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

interface BootstrapState {
  accessContext: string
  data: BootstrapData | null
  loading: boolean
  error: string | null
  accessErrorStatus: 401 | 403 | null
  lastCheckedAt: string | null
  savedChangesPending: boolean
}

interface BootstrapRequest {
  accessContext: string
  mutationRevision: number
  controller: AbortController
  promise: Promise<void>
}

const FOREGROUND_REFRESH_MS = 60_000

function clearClientWorkspace() {
  invalidateApiAccess()
  clearWorkspaceMemory()
  clearCustomerShortlist()
  clearRecentSearches()
}

function emptyBootstrap(accessContext: string): BootstrapState {
  return { accessContext, data: null, loading: true, error: null, accessErrorStatus: null, lastCheckedAt: null, savedChangesPending: false }
}

function accessFailureStatus(caught: unknown): 401 | 403 | null {
  if (isOperationDenial(caught)) return null
  if (caught && typeof caught === 'object' && 'status' in caught) {
    if (caught.status === 401 || caught.status === 403) return caught.status
  }
  return null
}

// `readHomeStore`/`readRole` run inside `useState` initializers, i.e. during
// AppDataProvider's own render — above where any error boundary in the tree
// sits (App.tsx only wraps AppShell, not the provider around it). A thrown
// SecurityError here (Safari private browsing, storage blocked by policy)
// would take down the whole app to a blank page with nothing able to catch
// it, so these reads must never throw.
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Best-effort only; the app must keep working with the in-memory value.
  }
}

function readHomeStore(): StoreName {
  const stored = readStorage('maxey-home-store')
  return STORE_NAMES.includes(stored as StoreName) ? (stored as StoreName) : 'Howell'
}

function readRole(): UserRole {
  const stored = readStorage('maxey-role')
  // Only the three customer-facing roles remain selectable. Legacy transport
  // memberships are still honored when the server returns one, but an old
  // preview saved in this browser must not silently restore a removed option.
  return stored === 'sales' || stored === 'group_manager' || stored === 'manager'
    ? stored
    : 'manager'
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [homeStore, setHomeStoreState] = useState<StoreName>(readHomeStore)
  const [role, setRoleState] = useState<UserRole>(readRole)
  // Stored UI choices are not an explicit production preview request. Learn
  // the server-owned membership first; only a user action enables previews.
  const previewSelectedRef = useRef(false)
  const accessContext = `${role}:${homeStore}`
  const latestAccessContextRef = useRef(accessContext)
  const requestSequenceRef = useRef(0)
  const inFlightRef = useRef<BootstrapRequest | null>(null)
  const lastAttemptRef = useRef(0)
  const accessErrorRef = useRef<401 | 403 | null>(null)
  const knownUserRef = useRef<string | null>(null)
  const lastSyncedMutationRef = useRef(confirmedMutationRevision())
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>(() => emptyBootstrap(accessContext))
  latestAccessContextRef.current = accessContext
  const stateMatchesAccessContext = bootstrapState.accessContext === accessContext
  const data = stateMatchesAccessContext ? bootstrapState.data : null
  const loading = stateMatchesAccessContext ? bootstrapState.loading : true
  const error = stateMatchesAccessContext ? bootstrapState.error : null
  const accessErrorStatus = stateMatchesAccessContext ? bootstrapState.accessErrorStatus : null
  const lastCheckedAt = stateMatchesAccessContext ? bootstrapState.lastCheckedAt : null
  const savedChangesPending = stateMatchesAccessContext && bootstrapState.savedChangesPending

  const cancelRead = useCallback(() => {
    requestSequenceRef.current += 1
    inFlightRef.current?.controller.abort()
    inFlightRef.current = null
  }, [])

  const clearAccess = useCallback((context: string, status: 401 | 403, message: string) => {
    if (latestAccessContextRef.current !== context) return
    cancelRead()
    clearClientWorkspace()
    knownUserRef.current = null
    accessErrorRef.current = status
    setBootstrapState({ ...emptyBootstrap(context), loading: false, error: message, accessErrorStatus: status })
  }, [cancelRead])

  useEffect(() => subscribeAccessFailures((failure) => {
    const context = latestAccessContextRef.current
    // A rejected request from a previous role/store must not log out the new
    // workspace. Null identity headers are conservative session-wide failures.
    if (failure.role && failure.store && context !== `${failure.role}:${failure.store}`) return
    clearAccess(context, failure.status, failure.message)
  }), [clearAccess])

  // `background` marks a read the person never asked for (the foreground
  // timer, a focus/online event, or a silent visibility check). Those reads
  // must not flip `loading` to true while data is already on screen — that
  // repaints the vehicle workspace and announces "Loading the full vehicle
  // record…" through a polite live region every poll. A real ask (mount,
  // the Refresh button, an ErrorState retry, or a post-mutation reload)
  // always shows loading as before. If a foreground ask instead joins an
  // in-flight background read (the dedupe branch below), it still flips
  // loading to true so the button it came from responds.
  const refreshBootstrap = useCallback((afterMutation = false, background = false): Promise<void> => {
    if (latestAccessContextRef.current !== accessContext || accessErrorRef.current) return Promise.resolve()
    const mutationRevision = confirmedMutationRevision()
    const pending = inFlightRef.current
    if (!afterMutation && pending?.accessContext === accessContext && pending.mutationRevision === mutationRevision) {
      if (!background) {
        setBootstrapState((current) => (current.accessContext === accessContext && !current.loading)
          ? { ...current, loading: true }
          : current)
      }
      return pending.promise
    }
    cancelRead()
    const requestId = requestSequenceRef.current
    const controller = new AbortController()
    setBootstrapPreviewIntent(controller.signal, previewSelectedRef.current)
    lastAttemptRef.current = Date.now()
    setBootstrapState((current) => {
      const matchesContext = current.accessContext === accessContext
      const hasData = matchesContext && current.data != null
      return {
        ...(matchesContext ? current : emptyBootstrap(accessContext)),
        loading: background && hasData ? current.loading : true,
        error: matchesContext && current.data ? current.error : null,
        accessErrorStatus: null,
        savedChangesPending: afterMutation || mutationRevision !== lastSyncedMutationRef.current || current.savedChangesPending,
      }
    })
    const promise = (async () => {
      try {
        const nextData = await getBootstrap(homeStore, role, controller.signal)
        if (requestId !== requestSequenceRef.current || latestAccessContextRef.current !== accessContext) return
        const nextUser = JSON.stringify([nextData.access?.userId ?? null, nextData.access?.user ?? null])
        // Only a change of identity clears the workspace. When the user is first
        // learned there is nothing stale: the mount effect and clearAccess already
        // cleared everything before this request, and clearing again would bump
        // the access generation and discard the bootstrap validator this response
        // just stored, turning every tab's first refresh into a full download.
        if (knownUserRef.current !== null && knownUserRef.current !== nextUser) clearClientWorkspace()
        knownUserRef.current = nextUser
        const authenticatedRole = nextData.access?.role ?? role
        const authenticatedStore = nextData.access?.store ?? homeStore
        const authenticatedContext = `${authenticatedRole}:${authenticatedStore}`
        if (authenticatedRole !== role || authenticatedStore !== homeStore) {
          writeStorage('maxey-role', authenticatedRole)
          writeStorage('maxey-home-store', authenticatedStore)
          latestAccessContextRef.current = authenticatedContext
          setRoleState(authenticatedRole)
          setHomeStoreState(authenticatedStore)
        }
        lastSyncedMutationRef.current = mutationRevision
        setBootstrapState({
          accessContext: authenticatedContext, data: nextData, loading: false, error: null,
          accessErrorStatus: null, lastCheckedAt: new Date().toISOString(), savedChangesPending: false,
        })
      } catch (caught) {
        if (controller.signal.aborted || requestId !== requestSequenceRef.current || latestAccessContextRef.current !== accessContext) return
        const message = caught instanceof Error ? caught.message : 'Unable to load the current inventory data.'
        const status = accessFailureStatus(caught)
        if (status) {
          clearAccess(accessContext, status, message)
          return
        }
        // Transient failures never turn a known successful save into a failed
        // action or discard the last authenticated in-memory workspace.
        setBootstrapState((current) => ({
          ...(current.accessContext === accessContext ? current : emptyBootstrap(accessContext)),
          loading: false, error: message,
        }))
      } finally {
        if (inFlightRef.current?.controller === controller) inFlightRef.current = null
      }
    })()
    inFlightRef.current = { accessContext, mutationRevision, controller, promise }
    return promise
  }, [accessContext, cancelRead, clearAccess, homeStore, role])

  const refresh = useCallback(() => refreshBootstrap(), [refreshBootstrap])

  useEffect(() => {
    clearClientWorkspace()
    void refresh()
    return () => { cancelRead(); clearClientWorkspace() }
  }, [cancelRead, refresh])

  useEffect(() => {
    const refreshForeground = () => {
      if (document.visibilityState !== 'visible' || accessErrorRef.current || Date.now() - lastAttemptRef.current < FOREGROUND_REFRESH_MS) return
      void refreshBootstrap(false, true)
    }
    window.addEventListener('focus', refreshForeground)
    window.addEventListener('online', refreshForeground)
    document.addEventListener('visibilitychange', refreshForeground)
    const timer = window.setInterval(refreshForeground, FOREGROUND_REFRESH_MS)
    return () => {
      window.removeEventListener('focus', refreshForeground)
      window.removeEventListener('online', refreshForeground)
      document.removeEventListener('visibilitychange', refreshForeground)
      window.clearInterval(timer)
    }
  }, [refreshBootstrap])

  const setHomeStore = useCallback((store: StoreName) => {
    if (store === homeStore || !confirmUnsavedWork()) return
    previewSelectedRef.current = true
    cancelRead()
    clearClientWorkspace()
    accessErrorRef.current = null
    latestAccessContextRef.current = `${role}:${store}`
    writeStorage('maxey-home-store', store)
    setHomeStoreState(store)
    setBootstrapState(emptyBootstrap(`${role}:${store}`))
  }, [cancelRead, homeStore, role])

  const setRole = useCallback((nextRole: UserRole) => {
    if (nextRole === role || !confirmUnsavedWork()) return
    previewSelectedRef.current = true
    cancelRead()
    clearClientWorkspace()
    accessErrorRef.current = null
    latestAccessContextRef.current = `${nextRole}:${homeStore}`
    writeStorage('maxey-role', nextRole)
    setRoleState(nextRole)
    setBootstrapState(emptyBootstrap(`${nextRole}:${homeStore}`))
  }, [cancelRead, homeStore, role])

  const completeMutation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    const context = accessContext
    const generation = apiAccessGeneration()
    try {
      const result = await operation()
      if (latestAccessContextRef.current === context && generation === apiAccessGeneration()) await refreshBootstrap(true)
      return result
    } catch (caught) {
      const status = accessFailureStatus(caught)
      if (status && generation === apiAccessGeneration()) clearAccess(context, status, caught instanceof Error ? caught.message : 'Your access could not be verified. Reload this page.')
      throw caught
    }
  }, [accessContext, clearAccess, refreshBootstrap])

  const submitTransfer = useCallback(
    (input: TransferRequestInput) => completeMutation(() => createTransfer(input, role, homeStore)),
    [completeMutation, homeStore, role],
  )

  const addTransferEvent = useCallback(
    (transferId: string, input: TransferEventInput) => completeMutation(() => appendTransferEvent(transferId, input, role, homeStore)),
    [completeMutation, homeStore, role],
  )

  const addAttentionEvent = useCallback(
    (attentionId: string, input: AttentionEventInput) => completeMutation(() => appendAttentionEvent(attentionId, input, role, homeStore)),
    [completeMutation, homeStore, role],
  )

  const value = useMemo<AppDataContextValue>(
    () => ({
      data,
      loading,
      error,
      accessErrorStatus,
      lastCheckedAt,
      savedChangesPending,
      homeStore,
      setHomeStore,
      role,
      setRole,
      currentUser: data?.access?.user ?? 'Local prototype user',
      currentUserId: data?.access?.userId ?? null,
      refresh,
      submitTransfer,
      addTransferEvent,
      addAttentionEvent,
    }),
    [data, loading, error, accessErrorStatus, lastCheckedAt, savedChangesPending, homeStore, setHomeStore, role, setRole, refresh, submitTransfer, addTransferEvent, addAttentionEvent],
  )

  // Remount every employee workspace, including open dialogs and local drafts,
  // when membership changes even if the displayed name, role and store match.
  const workspaceIdentity = JSON.stringify([data?.access?.userId ?? null, data?.access?.user ?? null, role, homeStore])
  return <AppDataContext.Provider value={value}><EmployeeWorkspace key={workspaceIdentity}>{children}</EmployeeWorkspace></AppDataContext.Provider>
}

function EmployeeWorkspace({ children }: { children: ReactNode }) { return children }

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext)
  if (!value) throw new Error('useAppData must be used inside AppDataProvider')
  return value
}
