import { Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppDataProvider, useAppData } from './app/AppDataContext'
import { AppShell } from './app/AppShell'
import { AttentionPage, InventoryPage, ManagerPage, preloadRoute, TransfersPage } from './app/routeModules'
import { ErrorState } from './components/ErrorState'
import { LoadingState } from './components/LoadingState'
import { RouteLoadBoundary } from './components/RouteLoadBoundary'
import { RouteLoadingState } from './components/RouteLoadingState'
import './styles/pages.css'

function AppRoutes() {
  const { data, loading, error, refresh, role } = useAppData()
  if (loading && !data) return <LoadingState />
  if (error && !data) return <ErrorState message={error} retry={() => void refresh()} />

  return (
    <RouteLoadBoundary>
      <Suspense fallback={<RouteLoadingState />}>
        <Routes>
          <Route path="/" element={<InventoryPage homeMode />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/transfers/new" element={<TransfersPage />} />
          <Route path="/attention" element={<AttentionPage />} />
          <Route path="/manager" element={role === 'manager' || role === 'group_manager' ? <ManagerPage /> : <Navigate to="/attention" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </RouteLoadBoundary>
  )
}

export default function App() {
  const { pathname } = useLocation()

  useEffect(() => {
    preloadRoute(pathname)
  }, [pathname])

  return (
    <AppDataProvider>
      {/* AppRoutes already has its own RouteLoadBoundary; this outer one is
          the one thing standing between a render error in AppShell itself —
          the nav rail, store switcher, or an open dialog — and a fully blank
          screen, since nothing wraps AppShell from outside this component. */}
      <RouteLoadBoundary>
        <AppShell><AppRoutes /></AppShell>
      </RouteLoadBoundary>
    </AppDataProvider>
  )
}
