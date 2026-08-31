import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  CarFront,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ListFilter,
  MapPin,
  Plus,
  Search,
  Truck,
  UserRoundCheck,
} from 'lucide-react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { toTransferDetail, toTransferVehicle } from '../../app/transferAdapters'
import { SourceWarning } from '../../components/SourceWarning'
import { getTransfer } from '../../lib/api'
import type { BootstrapData, StoreName, TransferRecord, UserRole } from '../../types'
import { formatDateTime, humanizeStatusLabel, locationConfidenceLabel } from './presentation'
import { TransferActionDialog } from './TransferActionDialog'
import { TransferEmptyState } from './TransferEmptyState'
import { TransferRequestWorkspace } from './TransferRequestWorkspace'
import { TransferTracker } from './TransferTracker'
import type { SelectOption, TransferActionKind, TransferDetail, TransferRequestDraft } from './types'
import './transfers-page.css'
import './transfer-workspace-v3.css'

const REASON_LABELS: Record<TransferRequestDraft['reasonCode'], string> = {
  'customer-need': 'Customer need',
  'manager-request': 'Manager / store need',
  other: 'Other reason',
}

type TransferQueueView = 'needs-action' | 'active' | 'history'
type TransferQueueFilter =
  | 'all'
  | 'my-location'
  | 'awaiting-approval'
  | 'driver-needed'
  | 'moving'
  | 'return-due'
  | 'sold-pending'
  | 'issues'
type TransferQueueSort = 'urgency' | 'needed-by' | 'recent' | 'stock' | 'route'

const WORKFLOW_STAGES = [
  { label: 'Salesperson request', mobileLabel: 'Request' },
  { label: 'My manager review', mobileLabel: 'Manager' },
  { label: 'Home-store availability & release', mobileLabel: 'Home-store' },
  { label: 'Driver scheduled', mobileLabel: 'Driver' },
  { label: 'Pickup & custody', mobileLabel: 'Custody' },
  { label: 'Sell or return', mobileLabel: 'Sold / Return' },
] as const

const TERMINAL_TRANSFER_STATES = new Set(['closed', 'declined', 'canceled', 'expired'])
const PASSIVE_TRANSFER_ACTIONS = new Set<TransferActionKind>(['open-source', 'report-condition', 'mark-exception', 'escalate'])

function normalizedStatus(value?: string): string {
  return (value ?? '').toLowerCase().trim().replace(/[_\s/]+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function isTerminalTransfer(record: TransferRecord): boolean {
  return TERMINAL_TRANSFER_STATES.has(normalizedStatus(record.requestStatus))
}

function needsTransferAction(detail: TransferDetail): boolean {
  return detail.allowedActions.some((action) => !PASSIVE_TRANSFER_ACTIONS.has(action))
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

function isAwaitingApproval(record: TransferRecord): boolean {
  return ['requested', 'submitted', 'manager-reviewed', 'needs-information'].includes(normalizedStatus(record.requestStatus))
}

function isMoving(record: TransferRecord): boolean {
  const request = normalizedStatus(record.requestStatus)
  const movement = normalizedStatus(record.movementStatus)
  return ['transport-assigned', 'picked-up', 'in-transit', 'return-assigned', 'return-in-transit'].includes(request) ||
    ['pickup-scheduled', 'released-to-custodian', 'in-transit-outbound', 'in-transit-return'].some((value) => movement.includes(value))
}

function needsReturnAttention(record: TransferRecord): boolean {
  if (!record.returnRequired || isTerminalTransfer(record)) return false
  const request = normalizedStatus(record.requestStatus)
  const movement = normalizedStatus(record.movementStatus)
  const deal = normalizedStatus(record.dealStatus)
  return Boolean(record.returnDueAt) || request.includes('return') || movement.includes('return') || deal.includes('not-sold')
}

function isSoldPendingNotDelivered(record: TransferRecord): boolean {
  const soldPending = normalizedStatus(record.dealStatus).includes('sold-pending')
  const deliveryConfirmed = normalizedStatus(record.deliveryStatus) === 'confirmed'
  return soldPending && !deliveryConfirmed
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
  if (record.returnDueAt) return `Return due ${formatDateTime(record.returnDueAt)}`
  return 'Return required · date not set'
}

function outcomeLabel(detail: TransferDetail): string {
  if (detail.status.delivery.code === 'confirmed') return humanizeStatusLabel(detail.status.delivery.label)
  return humanizeStatusLabel(detail.status.deal.label)
}

function TransferWorkflowPath({ record }: { record: TransferRecord }) {
  const current = workflowStage(record.requestStatus)
  return (
    <ol className="transfer-workflow-path" aria-label="Vehicle request and movement workflow">
      {WORKFLOW_STAGES.map(({ label, mobileLabel }, index) => {
        const stage = index + 1
        return (
          <li key={label} className={stage === current ? 'is-current' : stage < current ? 'is-complete' : undefined}>
            <span>{stage < current ? <CheckCircle2 aria-hidden="true" /> : stage}</span>
            <strong>
              <span className="transfer-stage-desktop-label">{label}</span>
              <span className="transfer-stage-mobile-label">{mobileLabel}</span>
            </strong>
          </li>
        )
      })}
    </ol>
  )
}

function TransferDetailLoader({
  selected,
  data,
  role,
  homeStore,
  onAction,
}: {
  selected: { record: TransferRecord; detail: TransferDetail } | null;
  data: BootstrapData;
  role: UserRole;
  homeStore: StoreName;
  onAction: (action: TransferActionKind, detail: TransferDetail) => void;
}) {
  const [recordDetail, setRecordDetail] = useState<TransferRecord | null>(null)
  useEffect(() => {
    let active = true
    const id = selected?.record.id
    if (!id) {
      setRecordDetail(null)
      return () => { active = false }
    }
    getTransfer(id, role, homeStore)
      .then((record) => { if (active) setRecordDetail(record) })
      .catch(() => { if (active) setRecordDetail(null) })
    return () => { active = false }
  }, [selected?.record.id, role, homeStore])
  const detail = recordDetail && selected && recordDetail.id === selected.record.id
    ? toTransferDetail(recordDetail, data.vehicles.find((vehicle) => vehicle.vin === recordDetail.vin), data.meta, role)
    : selected?.detail ?? null
  return <TransferTracker transfer={detail} mode="page" onAction={onAction} />
}

export function TransfersPage() {
  const { data, homeStore, role, submitTransfer } = useAppData()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [pendingAction, setPendingAction] = useState<{ action: TransferActionKind; detail: TransferDetail; record: TransferRecord } | null>(null)
  const [query, setQuery] = useState('')
  const [queueView, setQueueView] = useState<TransferQueueView>('active')
  const [queueFilter, setQueueFilter] = useState<TransferQueueFilter>('all')
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

  const requestedId = params.get('id')
  const requestedVin = params.get('vin')?.toUpperCase()
  const normalizedQuery = query.trim().toLowerCase()
  const filteredDetails = details
    .filter(({ record, detail }) => {
      const terminal = isTerminalTransfer(record)
      const needsAction = needsTransferAction(detail)
      if (queueView === 'history' ? !terminal : queueView === 'active' ? terminal : !needsAction || terminal) return false
      if (
        queueFilter === 'my-location' &&
        ![record.homeStore, record.requestingStore, record.currentLocation, record.destination].includes(homeStore)
      ) return false
      if (queueFilter === 'awaiting-approval' && !isAwaitingApproval(record)) return false
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
      if (queueSort === 'stock') return left.record.stockNumber.localeCompare(right.record.stockNumber, undefined, { numeric: true })
      if (queueSort === 'route') {
        return `${left.record.homeStore}|${left.record.destination}`.localeCompare(`${right.record.homeStore}|${right.record.destination}`)
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
  const selected =
    filteredDetails.find(({ record }) => record.id === requestedId) ||
    filteredDetails.find(({ record }) => record.vin === requestedVin) ||
    filteredDetails[0] ||
    null
  const queueCounts = {
    'needs-action': details.filter(({ record, detail }) => !isTerminalTransfer(record) && needsTransferAction(detail)).length,
    active: details.filter(({ record }) => !isTerminalTransfer(record)).length,
    history: details.filter(({ record }) => isTerminalTransfer(record)).length,
  }
  const workflowMetrics = {
    manager: details.filter(({ record }) => ['requested', 'submitted'].includes(normalizedStatus(record.requestStatus))).length,
    home: details.filter(({ record }) => ['manager-reviewed', 'needs-information'].includes(normalizedStatus(record.requestStatus))).length,
    driver: details.filter(({ record }) => ['approved', 'driver-requested', 'return-requested'].includes(normalizedStatus(record.requestStatus))).length,
    moving: details.filter(({ record }) => isMoving(record)).length,
    returns: details.filter(({ record }) => needsReturnAttention(record)).length,
  }
  const shortQueue = filteredDetails.length <= 2

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
    const vehicleSummary = requestVehicle ? toTransferVehicle(requestVehicle, data.meta) : null
    const stores: SelectOption[] = data.stores
      .filter((store) => store.store !== requestVehicle?.homeStore)
      .map((store) => ({ value: store.store, label: store.store }))
    const defaultRequestingStore = stores.some((store) => store.value === homeStore) ? homeStore : stores[0]?.value
    const managerApprovers: SelectOption[] = requestVehicle
      ? [{ value: `${homeStore}-manager`, label: `${homeStore} manager`, secondaryLabel: 'Your manager reviews and contacts the home store' }]
      : []

    return (
      <section className="transfer-request-page">
        <SourceWarning meta={data.meta} />
        <TransferRequestWorkspace
          vehicle={vehicleSummary}
          stores={stores}
          requesters={[{ value: 'joe-gallant', label: 'Joe Gallant', secondaryLabel: `${homeStore} · active prototype user` }]}
          managerApprovers={managerApprovers}
          defaultRequestingStore={defaultRequestingStore}
          defaultRequesterId="joe-gallant"
          defaultManagerApproverId={managerApprovers[0]?.value}
          onCancel={() => navigate('/transfers')}
          onSubmit={async (draft) => {
            const created = await submitTransfer({
              vin: draft.vin,
              requestingStore: draft.requestingStore as typeof homeStore,
              requestedBy: 'Joe Gallant',
              neededBy: draft.neededBy,
              reason: `${REASON_LABELS[draft.reasonCode]}${draft.reasonDetail?.trim() ? `: ${draft.reasonDetail.trim()}` : ''}`,
              customerReference: draft.customerReference?.trim() || undefined,
              customerAppointment: false,
              returnRequired: draft.returnRequired,
              returnDueAt: draft.targetReturnAt || undefined,
              priority: draft.priority,
              approvalOwner: managerApprovers.find((option) => option.value === draft.managerApproverId)?.label,
            })
            return { requestId: created.id }
          }}
        />
      </section>
    )
  }

  return (
    <section
      className={`transfers-page transfer-workspace-v3${requestedId && selected ? ' is-mobile-detail-open' : ''}`}
      data-mobile-detail-open={requestedId && selected ? 'true' : 'false'}
    >
      <SourceWarning meta={data.meta} />
      <header className="transfers-page-header">
        <div>
          <span>Current location, driver, timing, and return</span>
          <h1>Vehicle moves</h1>
          <p>See who requested each vehicle, where it is now, when the driver is coming, and what must happen next.</p>
        </div>
      </header>

      <div className="transfer-mobile-counts" aria-label="Current movement counts">
        <span><strong>{workflowMetrics.manager}</strong> Await mgr</span>
        <span><strong>{workflowMetrics.home}</strong> Home approval</span>
        <span><strong>{workflowMetrics.driver}</strong> Driver</span>
        <span><strong>{workflowMetrics.moving}</strong> Moving</span>
        <span><strong>{workflowMetrics.returns}</strong> Return</span>
      </div>

      {details.length > 0 ? (
        <section className="transfer-workflow-overview" aria-label="Movement workflow overview">
          <div className="transfer-workflow-metrics">
            <span><Clock3 aria-hidden="true" /><strong>{workflowMetrics.manager}</strong><small>Await manager</small></span>
            <span><UserRoundCheck aria-hidden="true" /><strong>{workflowMetrics.home}</strong><small>Home approval</small></span>
            <span><Truck aria-hidden="true" /><strong>{workflowMetrics.driver}</strong><small>Need driver</small></span>
            <span><ArrowLeftRight aria-hidden="true" /><strong>{workflowMetrics.moving}</strong><small>In motion</small></span>
            <span><CircleAlert aria-hidden="true" /><strong>{workflowMetrics.returns}</strong><small>Return due</small></span>
          </div>
          {selected ? <TransferWorkflowPath record={selected.record} /> : null}
        </section>
      ) : null}

      {details.length === 0 ? (
        <div className="transfers-empty-surface">
          <TransferEmptyState onAction={() => navigate('/inventory')} actionLabel="Find a vehicle" />
          <div className="movement-operating-rule">
            <ArrowLeftRight aria-hidden="true" />
            <div><strong>Home Store owns the release. Requesting Store owns the custody.</strong><span>Accountability continues until the Home Store confirms return or an authorized final disposition is recorded.</span></div>
          </div>
        </div>
      ) : (
        <div
          className={`transfers-layout ${shortQueue ? 'transfers-layout--short-queue' : 'transfers-layout--master-detail'}`}
          data-queue-size={filteredDetails.length}
        >
          <aside className={`transfer-list${shortQueue ? ' transfer-list--short' : ''}`} aria-label="Movement requests">
            <div className="transfer-list-toolbar">
              <button className="mif-button mif-button--primary transfer-list-create" type="button" aria-label="Request a vehicle" onClick={() => navigate('/inventory')}>
                <Plus aria-hidden="true" />
                <span className="transfer-create-desktop-label">Find a vehicle to request</span>
                <span className="transfer-create-mobile-label">Request vehicle</span>
              </button>
              <label className="transfer-list-search">
                <Search aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vehicle, stock, VIN, store, driver…" aria-label="Search vehicle moves" />
              </label>
              <label className="transfer-list-filter" title="Filter vehicle moves">
                <ListFilter aria-hidden="true" />
                <span className="transfer-control-label">Filter</span>
                <span className="sr-only">Filter vehicle moves</span>
                <select
                  aria-label="Filter vehicle moves"
                  value={queueFilter}
                  onChange={(event) => setQueueFilter(event.target.value as TransferQueueFilter)}
                >
                  <option value="all">All moves</option>
                  <option value="my-location">My location</option>
                  <option value="awaiting-approval">Awaiting approval</option>
                  <option value="driver-needed">Driver needed</option>
                  <option value="moving">Pickup or in transit</option>
                  <option value="return-due">Return required / due</option>
                  <option value="sold-pending">Sold pending · not delivered</option>
                  <option value="issues">Issue or overdue</option>
                </select>
              </label>
              <label className="transfer-list-sort" title="Sort vehicle moves">
                <ArrowDownUp aria-hidden="true" />
                <span className="transfer-control-label">Sort</span>
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
              <div className="transfer-list-views" role="group" aria-label="Movement queue view">
                {([
                  ['needs-action', 'Needs action'],
                  ['active', 'Active'],
                  ['history', 'History'],
                ] as Array<[TransferQueueView, string]>).map(([value, label]) => (
                  <button type="button" key={value} className={queueView === value ? 'is-active' : undefined} onClick={() => setQueueView(value)} aria-pressed={queueView === value}>
                    {label}<span>{queueCounts[value]}</span>
                  </button>
                ))}
              </div>
              <div className="transfer-list-count" aria-live="polite">{filteredDetails.length} matching move{filteredDetails.length === 1 ? '' : 's'}</div>
            </div>
            <div className="transfer-list-items">
              {filteredDetails.map(({ record, detail }) => {
                const isSelected = selected?.record.id === record.id
                const stage = workflowStage(record.requestStatus)
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
                    {detail.vehicle.imageUrl ? (
                      <img className="transfer-list-photo" src={detail.vehicle.imageUrl} alt="" />
                    ) : (
                      <span className="transfer-list-photo transfer-list-photo--placeholder" aria-hidden="true"><CarFront /></span>
                    )}
                    <span className="transfer-list-copy transfer-list-copy--desktop">
                      <span className="transfer-list-top"><strong>{detail.vehicle.vehicleLabel}</strong><b className={`priority-${detail.priority ?? 'normal'}`}>{detail.priority ?? 'normal'}</b></span>
                      <span className="transfer-list-route">{detail.vehicle.stock} · {detail.vehicle.homeStore} → {record.destination}</span>
                      <span className="transfer-list-signals">
                        <span className="transfer-location"><MapPin aria-hidden="true" /> {record.currentLocation} · {locationConfidenceLabel(record.locationConfidence)}</span>
                        <span className="transfer-list-stage">Stage {workflowStage(record.requestStatus)} · {detail.status.request.label}</span>
                      </span>
                      <span className="transfer-next"><strong>Next:</strong> {record.nextAction} · {record.nextActionOwner || 'Unassigned'}</span>
                      <span className="transfer-list-accountability">
                        <span><b>Requested</b> {record.requestedBy || 'Not recorded'}</span>
                        <span><b>Approval</b> {record.approvedBy || detail.approvalOwnerLabel || 'Not recorded'}</span>
                        <span><b>Driver</b> {record.transportAssignee || 'Not set'}</span>
                      </span>
                      <span className="transfer-list-outcomes">
                        <span><b>Deal</b> {humanizeStatusLabel(detail.status.deal.label)}</span>
                        <span><b>Delivery</b> {humanizeStatusLabel(detail.status.delivery.label)}</span>
                        <span><b>Return</b> {returnTimingLabel(record)}</span>
                      </span>
                      <span className="transfer-due"><span>{dueLabel(detail)}</span><span>{record.custodian ? `Custodian ${record.custodian}` : 'Custodian not assigned'}</span></span>
                    </span>
                    <span className="transfer-list-mobile-copy">
                      <strong className="transfer-mobile-stock">{detail.vehicle.stock}</strong>
                      <span className="transfer-mobile-vehicle">{detail.vehicle.vehicleLabel}</span>
                      <span className="transfer-mobile-route">{detail.vehicle.homeStore}<span aria-hidden="true">→</span>{record.destination}</span>
                      <span className="transfer-mobile-location"><MapPin aria-hidden="true" />Now: {record.currentLocation} · {locationConfidenceLabel(record.locationConfidence)}</span>
                      <span className="transfer-mobile-stage"><b>{stage}</b><span>{detail.status.request.label}</span></span>
                      <span className="transfer-mobile-owner"><UserRoundCheck aria-hidden="true" /><span>Next: {record.nextActionOwner || 'Unassigned'}</span></span>
                    </span>
                    <span className="transfer-list-mobile-rail">
                      <span className={`transfer-mobile-due ${dueTone}`}>{dueLabel(detail)}</span>
                      <span className="transfer-mobile-driver">{record.transportAssignee ? `Driver: ${record.transportAssignee}` : 'Driver not set'}</span>
                      <span className="transfer-mobile-outcome">{outcomeLabel(detail)}</span>
                      {issueLabel ? (
                        <span className="transfer-mobile-issue"><CircleAlert aria-hidden="true" />{issueLabel}</span>
                      ) : record.returnRequired ? (
                        <span className="transfer-mobile-return">{returnTimingLabel(record)}</span>
                      ) : null}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                )
              })}
              {filteredDetails.length === 0 ? <p className="transfer-list-no-results">No moves match this view and search.</p> : null}
            </div>
          </aside>
          <div className="transfer-detail-surface" id="transfer-detail-workspace">
            {requestedId && selected ? (
              <header className="transfer-mobile-detail-bar">
                <button type="button" onClick={() => navigate('/transfers')} aria-label="Back to vehicle moves">
                  <ArrowLeft aria-hidden="true" />
                </button>
                <span>
                  <strong>{selected.detail.vehicle.vehicleLabel}</strong>
                  <small>{selected.detail.vehicle.stock} · {selected.detail.vehicle.homeStore} → {selected.record.destination}</small>
                </span>
              </header>
            ) : null}
            <TransferDetailLoader selected={selected} data={data} role={role} homeStore={homeStore} onAction={handleAction} />
          </div>
        </div>
      )}

      {pendingAction ? (
        <TransferActionDialog
          {...pendingAction}
          onClose={() => setPendingAction(null)}
          onComplete={(updated) => navigate(`/transfers?id=${encodeURIComponent(updated.id)}`)}
        />
      ) : null}
    </section>
  )
}
