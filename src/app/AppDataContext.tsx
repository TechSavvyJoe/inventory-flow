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
  homeStore: StoreName
  setHomeStore: (store: StoreName) => void
  role: UserRole
  setRole: (role: UserRole) => void
  currentUser: string
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
  const accessContext = `${role}:${homeStore}`
  const latestAccessContextRef = useRef(accessContext)
  const requestSequenceRef = useRef(0)
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>(() => ({
    accessContext,
    data: null,
    loading: true,
    error: null,
  }))
  latestAccessContextRef.current = accessContext
  const stateMatchesAccessContext = bootstrapState.accessContext === accessContext
  const data = stateMatchesAccessContext ? bootstrapState.data : null
  const loading = stateMatchesAccessContext ? bootstrapState.loading : true
  const error = stateMatchesAccessContext ? bootstrapState.error : null

  const refresh = useCallback(async () => {
    const requestId = ++requestSequenceRef.current
    setBootstrapState((current) => ({
      accessContext,
      data: current.accessContext === accessContext ? current.data : null,
      loading: true,
      error: null,
    }))
    try {
      const nextData = await getBootstrap(homeStore, role)
      if (requestId !== requestSequenceRef.current || latestAccessContextRef.current !== accessContext) return
      const authenticatedRole = nextData.access?.role ?? role
      const authenticatedStore = nextData.access?.store ?? homeStore
      if (authenticatedRole !== role || authenticatedStore !== homeStore) {
        const authenticatedContext = `${authenticatedRole}:${authenticatedStore}`
        writeStorage('maxey-role', authenticatedRole)
        writeStorage('maxey-home-store', authenticatedStore)
        latestAccessContextRef.current = authenticatedContext
        setRoleState(authenticatedRole)
        setHomeStoreState(authenticatedStore)
        setBootstrapState({ accessContext: authenticatedContext, data: nextData, loading: false, error: null })
        return
      }
      setBootstrapState({ accessContext, data: nextData, loading: false, error: null })
    } catch (caught) {
      if (requestId !== requestSequenceRef.current || latestAccessContextRef.current !== accessContext) return
      setBootstrapState({
        accessContext,
        data: null,
        loading: false,
        error: caught instanceof Error ? caught.message : 'Unable to load the current inventory data.',
      })
    }
  }, [accessContext, homeStore, role])

  useEffect(() => {
    void refresh()
    return () => {
      requestSequenceRef.current += 1
    }
  }, [refresh])

  const setHomeStore = useCallback((store: StoreName) => {
    writeStorage('maxey-home-store', store)
    setHomeStoreState(store)
  }, [])

  const setRole = useCallback((nextRole: UserRole) => {
    writeStorage('maxey-role', nextRole)
    setRoleState(nextRole)
  }, [])

  const submitTransfer = useCallback(
    async (input: TransferRequestInput) => {
      const created = await createTransfer(input, role, homeStore)
      await refresh()
      return created
    },
    [homeStore, refresh, role],
  )

  const addTransferEvent = useCallback(
    async (transferId: string, input: TransferEventInput) => {
      const updated = await appendTransferEvent(transferId, input, role, homeStore)
      await refresh()
      return updated
    },
    [homeStore, refresh, role],
  )

  const addAttentionEvent = useCallback(
    async (attentionId: string, input: AttentionEventInput) => {
      const updated = await appendAttentionEvent(attentionId, input, role, homeStore)
      await refresh()
      return updated
    },
    [homeStore, refresh, role],
  )

  const value = useMemo<AppDataContextValue>(
    () => ({
      data,
      loading,
      error,
      homeStore,
      setHomeStore,
      role,
      setRole,
      currentUser: data?.access?.user ?? 'Local prototype user',
      refresh,
      submitTransfer,
      addTransferEvent,
      addAttentionEvent,
    }),
    [data, loading, error, homeStore, setHomeStore, role, setRole, refresh, submitTransfer, addTransferEvent, addAttentionEvent],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext)
  if (!value) throw new Error('useAppData must be used inside AppDataProvider')
  return value
}
