import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { toTransferDetail } from '../../app/transferAdapters'
import { useWorkspaceScroll } from '../../lib/workspace-memory'
import { currentWorkspaceReturnPath, withWorkspaceReturnPath } from '../inventory/inventory-navigation'
import { SourceWarning } from '../../components/SourceWarning'
import type { TransferRecord } from '../../types'
import { TransferActionDialog, type TransferActionKind, type TransferDetail } from '../transfers'
import { GroupOperations } from './GroupOperations'
import type { GroupOperationRecord, SavedManagerView } from './types'

const SAVED_VIEWS: SavedManagerView[] = [
  { id: 'overdue-returns', name: 'Overdue returns', filters: { dueWindow: 'overdue' }, sortRules: [{ field: 'sla', direction: 'asc' }] },
  { id: 'location-exceptions', name: 'Location exceptions', filters: { exceptionOnly: true }, sortRules: [{ field: 'lastConfirmedAt', direction: 'asc' }] },
]

export function ManagerPage() {
  const { data, homeStore, role, currentUser } = useAppData()
  const navigate = useNavigate()
  const location = useLocation()
  const accessContext = `${currentUser}:${role}:${homeStore}`
  useWorkspaceScroll(accessContext, 'manager')
  const [pendingAction, setPendingAction] = useState<{ action: TransferActionKind; detail: TransferDetail; record: TransferRecord } | null>(null)

  const records = useMemo<GroupOperationRecord[]>(() => {
    if (!data) return []
    const vehicles = new Map(data.vehicles.map((vehicle) => [vehicle.vin, vehicle]))
    return data.transfers.map((transfer) => ({
      ...toTransferDetail(transfer, vehicles.get(transfer.vin), data.meta, role),
      salespersonLabel: vehicles.get(transfer.vin)?.hold.primarySalesperson,
    }))
  }, [data, role])

  if (!data) return null
  const sourceIsCurrent = data.meta.publicFreshness === 'current' && data.meta.dealerMailFreshness === 'current'

  function handleAction(action: TransferActionKind, detail: TransferDetail) {
    const record = data?.transfers.find((item) => item.id === detail.id)
    if (!record) return
    if (action === 'open-source') {
      const listingUrl = data?.vehicles.find((vehicle) => vehicle.vin === record.vin)?.listingUrl
      if (listingUrl) window.open(listingUrl, '_blank', 'noopener,noreferrer')
      return
    }
    setPendingAction({ action, detail, record })
  }

  return (
    <section className="manager-page">
      <SourceWarning meta={data.meta} />
      <GroupOperations
        records={records}
        storeOptions={data.stores.map((store) => ({ value: store.store, label: store.store }))}
        homeStore={homeStore}
        currentUserId={currentUser}
        persistenceContext={accessContext}
        savedViews={SAVED_VIEWS}
        sourceWarning={sourceIsCurrent ? undefined : data.meta.warnings[0] || 'One or more source snapshots are not current.'}
        onAction={handleAction}
        onCreateRequest={() => navigate(withWorkspaceReturnPath('/transfers/new', currentWorkspaceReturnPath(location)))}
        onSelectTransfer={(transfer) => {
          if (transfer) navigate(withWorkspaceReturnPath(`/transfers?id=${encodeURIComponent(transfer.id)}`, currentWorkspaceReturnPath(location)))
        }}
      />
      {pendingAction ? <TransferActionDialog {...pendingAction} onClose={() => setPendingAction(null)} /> : null}
    </section>
  )
}
