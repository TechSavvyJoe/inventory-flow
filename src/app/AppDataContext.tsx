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
import { appendTransferEvent, createTransfer, getBootstrap } from '../lib/api'
import {
  STORE_NAMES,
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
  refresh: () => Promise<void>
  submitTransfer: (input: TransferRequestInput) => Promise<TransferRecord>
  addTransferEvent: (transferId: string, input: TransferEventInput) => Promise<TransferRecord>
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

interface BootstrapState {
  accessContext: string
  data: BootstrapData | null
  loading: boolean
  error: string | null
}

function readHomeStore(): StoreName {
  const stored = window.localStorage.getItem('maxey-home-store')
  return STORE_NAMES.includes(stored as StoreName) ? (stored as StoreName) : 'Howell'
}

function readRole(): UserRole {
  const stored = window.localStorage.getItem('maxey-role')
  return stored === 'sales' || stored === 'coordinator' || stored === 'porter' || stored === 'driver' || stored === 'group_manager' || stored === 'manager'
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
    window.localStorage.setItem('maxey-home-store', store)
    setHomeStoreState(store)
  }, [])

  const setRole = useCallback((nextRole: UserRole) => {
    window.localStorage.setItem('maxey-role', nextRole)
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

  const value = useMemo<AppDataContextValue>(
    () => ({
      data,
      loading,
      error,
      homeStore,
      setHomeStore,
      role,
      setRole,
      refresh,
      submitTransfer,
      addTransferEvent,
    }),
    [data, loading, error, homeStore, setHomeStore, role, setRole, refresh, submitTransfer, addTransferEvent],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext)
  if (!value) throw new Error('useAppData must be used inside AppDataProvider')
  return value
}
