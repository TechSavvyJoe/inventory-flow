import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  CarFront,
  ChevronRight,
  CircleAlert,
  ChevronDown,
  ListFilter,
  MapPin,
  Plus,
  Search,
} from 'lucide-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { toTransferDetail, toTransferVehicle } from '../../app/transferAdapters'
import { SourceWarning } from '../../components/SourceWarning'
import { getTransfer } from '../../lib/api'
import { vehiclePhotoDisplaySources } from '../../lib/vehicle-photos'
import type { BootstrapData, StoreName, TransferRecord, UserRole } from '../../types'
import { formatDateTime, humanizeStatusLabel } from './presentation'
import { TransferActionDialog } from './TransferActionDialog'
import { TransferEmptyState } from './TransferEmptyState'
import { TransferRequestWorkspace } from './TransferRequestWorkspace'
import { TransferTracker } from './TransferTracker'
import type { SelectOption, TransferActionKind, TransferDetail, TransferRequestDraft } from './types'
import { awayFromHomeSummary } from './moveSummary'
import { selectRequestedTransfer } from './transfer-selection'
import { VehicleLocationOverview } from './VehicleLocationOverview'
import { simpleTransferActions } from './SimpleTransferTracker'
import { currentWorkspaceReturnPath, readWorkspaceReturnPath, vehicleWorkspacePath } from '../inventory/inventory-navigation'
import './transfers-page.css'
import './transfer-workspace-v3.css'
import './transfer-workspace-v4.css'
import './vehicle-moves.css'

const REASON_LABELS: Record<TransferRequestDraft['reasonCode'], string> = {
  'customer-need': 'Customer need',
  'manager-request': 'Manager / store need',
  other: 'Other reason',
}

type TransferQueueView = 'needs-action' | 'active' | 'history'
type TransferQueueFilter =
  | 'all'
  | 'my-location'
  | 'my-home-inventory'
  | 'requested-by-my-store'
  | 'away-from-home'
  | 'awaiting-approval'
  | 'ready-to-collect'
  | 'at-requesting-store'
  | 'driver-needed'
  | 'moving'
  | 'return-due'
  | 'sold-pending'
  | 'issues'
type TransferQueueSort = 'urgency' | 'needed-by' | 'recent' | 'stock' | 'route'

const TERMINAL_TRANSFER_STATES = new Set(['closed', 'declined', 'canceled', 'expired'])
const PASSIVE_TRANSFER_ACTIONS = new Set<TransferActionKind>(['open-source', 'report-condition', 'mark-exception', 'escalate'])

function TransferListPhoto({ vehicle }: { vehicle: TransferDetail['vehicle'] }) {
  const candidates = useMemo(() => vehiclePhotoDisplaySources(vehicle, { width: 240 }), [vehicle.imageUrl, vehicle.imageUrls])
  const [index, setIndex] = useState(0)
  const sourceKey = candidates.join('\u0000')
  useEffect(() => { setIndex(0) }, [sourceKey])
  const src = candidates[index]
  return src ? (
    <img
      className="transfer-list-photo"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setIndex((value) => value + 1)}
    />
  ) : (
    <span className="transfer-list-photo transfer-list-photo--placeholder" aria-hidden="true"><CarFront /></span>
  )
}

function normalizedStatus(value?: string): string {
  return (value ?? '').toLowerCase().trim().replace(/[_\s/]+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function isTerminalTransfer(record: TransferRecord): boolean {
  return TERMINAL_TRANSFER_STATES.has(normalizedStatus(record.requestStatus)) || (record.workflowMode === 'simple' && normalizedStatus(record.requestStatus) === 'returned-home')
}

function creationIntentFor(vehicle: BootstrapData['vehicles'][number], role: UserRole, homeStore: StoreName): 'request' | 'direct' | null {
  if (role === 'group_manager') return 'direct'
  if (role === 'manager') return vehicle.homeStore === homeStore ? 'direct' : 'request'
  if (role === 'sales' && vehicle.homeStore !== homeStore) return 'request'
  return null
}

function localDateTimeToIso(value?: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

function needsTransferAction(detail: TransferDetail): boolean {
  const actions = detail.workflowMode === 'simple' ? simpleTransferActions(detail) : detail.allowedActions
  return actions.some((action) => !PASSIVE_TRANSFER_ACTIONS.has(action))
}

function transferIssueLabel(detail: TransferDetail): string | null {
  if (detail.exception) return detail.exception.label
  if (detail.timeline.some((event) => event.exception)) return 'Vehicle issue reported'
  if (detail.nextAction.sla === 'breached' || detail.nextAction.sla === 'overdue') return 'Action overdue'
  return null
}

function dueLabel(detail: TransferDetail): string {
  if (!detail.nextAction.dueAt) return 'No due time'
  const prefix = detail.nextAction.sla === 'breached' || detail.nextAction.sla === 'overdue' ? 'Overdue' : 'Due'
  return `${prefix} ${formatDateTime(detail.nextAction.dueAt)}`
}

function workflowStage(status: string): number {
  const normalized = normalizedStatus(status)
  if (['requested', 'submitted'].includes(normalized)) return 1
  if (['manager-reviewed', 'needs-information'].includes(normalized)) return 2
  if (['approved', 'driver-requested', 'return-requested'].includes(normalized)) return 3
  if (['transport-assigned', 'return-assigned', 'pickup-scheduled'].includes(normalized)) return 4
  if (['picked-up', 'in-transit', 'arrived', 'customer-showing', 'return-in-transit', 'returned-awaiting-receipt'].includes(normalized)) return 5
  return 6
}

function workflowStep(status: string): number {
  const normalized = normalizedStatus(status)
  if (normalized === 'draft') return 1
  if (['requested', 'submitted'].includes(normalized)) return 2
  if (['manager-reviewed', 'needs-information', 'declined'].includes(normalized)) return 3
  if (['approved', 'driver-requested', 'transport-assigned', 'pickup-scheduled', 'picked-up', 'in-transit'].includes(normalized)) return 4
  return 5
}

function isAwaitingApproval(record: TransferRecord): boolean {
  return ['requested', 'submitted', 'manager-reviewed', 'needs-information'].includes(normalizedStatus(record.requestStatus))
}

function isMoving(record: TransferRecord): boolean {
  const request = normalizedStatus(record.requestStatus)
  const movement = normalizedStatus(record.movementStatus)
  return ['transport-assigned', 'picked-up', 'in-transit', 'return-assigned', 'return-in-transit'].includes(request) ||
    ['pickup-scheduled', 'released-to-custodian', 'in-transit-outbound', 'in-transit-return'].some((value) => movement.includes(value))
}

function isDeliveryConfirmed(record: TransferRecord): boolean {
  return ['confirmed', 'delivery-confirmed'].includes(normalizedStatus(record.deliveryStatus))
}

function needsReturnAttention(record: TransferRecord): boolean {
  if (!record.returnRequired || isTerminalTransfer(record)) return false
  // A sold vehicle is waiting on its delivery, not on a trip home.
  if (isSoldPendingNotDelivered(record) || isDeliveryConfirmed(record)) return false
  const request = normalizedStatus(record.requestStatus)
  const movement = normalizedStatus(record.movementStatus)
  const deal = normalizedStatus(record.dealStatus)
  return Boolean(record.returnDueAt) || request.includes('return') || movement.includes('return') || deal.includes('not-sold')
}

function isSoldPendingNotDelivered(record: TransferRecord): boolean {
  return normalizedStatus(record.dealStatus).includes('sold-pending') && !isDeliveryConfirmed(record)
}

function transferPriorityScore(record: TransferRecord): number {
  return { urgent: 4, high: 3, normal: 2, low: 1 }[record.priority] ?? 0
}

function dateScore(value?: string, fallback = Number.POSITIVE_INFINITY): number {
  if (!value) return fallback
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? fallback : parsed
}

function returnTimingLabel(record: TransferRecord): string {
  if (!record.returnRequired) return 'Return not required'
  if (isDeliveryConfirmed(record)) return 'Delivered · no return'
  if (isSoldPendingNotDelivered(record)) return 'Sold pending · return paused'
  if (record.returnDueAt) return `Return due ${formatDateTime(record.returnDueAt)}`
  return 'Return required · date not set'
}

function compactNextAction(value?: string): string {
  const action = value?.trim() || 'No next action recorded'
  if (/requesting manager confirms availability and release/i.test(action)) return 'Requesting manager: approve, then contact Home Store'
  if (/contact .*used-car manager.*release decision/i.test(action)) return 'Contact Home Store and record its decision'
  if (/home-store.*availability.*release/i.test(action)) return 'Record the Home Store’s release decision'
  if (/confirm.*returned home|confirm home receipt/i.test(action)) return 'Confirm home receipt'
  if (/record call for a driver|request.*driver/i.test(action)) return 'Request a driver'
  return action
}

function compactRequestStatus(value: string, simple = false): string {
  const status = normalizedStatus(value)
  if (simple) {
    if (status === 'closed') return 'Complete'
    if (['requested', 'submitted', 'manager-reviewed', 'needs-information'].includes(status)) return 'Manager checking availability'
    if (status === 'approved') return 'Approved — work vehicle or return'
    if (['transport-assigned', 'pickup-scheduled'].includes(status)) return 'Ready to collect'
    if (['picked-up', 'in-transit'].includes(status)) return 'In transit'
    if (['arrived', 'customer-showing', 'sale-outcome-pending'].includes(status)) return 'At requesting store'
    if (status === 'sale-confirmed') return 'Sold pending · awaiting delivery'
    if (status === 'delivery-confirmed') return 'Delivered'
    if (status === 'returned-home') return 'Back home'
    if (status.includes('return')) return 'Returning home'
    return humanizeStatusLabel(value)
  }
  if (status === 'draft') return 'Request not submitted'
  if (['requested', 'submitted'].includes(status)) return 'Requesting manager approval'
  if (['manager-reviewed', 'needs-information'].includes(status)) return 'Contact Home Store · record decision'
  if (status === 'approved') return 'Released · driver can be assigned'
  if (status === 'driver-requested') return 'Driver requested'
  if (/transport-assigned|pickup-scheduled/.test(status)) return 'Driver assigned'
  if (/picked-up|in-transit/.test(status)) return 'In transit'
  if (/arrived|customer-showing/.test(status)) return 'At requesting store'
  if (status === 'sale-confirmed') return 'Sold pending · awaiting delivery'
  if (status === 'delivery-confirmed') return 'Delivered'
  if (/return/.test(status)) return 'Return in progress'
  return humanizeStatusLabel(value)
}

function TransferDetailLoader({
  selected,
  data,
  role,
  homeStore,
  onAction,
  returnTo,
}: {
  selected: { record: TransferRecord; detail: TransferDetail } | null;
  data: BootstrapData;
  role: UserRole;
  homeStore: StoreName;
  onAction: (action: TransferActionKind, detail: TransferDetail) => void;
  returnTo: string;
}) {
  // A same-ID bootstrap refresh can change both actions and private-data access.
  // Use the record's value as the refresh key, rather than its object identity:
  // React development replay and an unchanged bootstrap response both create a
  // new object. Treating either as a new selection aborts a healthy request,
  // which WebKit reports as an "access control" console error even though the
  // request is same-origin. A meaningful record change still invalidates the
  // detail immediately, so private data and authorized actions never linger.
  const selectedRecord = selected?.record
  const selectedRecordRefreshKey = selectedRecord ? JSON.stringify(selectedRecord) : ''
  const requestContext = useMemo(
    () => ({ id: selectedRecord?.id, refreshKey: selectedRecordRefreshKey, role, homeStore }),
    [selectedRecord?.id, selectedRecordRefreshKey, role, homeStore],
  )
  const [recordDetail, setRecordDetail] = useState<{ context: typeof requestContext; record: TransferRecord } | null>(null)
  useEffect(() => {
    let active = true
    const id = requestContext.id
    if (!id) {
      setRecordDetail(null)
      return () => { active = false }
    }
    // The active flag guards private data and actions from an earlier context.
    // Do not abort a small same-origin read on every status refresh: WebKit
    // reports those expected cancellations as access-control console errors.
    // A stale response is safely ignored, while the latest context still gets
    // its own authoritative detail request.
    getTransfer(id, requestContext.role, requestContext.homeStore)
      .then((record) => { if (active && record?.id === id) setRecordDetail({ context: requestContext, record }) })
      .catch(() => { if (active) setRecordDetail(null) })
    return () => {
      active = false
    }
  }, [requestContext])
  const detail = recordDetail?.context === requestContext
    ? toTransferDetail(recordDetail.record, data.vehicles.find((vehicle) => vehicle.vin === recordDetail.record.vin), data.meta, role)
    : selected?.detail ?? null
  const vehicle = data.vehicles.find(vehicle => vehicle.vin === selectedRecord?.vin)
  return <TransferTracker transfer={detail} mode="page" onAction={onAction} vehicleLinks={vehicle ? <nav className="move-vehicle-links" aria-label="Vehicle reference">
    <Link to={vehicleWorkspacePath(vehicle.vin, { returnTo })}>Vehicle details</Link>
    <Link to={vehicleWorkspacePath(vehicle.vin, { tab: 'data', returnTo })}>Records</Link>
  </nav> : null} />
}

export function TransfersPage() {
  const { data, homeStore, role, currentUser, submitTransfer } = useAppData()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [pendingAction, setPendingAction] = useState<{ action: TransferActionKind; detail: TransferDetail; record: TransferRecord } | null>(null)
  const [query, setQuery] = useState('')
  const [requestQuery, setRequestQuery] = useState('')
  const [queueView, setQueueView] = useState<TransferQueueView>('active')
  const [queueFilter, setQueueFilter] = useState<TransferQueueFilter>('all')
  const [storeScope, setStoreScope] = useState<'home' | 'group'>('home')
  const [queueSort, setQueueSort] = useState<TransferQueueSort>('urgency')
  const requestMode = location.pathname.endsWith('/new')

  const details = useMemo(() => {
    if (!data) return []
    const vehicles = new Map(data.vehicles.map((vehicle) => [vehicle.vin, vehicle]))
    return data.transfers.map((record) => ({
      record,
      detail: toTransferDetail(record, vehicles.get(record.vin), data.meta, role),
    }))
  }, [data, role])

  if (!data) return null
  const simple = !details.length || details.some(({ record }) => record.workflowMode === 'simple')

  const requestedId = params.get('id')
  const requestedVin = params.get('vin')?.toUpperCase()
  const normalizedQuery = query.trim().toLowerCase()
  const scopedDetails = details.filter(({ record }) => storeScope === 'group' ||
    [record.homeStore, record.requestingStore, record.currentLocation, record.destination].includes(homeStore))
  const filteredDetails = scopedDetails
    .filter(({ record, detail }) => {
      const terminal = isTerminalTransfer(record)
      const needsAction = needsTransferAction(detail)
      if (queueView === 'history' ? !terminal : queueView === 'active' ? terminal : !needsAction || terminal) return false
      if (
        queueFilter === 'my-location' &&
        ![record.homeStore, record.requestingStore, record.currentLocation, record.destination].includes(homeStore)
      ) return false
      if (queueFilter === 'my-home-inventory' && record.homeStore !== homeStore) return false
      if (queueFilter === 'requested-by-my-store' && record.requestingStore !== homeStore) return false
      if (queueFilter === 'away-from-home' && !awayFromHomeSummary(record.homeStore, record.currentLocation, record.events, { destination: record.destination }).isAway) return false
      if (queueFilter === 'awaiting-approval' && !isAwaitingApproval(record)) return false
      if (queueFilter === 'ready-to-collect' && !['approved', 'transport-assigned', 'pickup-scheduled'].includes(normalizedStatus(record.requestStatus))) return false
      if (queueFilter === 'at-requesting-store' && !['arrived', 'customer-showing', 'sale-outcome-pending', 'sale-confirmed', 'not-sold'].includes(normalizedStatus(record.requestStatus))) return false
      if (
        queueFilter === 'driver-needed' &&
        (terminal || Boolean(record.transportAssignee) || workflowStage(record.requestStatus) < 3 || workflowStage(record.requestStatus) > 4)
      ) return false
      if (queueFilter === 'moving' && !isMoving(record)) return false
      if (queueFilter === 'return-due' && !needsReturnAttention(record)) return false
      if (queueFilter === 'sold-pending' && !isSoldPendingNotDelivered(record)) return false
      if (queueFilter === 'issues' && !transferIssueLabel(detail)) return false
      if (!normalizedQuery) return true
      return [
        record.stockNumber,
        record.vin,
        record.vehicleName,
        record.homeStore,
        record.requestingStore,
        record.currentLocation,
        record.destination,
        record.requestedBy,
        record.approvedBy,
        record.custodian,
        record.transportAssignee,
        record.nextAction,
        record.nextActionOwner,
        record.dealStatus,
        record.deliveryStatus,
        record.movementStatus,
        detail.requestReason,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery))
    })
    .sort((left, right) => {
      if (queueSort === 'needed-by') {
        return dateScore(left.detail.nextAction.dueAt) - dateScore(right.detail.nextAction.dueAt)
      }
      if (queueSort === 'recent') {
        return dateScore(right.record.requestedAt, 0) - dateScore(left.record.requestedAt, 0)
      }
      if (queueSort === 'stock') return left.record.stockNumber.localeCompare(right.record.stockNumber, 'en-US', { numeric: true })
      if (queueSort === 'route') {
        return `${left.record.homeStore}|${left.record.destination}`.localeCompare(`${right.record.homeStore}|${right.record.destination}`, 'en-US')
      }
      const leftIssue = transferIssueLabel(left.detail) ? 1 : 0
      const rightIssue = transferIssueLabel(right.detail) ? 1 : 0
      if (leftIssue !== rightIssue) return rightIssue - leftIssue
      const slaRank = { breached: 4, overdue: 3, 'due-soon': 2, 'on-track': 1, none: 0 }
      const slaDifference = slaRank[right.detail.nextAction.sla] - slaRank[left.detail.nextAction.sla]
      if (slaDifference) return slaDifference
      const priorityDifference = transferPriorityScore(right.record) - transferPriorityScore(left.record)
      if (priorityDifference) return priorityDifference
      return dateScore(left.detail.nextAction.dueAt) - dateScore(right.detail.nextAction.dueAt)
    })
  // An authorized deep link opens the exact move, including completed moves or
  // a different store. Filtering the queue must never substitute another move.
  const selected = selectRequestedTransfer(requestedId || requestedVin ? details : filteredDetails, requestedId, requestedVin)
  const queueCounts = {
    'needs-action': scopedDetails.filter(({ record, detail }) => !isTerminalTransfer(record) && needsTransferAction(detail)).length,
    active: scopedDetails.filter(({ record }) => !isTerminalTransfer(record)).length,
    history: scopedDetails.filter(({ record }) => isTerminalTransfer(record)).length,
  }
  const requestVehicle = requestedVin ? data.vehicles.find((vehicle) => vehicle.vin === requestedVin) : undefined

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

  if (requestMode) {
    const safeReturnTo = readWorkspaceReturnPath(params.get('returnTo')) ?? '/transfers'

    if (!requestedVin) {
      const normalizedVehicleQuery = requestQuery.trim().toLowerCase()
      const activeByVin = new Map(data.transfers.filter(record => !isTerminalTransfer(record)).map(record => [record.vin, record]))
      const candidates = data.vehicles
        .filter(vehicle => creationIntentFor(vehicle, role, homeStore))
        .filter(vehicle => !normalizedVehicleQuery || [vehicle.stockNumber, vehicle.vin, vehicle.vehicleName, vehicle.homeStore]
          .some(value => value?.toLowerCase().includes(normalizedVehicleQuery)))
        .slice(0, 30)
      return <section className="transfer-request-page move-vehicle-picker-page">
        <SourceWarning meta={data.meta} />
        <header className="move-picker-heading">
          <div><span>Vehicle moves</span><h1>Start a move</h1><p>Search by stock, VIN, or vehicle. The next step matches your role and the vehicle’s home store.</p></div>
          <button type="button" className="mif-icon-button" aria-label="Close vehicle picker" onClick={() => navigate('/transfers')}><ArrowLeft aria-hidden="true" /></button>
        </header>
        <label className="move-picker-search">
          <Search aria-hidden="true" />
          <input autoFocus value={requestQuery} onChange={event => setRequestQuery(event.target.value)} placeholder="Search stock, VIN, or vehicle" aria-label="Search inventory to move" />
        </label>
        <div className="move-picker-results" aria-live="polite">
          {candidates.map(vehicle => {
            const active = activeByVin.get(vehicle.vin)
            const intent = creationIntentFor(vehicle, role, homeStore)!
            const summary = toTransferVehicle(vehicle, data.meta)
            const blocked = vehicle.movement?.newRequestBlocked === true && !active
            return <article className="move-picker-row" key={vehicle.vin}>
              <TransferListPhoto vehicle={summary} />
              <div><strong>{vehicle.vehicleName}</strong><span>Stock {vehicle.stockNumber} · {vehicle.homeStore}</span><small>{vehicle.vin}</small></div>
              {active ? <div className="move-picker-actions">
                <button type="button" className="mif-button mif-button--secondary" onClick={() => navigate(`/transfers?id=${encodeURIComponent(active.id)}`)}>Track move</button>
                {vehicle.movement?.canDirectReroute === true ? <button type="button" className="mif-button mif-button--primary" onClick={() => navigate(`/transfers/new?vin=${encodeURIComponent(vehicle.vin)}&intent=direct`)}>Move again</button> : null}
              </div>
                : <button type="button" className="mif-button mif-button--primary" disabled={blocked} title={blocked ? 'Another move is already open for this vehicle.' : undefined} onClick={() => navigate(`/transfers/new?vin=${encodeURIComponent(vehicle.vin)}&intent=${intent}`)}>{blocked ? 'Move already open' : intent === 'direct' ? 'Move vehicle' : `Request to ${homeStore}`}</button>}
            </article>
          })}
          {!candidates.length ? <div className="move-picker-empty"><CarFront aria-hidden="true" /><strong>No matching vehicles</strong><p>Check the stock number or search across the vehicle name and VIN.</p></div> : null}
        </div>
      </section>
    }

    const permittedIntent = requestVehicle ? creationIntentFor(requestVehicle, role, homeStore) : null
    if (requestVehicle && !permittedIntent) {
      return <section className="transfer-request-page"><div className="move-request-home-message">
        <CarFront aria-hidden="true" size={32} />
        <h1>This move is not available for your role</h1>
        <p>Salespeople request vehicles from another store. A store manager can directly move their own inventory, and a group manager can move inventory between any stores.</p>
        <button type="button" className="mif-button mif-button--primary" onClick={() => navigate('/transfers/new')}>Choose another vehicle</button>
      </div></section>
    }
    const intent = permittedIntent ?? (params.get('intent') === 'direct' ? 'direct' : 'request')
    const vehicleSummary = requestVehicle ? toTransferVehicle(requestVehicle, data.meta) : null
    const movementLocation = requestVehicle?.movement?.currentLocation?.trim()
    const knownCurrentStore = movementLocation && data.stores.some(store => store.store === movementLocation)
      ? movementLocation
      : null
    // "In transit" and other non-store custody labels are not a store. Do not
    // guess home as the origin and accidentally remove it from the valid
    // destinations. With no movement location at all, however, the home store
    // remains the authoritative origin for an initial direct move.
    const directOrigin = knownCurrentStore ?? (!movementLocation ? requestVehicle?.homeStore : null)
    const stores: SelectOption[] = data.stores
      .filter((store) => intent !== 'direct' ? store.store !== requestVehicle?.homeStore : !directOrigin || store.store !== directOrigin)
      .map((store) => ({ value: store.store, label: store.store }))
    const defaultRequestingStore = homeStore
    const requestingManagerStore = defaultRequestingStore ?? homeStore
    const managerApprovers: SelectOption[] = requestVehicle
      ? [{ value: `${requestingManagerStore}-manager`, label: `${requestingManagerStore} manager`, secondaryLabel: `Checks with ${requestVehicle.homeStore}, then approves the request` }]
      : []

    return (
      <section className="transfer-request-page">
        <SourceWarning meta={data.meta} />
        <TransferRequestWorkspace
          workflowMode="simple"
          intent={intent}
          vehicle={vehicleSummary}
          stores={stores}
          requesters={[{ value: 'signed-in-user', label: currentUser || 'Signed-in salesperson', secondaryLabel: homeStore }]}
          managerApprovers={managerApprovers}
          defaultRequestingStore={defaultRequestingStore}
          defaultDestinationStore={intent === 'direct' && stores.some(store => store.value === params.get('destination')) ? params.get('destination') || undefined : undefined}
          defaultRequesterId="signed-in-user"
          defaultManagerApproverId={managerApprovers[0]?.value}
          onCancel={() => navigate(safeReturnTo)}
          onViewRequest={(id) => navigate(`/transfers?id=${encodeURIComponent(id)}`)}
          onSubmit={async (draft) => {
            const movedAt = intent === 'direct' ? localDateTimeToIso(draft.movedAt) : undefined
            const common = {
              vin: draft.vin,
              requestingStore: draft.requestingStore as typeof homeStore,
              requestedBy: currentUser || 'Signed-in salesperson',
              reason: `${REASON_LABELS[draft.reasonCode]}${draft.reasonDetail?.trim() ? `: ${draft.reasonDetail.trim()}` : ''}`,
              customerReference: draft.customerReference?.trim() || undefined,
              customerAppointment: false,
              returnRequired: draft.returnRequired,
              returnDueAt: localDateTimeToIso(draft.targetReturnAt),
              priority: draft.priority,
              approvalOwner: intent === 'direct' ? currentUser || `${homeStore} manager` : managerApprovers.find((option) => option.value === draft.managerApproverId)?.label,
            }
            const created = intent === 'direct'
              ? await submitTransfer({
                ...common,
                intent: 'direct',
                destinationStore: draft.destinationStore as typeof homeStore,
                movedAt,
              })
              : await submitTransfer({
                ...common,
                intent: 'request',
                destinationStore: draft.requestingStore as typeof homeStore,
                neededBy: localDateTimeToIso(draft.neededBy) || draft.neededBy,
              })
            return { requestId: created.id }
          }}
        />
      </section>
    )
  }

  return (
    <section
      className={`transfers-page vehicle-moves-page${simple ? ' is-simple' : ''}${(requestedId || requestedVin) && selected ? ' is-mobile-detail-open' : ''}`}
      data-mobile-detail-open={(requestedId || requestedVin) && selected ? 'true' : 'false'}
    >
      <SourceWarning meta={data.meta} />
      <header className="transfers-page-header">
        <div>
          <h1>Vehicle moves</h1>
          <p>See where each vehicle is, who is responsible, and what happens next.</p>
        </div>
        <button className="mif-button mif-button--primary transfer-header-create" type="button" aria-label="Start a vehicle move" onClick={() => navigate('/transfers/new')}>
          <Plus aria-hidden="true" />
          Start a move
        </button>
      </header>

      <div className="move-store-scope" role="group" aria-label="Vehicle move stores">
        <button type="button" aria-pressed={storeScope === 'home'} onClick={() => setStoreScope('home')}>My store <span>{homeStore}</span></button>
        <button type="button" aria-pressed={storeScope === 'group'} onClick={() => setStoreScope('group')}>All stores</button>
        <p>{storeScope === 'home' ? `Vehicles requested by, owned by, or currently at ${homeStore}.` : 'Moves you can access across the group.'}</p>
      </div>

      {details.length === 0 ? (
        <div className="transfers-empty-surface">
          <TransferEmptyState onAction={() => navigate('/transfers/new')} actionLabel="Start a move" />
          <div className="movement-operating-rule">
            <ArrowLeftRight aria-hidden="true" />
            <div><strong>{simple ? 'One manager review, then a simple return.' : 'Home Store owns the release. Requesting Store owns the custody.'}</strong><span>{simple ? 'Your manager checks with the vehicle’s home store and approves. Sales records the outcome or starts the return; the home store confirms it is back.' : 'Accountability continues until the Home Store confirms return or an authorized final disposition is recorded.'}</span></div>
          </div>
        </div>
      ) : (
        <div
          className="transfers-layout transfers-layout--master-detail"
          data-queue-size={filteredDetails.length}
        >
          <aside className="transfer-list" aria-label="Movement requests">
            <div className="transfer-list-toolbar">
              <label className="transfer-list-search">
                <Search aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={simple ? 'Search stock, vehicle, salesperson, or store' : 'Search stock, VIN, vehicle, store, or driver'} aria-label="Search vehicle moves" />
              </label>
              <div className="transfer-list-views" role="group" aria-label="Movement queue view">
                {([
                  ['active', 'Active'],
                  ['needs-action', 'Your next steps'],
                  ['history', 'Completed'],
                ] as Array<[TransferQueueView, string]>).map(([value, label]) => (
                  <button type="button" key={value} className={queueView === value ? 'is-active' : undefined} onClick={() => setQueueView(value)} aria-pressed={queueView === value}>
                    {label}<span>{queueCounts[value]}</span>
                  </button>
                ))}
              </div>
              <div className="transfer-list-tools">
              <label className="transfer-list-filter" title="Filter vehicle moves">
                <ListFilter aria-hidden="true" />
                <span className="sr-only">Filter vehicle moves</span>
                <select
                  aria-label="Filter vehicle moves"
                  value={queueFilter}
                  onChange={(event) => setQueueFilter(event.target.value as TransferQueueFilter)}
                >
                  <option value="all">All moves</option>
                  <option value="awaiting-approval">Waiting for approval</option>
                  {!simple ? <option value="ready-to-collect">Ready to collect</option> : null}
                  {!simple ? <option value="at-requesting-store">At requesting store</option> : null}
                  {!simple ? <option value="driver-needed">Driver needed</option> : null}
                  <option value="moving">In transit</option>
                  <option value="return-due">Return to follow up</option>
                  {!simple ? <option value="sold-pending">Sold pending · not delivered</option> : null}
                  <option value="issues">Issue to review</option>
                </select>
              </label>
              <label className="transfer-list-sort" title="Sort vehicle moves">
                <ArrowDownUp aria-hidden="true" />
                <span className="sr-only">Sort vehicle moves</span>
                <select
                  aria-label="Sort vehicle moves"
                  value={queueSort}
                  onChange={(event) => setQueueSort(event.target.value as TransferQueueSort)}
                >
                  <option value="urgency">Urgency</option>
                  <option value="needed-by">Next due</option>
                  <option value="recent">Newest request</option>
                  <option value="stock">Stock number</option>
                  <option value="route">Route</option>
                </select>
              </label>
                <div className="transfer-list-count" aria-live="polite">{filteredDetails.length} moves shown</div>
              </div>
            </div>
            <div className="transfer-list-items">
              {filteredDetails.map(({ record, detail }) => {
                const isSelected = selected?.record.id === record.id
                const step = workflowStep(record.requestStatus)
                const simpleRecord = record.workflowMode === 'simple'
                const away = awayFromHomeSummary(record.homeStore, record.currentLocation, record.events, { destination: record.destination })
                const issueLabel = transferIssueLabel(detail)
                const dueTone = detail.nextAction.sla === 'breached' || detail.nextAction.sla === 'overdue'
                  ? 'is-overdue'
                  : detail.nextAction.sla === 'due-soon'
                    ? 'is-due-soon'
                    : 'is-on-track'
                return (
                  <button
                    type="button"
                    key={record.id}
                    className={`transfer-list-item${isSelected ? ' is-selected' : ''}`}
                    onClick={() => navigate(`/transfers?id=${encodeURIComponent(record.id)}`)}
                    aria-current={isSelected ? 'true' : undefined}
                    aria-controls="transfer-detail-workspace"
                  >
                    <TransferListPhoto vehicle={detail.vehicle} />
                    <span className="transfer-list-copy transfer-list-copy--concise">
                      <span className="move-row-vehicle">
                        <span className="transfer-list-top"><strong>{detail.vehicle.vehicleLabel}</strong>{detail.priority === 'high' || detail.priority === 'critical' ? <b className={`priority-${detail.priority}`}>{detail.priority === 'critical' ? 'Urgent' : 'High priority'}</b> : null}</span>
                        <span className="move-row-stock">Stock {detail.vehicle.stock}</span>
                        <span className="move-row-vin">{record.vin}</span>
                      </span>
                      <span className="move-row-route">
                        <span className="transfer-list-route">{detail.vehicle.homeStore} → {record.destination}</span>
                        <span className="transfer-location"><MapPin aria-hidden="true" />{record.currentLocation}</span>
                        {away.isAway ? <span>{away.label}</span> : null}
                      </span>
                      <span className="move-row-next">
                        <span className="transfer-list-stage">{simpleRecord ? compactRequestStatus(record.requestStatus, true) : `Step ${step} of 5 · ${compactRequestStatus(record.requestStatus)}`}</span>
                        <span className="transfer-next"><small>Next</small><strong>{compactNextAction(record.nextAction)}</strong></span>
                        <span className="transfer-list-owner-row"><span>{record.nextActionOwner || 'Responsible person not recorded'}</span><span className={dueTone}>{dueLabel(detail)}</span></span>
                        {issueLabel ? <span className="transfer-list-alert"><CircleAlert aria-hidden="true" />{issueLabel}</span> : record.returnRequired && away.isAway ? <span className="transfer-list-return">{returnTimingLabel(record)}</span> : null}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                )
              })}
              {filteredDetails.length === 0 ? <div className="transfer-list-no-results"><strong>{queueView === 'needs-action' ? 'No move updates assigned to you' : 'No moves match this view and search.'}</strong><p>{queueView === 'needs-action' ? 'Active shows moves waiting on another person.' : storeScope === 'home' ? 'Try All stores or clear the search and stage filter.' : 'Clear the search or choose a different stage.'}</p></div> : null}
            </div>
          </aside>
          <div className="transfer-detail-surface" id="transfer-detail-workspace">
            {(requestedId || requestedVin) && selected ? (
              <header className="transfer-mobile-detail-bar">
                <button type="button" onClick={() => navigate('/transfers')} aria-label="Back to vehicle moves">
                  <ArrowLeft aria-hidden="true" />
                </button>
                <span>
                  <h1>Vehicle move</h1>
                  <small>{selected.detail.vehicle.stock} · {selected.record.workflowMode === 'simple' ? compactRequestStatus(selected.record.requestStatus, true) : `Step ${workflowStep(selected.record.requestStatus)} of 5 · ${compactRequestStatus(selected.record.requestStatus)}`}</small>
                </span>
              </header>
            ) : null}
            <TransferDetailLoader selected={selected} data={data} role={role} homeStore={homeStore} onAction={handleAction} returnTo={currentWorkspaceReturnPath(location)} />
          </div>
        </div>
      )}

      {simple ? <details className="move-location-disclosure"><summary><MapPin aria-hidden="true" size={18} /> Browse vehicle locations <ChevronDown aria-hidden="true" size={16} /></summary><VehicleLocationOverview vehicles={data.vehicles} transfers={data.transfers} homeStore={homeStore} /></details> : null}

      {pendingAction ? (
        <TransferActionDialog
          {...pendingAction}
          onClose={() => setPendingAction(null)}
          onComplete={(updated) => {
            if (isTerminalTransfer(updated)) setQueueView('history')
            navigate(`/transfers?id=${encodeURIComponent(updated.id)}`)
          }}
        />
      ) : null}
    </section>
  )
}
