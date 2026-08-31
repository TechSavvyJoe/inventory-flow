import { Navigate, Route, Routes } from 'react-router-dom'
import { AppDataProvider, useAppData } from './app/AppDataContext'
import { AppShell } from './app/AppShell'
import { ErrorState } from './components/ErrorState'
import { LoadingState } from './components/LoadingState'
import { AttentionPage } from './features/attention/AttentionPage'
import { InventoryPage } from './features/inventory/InventoryPage'
import { ManagerPage } from './features/manager/ManagerPage'
import { TransfersPage } from './features/transfers/TransfersPage'
import './styles/pages.css'

function AppRoutes() {
  const { data, loading, error, refresh, role } = useAppData()
  if (loading && !data) return <LoadingState />
  if (error && !data) return <ErrorState message={error} retry={() => void refresh()} />

  return (
    <Routes>
      <Route path="/" element={<InventoryPage homeMode />} />
      <Route path="/inventory" element={<InventoryPage />} />
      <Route path="/transfers" element={<TransfersPage />} />
      <Route path="/transfers/new" element={<TransfersPage />} />
      <Route path="/attention" element={<AttentionPage />} />
      <Route path="/manager" element={role === 'manager' || role === 'group_manager' ? <ManagerPage /> : <Navigate to="/attention" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AppDataProvider>
      <AppShell><AppRoutes /></AppShell>
    </AppDataProvider>
  )
}
