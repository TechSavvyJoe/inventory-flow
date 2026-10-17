import { useWorkspaceState, useWorkspaceScroll } from '../../lib/workspace-memory'
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
  X,
} from 'lucide-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { toTransferDetail, toTransferVehicle } from '../../app/transferAdapters'
import { SourceWarning } from '../../components/SourceWarning'
import { VehicleQuickFacts } from '../../components/VehicleQuickFacts'
import { PredictiveSearchInput } from '../../components/PredictiveSearchInput'
import { getTransfer } from '../../lib/api'
import { vehiclePhotoDisplaySources } from '../../lib/vehicle-photos'
import { STORE_NAMES, type BootstrapData, type StoreName, type TransferRecord, type UserRole } from '../../types'
import { formatDateTime, humanizeStatusLabel } from './presentation'
import { TransferActionDialog } from './TransferActionDialog'
import { TransferEmptyState } from './TransferEmptyState'
import { TransferRequestWorkspace } from './TransferRequestWorkspace'
import { TransferTracker } from './TransferTracker'
import type { SelectOption, TransferActionKind, TransferDetail, TransferRequestDraft } from './types'
import { awayFromHomeSummary } from './moveSummary'
import { selectRequestedTransfer } from './transfer-selection'
import { VehicleLocationOverview } from './VehicleLocationOverview'
import { readBoardRoute, transferMatchesBoardRoute, type BoardRoute } from '../overview/overview-links'
import { simpleTransferActions } from './SimpleTransferTracker'
import { currentWorkspaceReturnPath, readWorkspaceReturnPath, vehicleWorkspacePath, withWorkspaceReturnPath, workspaceReturnLabel } from '../../lib/inventory-navigation'
import { searchFieldsMatch } from '../../lib/search'
import { WORKFLOW_RESET_LABELS } from '../../lib/workflow-view-reset'
import { flowButtonClassName, FlowButton, FlowIconButton, FlowPageHeader } from '../../design-system'
import { isReturnOverdue, slaLabel, type SlaStatus } from '../../lib/sla-label'
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
  | 'overdue-returns'
  | 'location-exceptions'
type TransferQueueSort = 'urgency' | 'needed-by' | 'recent' | 'stock' | 'route'
const QUEUE_FILTER_VALUES: readonly TransferQueueFilter[] = ['all', 'my-location', 'my-home-inventory', 'requested-by-my-store', 'away-from-home', 'awaiting-approval', 'ready-to-collect', 'at-requesting-store', 'driver-needed', 'moving', 'return-due', 'sold-pending', 'issues', 'overdue-returns', 'location-exceptions']

const TERMINAL_TRANSFER_STATES = new Set(['closed', 'declined', 'canceled', 'expired'])
// The two saved views Group operations offered managers, now filters on
// Moves > All stores. They are shown only to managers in that scope.
const MANAGER_GROUP_FILTERS = new Set<TransferQueueFilter>(['overdue-returns', 'location-exceptions'])
// Overview links (OVERVIEW_SPEC §8.2): `view` picks a queue filter in Active;
// it is read once on entry and never persisted as a URL.
const LINK_QUEUE_FILTERS: Partial<Record<string, TransferQueueFilter>> = {
  moving: 'moving',
  planned: 'ready-to-collect',
  'return-due': 'return-due',
  'sold-pending': 'sold-pending',
  issues: 'issues',
  'return-overdue': 'overdue-returns',
}
const LOCATION_EXCEPTION_CONFIDENCE = new Set(['conflicting', 'unknown', 'stale'])
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
  return null
}

function nextStepStatus(record: TransferRecord, detail: TransferDetail, viewerStore: StoreName): SlaStatus {
  return slaLabel({
    sla: detail.nextAction.sla,
    nextActionStore: record.nextActionStore,
    nextActionOwner: record.nextActionOwner,
    viewerStore,
  })
}

/** Overdue work the viewer's own store has to act on, or whose owner was not published. */
function isOwnOverdue(status: SlaStatus): boolean {
  return status.overdue && status.tone === 'danger'
}

function dueLabel(detail: TransferDetail, status: SlaStatus): string {
  if (!detail.nextAction.dueAt) return status.label
  // Another store's overdue step names who it is waiting on instead of the owner column.
  if (status.overdue && !isOwnOverdue(status)) return status.label
  return `${status.overdue ? 'Overdue' : 'Due'} ${formatDateTime(detail.nextAction.dueAt)}`
}

const DUE_TONE_CLASS: Record<SlaStatus['tone'], string | undefined> = {
  danger: 'is-overdue',
  warning: 'is-due-soon',
  ok: 'is-on-track',
  neutral: undefined,
  none: undefined,
}

function isLocationException(record: TransferRecord): boolean {
  return LOCATION_EXCEPTION_CONFIDENCE.has(record.locationConfidence) || normalizedStatus(record.movementStatus) === 'location-exception'
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

function moveSearchValues(record: TransferRecord, detail: TransferDetail): unknown[] {
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
  ]
}

function moveSearchCandidate({ record, detail }: { record: TransferRecord; detail: TransferDetail }) {
  return {
    id: record.id,
    label: record.vehicleName,
    detail: `#${record.stockNumber} · ${record.currentLocation}`,
    value: record.stockNumber,
    searchValues: moveSearchValues(record, detail),
  }
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

// Rows written before the move-copy pass keep their stored wording. Shorten
// those legacy sentences into the same phrases new rows already use, so one
// action reads the same in the queue, the tracker and the history.
function compactNextAction(value: string | undefined, { homeStore, destination }: { homeStore?: string; destination?: string } = {}): string {
  const action = value?.trim() || 'No next step recorded'
  if (/requesting manager confirms availability and release/i.test(action)) return 'Approve, then call the home store'
  if (/(?:contact|calls?) .*used-car manager/i.test(action)) return 'Call the home store, record the answer'
  if (/home-store.*availability.*release/i.test(action)) return 'Record the home store’s answer'
  if (/confirm.*returned home|confirm home receipt|home manager confirms receipt/i.test(action)) return homeStore ? `Confirm the vehicle is back at ${homeStore}` : 'Confirm the vehicle is back home'
  if (/record call for a driver|request.*driver|calls stacey for a driver|asks its manager or coordinator for a driver/i.test(action)) return 'Ask for a driver'
  if (/work the vehicle or start its return/i.test(action)) return 'Show the vehicle, then start its return'
  if (/confirm arrival at requesting store/i.test(action)) return destination ? `Confirm the vehicle arrived at ${destination}` : 'Confirm the vehicle arrived'
  if (/record customer showing or vehicle outcome|record an outcome or return the vehicle/i.test(action)) return 'Record the showing outcome'
  if (/assigned driver picks up vehicle/i.test(action)) return 'Collect the vehicle and confirm you have it'
  if (/close movement workflow/i.test(action)) return 'Close the move'
  if (/request return to home store|record when the vehicle starts its return/i.test(action)) return 'Start the return'
  return action
}

function compactRequestStatus(value: string, simple = false): string {
  const status = normalizedStatus(value)
  if (simple) {
    if (status === 'closed') return 'Complete'
    if (['requested', 'submitted', 'manager-reviewed', 'needs-information'].includes(status)) return 'Waiting on manager approval'
    if (status === 'approved') return 'Approved · show or return'
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
  if (['requested', 'submitted'].includes(status)) return 'Waiting on manager approval'
  if (['manager-reviewed', 'needs-information'].includes(status)) return 'Call the home store · record the answer'
  if (status === 'approved') return 'Released · assign a driver'
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
  const [detailRequest, setDetailRequest] = useState<{
    context: typeof requestContext;
    status: 'loading' | 'ready' | 'failed';
    record?: TransferRecord;
  } | null>(null)
  const [retryVersion, setRetryVersion] = useState(0)
  useEffect(() => {
    let active = true
    const id = requestContext.id
    if (!id) {
      setDetailRequest(null)
      return () => { active = false }
    }
    setDetailRequest({ context: requestContext, status: 'loading' })
    // The active flag guards private data and actions from an earlier context.
    // Do not abort a small same-origin read on every status refresh: WebKit
    // reports those expected cancellations as access-control console errors.
    // A stale response is safely ignored, while the latest context still gets
    // its own authoritative detail request.
    getTransfer(id, requestContext.role, requestContext.homeStore)
      .then((record) => {
        if (!active) return
        setDetailRequest(record?.id === id
          ? { context: requestContext, status: 'ready', record }
          : { context: requestContext, status: 'failed' })
      })
      .catch(() => { if (active) setDetailRequest({ context: requestContext, status: 'failed' }) })
    return () => {
      active = false
    }
  }, [requestContext, retryVersion])
  const currentRequest = detailRequest?.context === requestContext ? detailRequest : null
  const recordDetail = currentRequest?.status === 'ready' ? currentRequest.record : undefined
  const detail = recordDetail
    ? toTransferDetail(recordDetail, data.vehicles.find((vehicle) => vehicle.vin === recordDetail.vin), data.meta, role)
    : selected?.detail ?? null
  const vehicle = data.vehicles.find(vehicle => vehicle.vin === selectedRecord?.vin)
  const failed = currentRequest?.status === 'failed'
  return <>
    {selected && currentRequest?.status !== 'ready' ? <div className="move-detail-load" role={failed ? 'alert' : 'status'}>
      <p>{failed ? 'Full move record could not load. The summary remains available; additional history and details may be missing.' : 'Loading full move record… Summary remains available.'}</p>
      {failed ? <button type="button" onClick={() => setRetryVersion(version => version + 1)}>Retry move details</button> : null}
    </div> : null}
    <TransferTracker transfer={detail} viewerStore={homeStore} mode="page" onAction={onAction} vehicleLinks={vehicle ? <nav className="move-vehicle-links" aria-label="Vehicle reference">
    <Link to={vehicleWorkspacePath(vehicle.vin, { returnTo })}>Vehicle details</Link>
    <Link to={vehicleWorkspacePath(vehicle.vin, { tab: 'data', returnTo })}>Records</Link>
  </nav> : null} />
  </>
}

export function TransfersPage() {
  const { data, homeStore, role, currentUser, submitTransfer } = useAppData()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [pendingAction, setPendingAction] = useState<{ action: TransferActionKind; detail: TransferDetail; record: TransferRecord } | null>(null)
  const accessContext = `${currentUser}:${role}:${homeStore}`
  const requestMode = location.pathname.endsWith('/new')
  const origin = readWorkspaceReturnPath(params.get('returnTo'))
  const safeReturnTo = origin ?? '/transfers'
  const currentPath = currentWorkspaceReturnPath(location)
  const requestedId = params.get('id')
  const requestedVin = params.get('vin')?.toUpperCase()
  const [mobileDetail, setMobileDetail] = useState(() => window.matchMedia?.('(max-width: 760px)').matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 760px)')
    if (!media) return
    const update = () => setMobileDetail(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const [query, setQuery] = useWorkspaceState(accessContext, 'transfers.query', '')
  const [requestQuery, setRequestQuery] = useWorkspaceState(accessContext, 'transfers.vehicle-query', '')
  const [queueView, setQueueView] = useWorkspaceState<TransferQueueView>(accessContext, 'transfers.view', 'active')
  const [queueFilter, setQueueFilter] = useWorkspaceState<TransferQueueFilter>(accessContext, 'transfers.filter', 'all')
  const [storeScope, setStoreScope] = useWorkspaceState<'home' | 'group'>(accessContext, 'transfers.scope', 'home')
  const [queueSort, setQueueSort] = useWorkspaceState<TransferQueueSort>(accessContext, 'transfers.sort', 'urgency')
  // An Overview store count narrows the queue to that home store for this
  // visit only (one-shot, not persisted).
  const [linkedHomeStore, setLinkedHomeStore] = useState<StoreName | null>(null)
  // A store-board arrow narrows the queue to exactly that arrow's moves, once.
  const [linkedRoute, setLinkedRoute] = useState<BoardRoute | null>(null)
  const linkView = requestMode ? null : params.get('view')
  const linkStore = requestMode ? null : params.get('store')
  const linkRoute = requestMode ? null : [params.get('from'), params.get('to'), params.get('leg')].join('|')
  const restoredView = params.get('queueView')
  const restoredFilter = params.get('queueFilter')
  const restoredScope = params.get('queueScope')
  useEffect(() => {
    if (requestMode || (linkView === null && linkStore === null && !params.has('from') && !params.has('to') && !params.has('leg'))) return
    const route = readBoardRoute(params)
    const filter = linkView ? LINK_QUEUE_FILTERS[linkView] : undefined
    const store = STORE_NAMES.includes(linkStore as StoreName) ? linkStore as StoreName : null
    const restoring = ['active', 'needs-action', 'history'].includes(restoredView ?? '')
    if (restoring) {
      setQueueView(restoredView as TransferQueueView)
      if (QUEUE_FILTER_VALUES.includes(restoredFilter as TransferQueueFilter)) setQueueFilter(restoredFilter as TransferQueueFilter)
      if (restoredScope === 'home' || restoredScope === 'group') setStoreScope(restoredScope)
    } else {
      if (route || filter || store) setQueueView('active')
      if (route) setQueueFilter('all')
      if (filter) setQueueFilter(filter)
      if (route || store) setStoreScope('group')
    }
    if (route) setLinkedRoute(route)
    if (store) setLinkedHomeStore(store)
    const next = new URLSearchParams(location.search)
    for (const key of ['from', 'to', 'leg', 'view', 'store', 'queueView', 'queueFilter', 'queueScope']) next.delete(key)
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next.toString()}` : '', hash: location.hash }, { replace: true })
  }, [linkRoute, linkView, linkStore, restoredView, restoredFilter, restoredScope]) // eslint-disable-line react-hooks/exhaustive-deps -- applied once per link

  const details = useMemo(() => {
    if (!data) return []
    const vehicles = new Map(data.vehicles.map((vehicle) => [vehicle.vin, vehicle]))
    return data.transfers.map((record) => ({
      record,
      detail: toTransferDetail(record, vehicles.get(record.vin), data.meta, role),
    }))
  }, [data, role])

  // One-shot Overview filters live in this component. Carry them in links
  // that leave the page so a return can restore the same queue after remount.
  const returnParams = new URLSearchParams(location.search)
  if (linkedHomeStore) returnParams.set('store', linkedHomeStore)
  if (linkedRoute) {
    returnParams.set('from', linkedRoute.from)
    returnParams.set('to', linkedRoute.to)
    returnParams.set('leg', linkedRoute.leg)
  }
  if (linkedHomeStore || linkedRoute) {
    returnParams.set('queueView', queueView)
    returnParams.set('queueFilter', queueFilter)
    returnParams.set('queueScope', storeScope)
  }
  const workspaceReturnPath = currentWorkspaceReturnPath({ ...location, search: returnParams.size ? `?${returnParams.toString()}` : '' })
  const movePath = (path: string) => withWorkspaceReturnPath(path, origin ?? workspaceReturnPath)

  const requestedSelection = requestedId || requestedVin ? selectRequestedTransfer(details, requestedId, requestedVin) : null
  const detailKey = requestedSelection ? `transfers.detail:id:${requestedSelection.record.id}`
    : requestedId ? `transfers.detail:id:${requestedId}` : `transfers.detail:vin:${requestedVin}`
  useWorkspaceScroll(accessContext, requestMode ? 'transfers.new' : requestedId || requestedVin ? detailKey : 'transfers.queue', {
    initialTop: !requestMode && (requestedId || requestedVin) && mobileDetail ? 0 : undefined,
    preserveRecordedPositionOnExit: true,
  })

  if (!data) return null
  const simple = !details.length || details.some(({ record }) => record.workflowMode === 'simple')

  const managerGroupFilters = storeScope === 'group' && (role === 'manager' || role === 'group_manager')
  // A manager filter saved in All stores never silently narrows My store.
  // An Overview link may open a manager view for any role that can see the count.
  const managerFiltersAvailable = managerGroupFilters || linkedHomeStore !== null
  const activeFilter: TransferQueueFilter = MANAGER_GROUP_FILTERS.has(queueFilter) && !managerFiltersAvailable ? 'all' : queueFilter
  const statusFor = ({ record, detail }: { record: TransferRecord; detail: TransferDetail }) => nextStepStatus(record, detail, homeStore)
  // Overdue returns are judged at the bootstrap's time, as the server's store summary is.
  // The server judges overdue at request time, so the filter uses the clock too.
  const referenceNow = Date.now()
  const scopedDetails = details.filter(({ record }) => storeScope === 'group' ||
    [record.homeStore, record.requestingStore, record.currentLocation, record.destination].includes(homeStore))
  const filteredDetails = scopedDetails
    .filter(({ record, detail }) => {
      const terminal = isTerminalTransfer(record)
      const needsAction = needsTransferAction(detail)
      if (queueView === 'history' ? !terminal : queueView === 'active' ? terminal : !needsAction || terminal) return false
      if (
        activeFilter === 'my-location' &&
        ![record.homeStore, record.requestingStore, record.currentLocation, record.destination].includes(homeStore)
      ) return false
      if (activeFilter === 'my-home-inventory' && record.homeStore !== homeStore) return false
      if (activeFilter === 'requested-by-my-store' && record.requestingStore !== homeStore) return false
      if (activeFilter === 'away-from-home' && !awayFromHomeSummary(record.homeStore, record.currentLocation, record.events, { destination: record.destination }).isAway) return false
      if (activeFilter === 'awaiting-approval' && !isAwaitingApproval(record)) return false
      if (activeFilter === 'ready-to-collect' && !['approved', 'transport-assigned', 'pickup-scheduled'].includes(normalizedStatus(record.requestStatus))) return false
      if (activeFilter === 'at-requesting-store' && !['arrived', 'customer-showing', 'sale-outcome-pending', 'sale-confirmed', 'not-sold'].includes(normalizedStatus(record.requestStatus))) return false
      if (
        activeFilter === 'driver-needed' &&
        (terminal || Boolean(record.transportAssignee) || workflowStage(record.requestStatus) < 3 || workflowStage(record.requestStatus) > 4)
      ) return false
      if (activeFilter === 'moving' && !isMoving(record)) return false
      if (activeFilter === 'return-due' && !needsReturnAttention(record)) return false
      if (activeFilter === 'sold-pending' && !isSoldPendingNotDelivered(record)) return false
      if (activeFilter === 'issues' && !transferIssueLabel(detail) && !isOwnOverdue(statusFor({ record, detail }))) return false
      if (activeFilter === 'overdue-returns' && !isReturnOverdue(record, referenceNow)) return false
      if (activeFilter === 'location-exceptions' && !isLocationException(record)) return false
      if (linkedHomeStore && record.homeStore !== linkedHomeStore) return false
      if (linkedRoute && !transferMatchesBoardRoute(record, linkedRoute)) return false
      return searchFieldsMatch(query, moveSearchValues(record, detail))
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
      // Another store's overdue step is waiting, not urgent, for this viewer.
      const slaRank = (status: SlaStatus) => status.overdue && !isOwnOverdue(status)
        ? 1.5
        : { breached: 4, overdue: 3, 'due-soon': 2, 'on-track': 1, none: 0 }[status.state]
      const slaDifference = slaRank(statusFor(right)) - slaRank(statusFor(left))
      if (slaDifference) return slaDifference
      const priorityDifference = transferPriorityScore(right.record) - transferPriorityScore(left.record)
      if (priorityDifference) return priorityDifference
      return dateScore(left.detail.nextAction.dueAt) - dateScore(right.detail.nextAction.dueAt)
    })
  // An authorized deep link opens the exact move, including completed moves or
  // a different store. Filtering the queue must never substitute another move.
  const selected = requestedId || requestedVin ? requestedSelection : selectRequestedTransfer(filteredDetails, requestedId, requestedVin)
  const queueCounts = {
    'needs-action': scopedDetails.filter(({ record, detail }) => !isTerminalTransfer(record) && needsTransferAction(detail)).length,
    active: scopedDetails.filter(({ record }) => !isTerminalTransfer(record)).length,
    history: scopedDetails.filter(({ record }) => isTerminalTransfer(record)).length,
  }
  // Suggestions search the authorized store-scoped set so a Completed move can
  // still surface while Active/Needs me is selected. The list itself stays filtered.
  const searchCandidates = scopedDetails.map(moveSearchCandidate)
  const queryMatchedScoped = query.trim()
    ? scopedDetails.filter(({ record, detail }) => searchFieldsMatch(query, moveSearchValues(record, detail)))
    : []
  const matchesOutsideView = queryMatchedScoped.filter((match) =>
    !filteredDetails.some((row) => row.record.id === match.record.id))
  const requestVehicle = requestedVin ? data.vehicles.find((vehicle) => vehicle.vin === requestedVin) : undefined

  function revealSearchMatchesOutsideView() {
    setQueueFilter('all')
    setLinkedHomeStore(null)
    setLinkedRoute(null)
    setQueueView(matchesOutsideView.every(({ record }) => isTerminalTransfer(record)) ? 'history' : 'active')
  }

  function handleAction(action: TransferActionKind, detail: TransferDetail) {
    const record = data?.transfers.find((item) => item.id === detail.id)
    if (!record) return
    if (action === 'open-source') {
      const listingUrl = detail.vehicle.listingUrl
      if (listingUrl) window.open(listingUrl, '_blank', 'noopener,noreferrer')
      return
    }
    setPendingAction({ action, detail, record })
  }

  if (requestMode) {

    if (!requestedVin) {
      const activeByVin = new Map(data.transfers.filter(record => !isTerminalTransfer(record)).map(record => [record.vin, record]))
      const candidates = data.vehicles
        .filter(vehicle => creationIntentFor(vehicle, role, homeStore))
        .filter(vehicle => searchFieldsMatch(requestQuery, [vehicle.stockNumber, vehicle.vin, vehicle.vehicleName, vehicle.homeStore]))
        .slice(0, 30)
      return <section className="transfer-request-page move-vehicle-picker-page">
        <SourceWarning meta={data.meta} />
        <header className="move-picker-heading">
          <div><span>Vehicle moves</span><h1>Start a move</h1><p>Search by stock, VIN, or vehicle. The next step matches your role and the vehicle’s home store.</p></div>
          <button type="button" className="mif-icon-button" aria-label="Close vehicle picker" onClick={() => navigate(safeReturnTo)}><ArrowLeft aria-hidden="true" /></button>
        </header>
        <PredictiveSearchInput className="move-picker-search" autoFocus value={requestQuery} onChange={setRequestQuery} ariaLabel="Search inventory to move" clearLabel="Clear vehicle search" placeholder="Search stock, VIN, or vehicle" candidates={candidates.map(vehicle => ({ id: vehicle.vin, label: vehicle.vehicleName, detail: `#${vehicle.stockNumber} · ${vehicle.homeStore}`, value: vehicle.stockNumber, searchValues: [vehicle.stockNumber, vehicle.vin, vehicle.vehicleName, vehicle.homeStore] }))} />
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
                <button type="button" className="mif-button mif-button--secondary" onClick={() => navigate(movePath(`/transfers?id=${encodeURIComponent(active.id)}`))}>Track move</button>
                {vehicle.movement?.canDirectReroute === true ? <button type="button" className="mif-button mif-button--primary" onClick={() => navigate(movePath(`/transfers/new?vin=${encodeURIComponent(vehicle.vin)}&intent=direct`))}>Move again</button> : null}
              </div>
                : <button type="button" className="mif-button mif-button--primary" disabled={blocked} title={blocked ? 'Another move is already open for this vehicle.' : undefined} onClick={() => navigate(movePath(`/transfers/new?vin=${encodeURIComponent(vehicle.vin)}&intent=${intent}`))}>{blocked ? 'Move already open' : intent === 'direct' ? 'Move vehicle' : `Request to ${homeStore}`}</button>}
            </article>
          })}
          {!candidates.length ? <div className="move-picker-empty"><CarFront aria-hidden="true" /><strong>No matching vehicles</strong><p>Check the stock number or search across the vehicle name and VIN.</p>{requestQuery ? <button type="button" className="mif-button mif-button--secondary" onClick={() => setRequestQuery('')}>Clear search</button> : null}</div> : null}
        </div>
      </section>
    }

    const permittedIntent = requestVehicle ? creationIntentFor(requestVehicle, role, homeStore) : null
    if (requestVehicle && !permittedIntent) {
      return <section className="transfer-request-page"><div className="move-request-home-message">
        <CarFront aria-hidden="true" size={32} />
        <h1>This move is not available for your role</h1>
        <p>Salespeople request vehicles from another store. A store manager can directly move their own inventory, and a group manager can move inventory between any stores.</p>
        <button type="button" className="mif-button mif-button--primary" onClick={() => navigate(withWorkspaceReturnPath('/transfers/new', safeReturnTo))}>Choose another vehicle</button>
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
          onViewRequest={(id) => navigate(withWorkspaceReturnPath(`/transfers?id=${encodeURIComponent(id)}`, safeReturnTo))}
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
      <FlowPageHeader tone="brand" className="transfers-page-header" icon={<ArrowLeftRight aria-hidden="true" />} title="Vehicle moves"
        description={storeScope === 'home' ? `Vehicles requested by, owned by, or currently at ${homeStore}.` : 'Moves you can access across the group.'}
        actions={<>{(requestedId || requestedVin || origin) ? <Link className={flowButtonClassName({ variant: 'secondary', size: 'md' })} to={safeReturnTo}><ArrowLeft size={18} aria-hidden="true" />{workspaceReturnLabel(safeReturnTo, 'Back to vehicle moves')}</Link> : null}<FlowButton className="transfer-header-create" variant="primary" size="md" aria-label="Start a vehicle move" onClick={() => navigate(withWorkspaceReturnPath('/transfers/new', currentPath))} iconBefore={<Plus aria-hidden="true" />}>Start a move</FlowButton></>}>
      <div className="move-store-scope" role="group" aria-label="Vehicle move stores">
        <FlowButton size="md" variant={storeScope === 'home' ? 'primary' : 'secondary'} aria-pressed={storeScope === 'home'} onClick={() => { setStoreScope('home'); setLinkedHomeStore(null) }}>My store <span className="move-store-scope-location">{homeStore}</span></FlowButton>
        <FlowButton size="md" variant={storeScope === 'group' ? 'primary' : 'secondary'} aria-pressed={storeScope === 'group'} onClick={() => { setStoreScope('group'); setLinkedHomeStore(null) }}>All stores</FlowButton>
      </div>
      </FlowPageHeader>

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
          <aside className="transfer-list" aria-label="Vehicle moves">
            <div className="transfer-list-toolbar">
              <PredictiveSearchInput className="transfer-list-search" value={query} onChange={setQuery} ariaLabel="Search vehicle moves" clearLabel="Clear move search" placeholder={simple ? 'Search stock, vehicle, salesperson, or store' : 'Search stock, VIN, vehicle, store, or driver'} candidates={searchCandidates} />
              <div className="transfer-list-views" role="group" aria-label="Move queue view">
                {([
                  ['active', 'Active'],
                  ['needs-action', 'Needs me'],
                  ['history', 'Completed'],
                ] as Array<[TransferQueueView, string]>).map(([value, label]) => (
                  <FlowButton size="md" variant={queueView === value ? 'primary' : 'secondary'} type="button" key={value} aria-label={value === 'needs-action' ? `Your next steps, ${queueCounts[value]} ${queueCounts[value] === 1 ? 'move' : 'moves'}` : undefined} className={queueView === value ? 'is-active' : undefined} onClick={() => setQueueView(value)} aria-pressed={queueView === value}>
                    {label}<span className="transfer-list-view-count">{queueCounts[value]}</span>
                  </FlowButton>
                ))}
              </div>
              <div className="transfer-list-tools">
              <label className="transfer-list-filter" title="Filter vehicle moves">
                <ListFilter aria-hidden="true" />
                <span className="sr-only">Filter vehicle moves</span>
                <select
                  aria-label="Filter vehicle moves"
                  value={activeFilter}
                  onChange={(event) => setQueueFilter(event.target.value as TransferQueueFilter)}
                >
                  <option value="all">All moves</option>
                  <option value="awaiting-approval">Waiting for approval</option>
                  {!simple ? <option value="ready-to-collect">Ready to collect</option> : null}
                  {!simple ? <option value="at-requesting-store">At requesting store</option> : null}
                  {!simple ? <option value="driver-needed">Driver needed</option> : null}
                  <option value="moving">In transit</option>
                  <option value="return-due">Returns to follow up</option>
                  {!simple ? <option value="sold-pending">Sold pending · not delivered</option> : null}
                  <option value="issues">Issues to review</option>
                  {managerFiltersAvailable ? <optgroup label="Manager views">
                    <option value="overdue-returns">Overdue returns</option>
                    <option value="location-exceptions">Location exceptions</option>
                  </optgroup> : null}
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
                {linkedHomeStore ? <button type="button" className="transfer-list-link-filter" aria-label={`Clear home store filter: ${linkedHomeStore}`} onClick={() => setLinkedHomeStore(null)}>Home store: {linkedHomeStore}<X aria-hidden="true" /></button> : null}
                {linkedRoute ? <button type="button" className="transfer-list-link-filter" aria-label={`Clear route filter: ${linkedRoute.from} to ${linkedRoute.to}, ${linkedRoute.leg}`} onClick={() => setLinkedRoute(null)}>Route: {linkedRoute.from} → {linkedRoute.to} · {linkedRoute.leg}<X aria-hidden="true" /></button> : null}
                <div className="transfer-list-count" aria-live="polite">{filteredDetails.length} {filteredDetails.length === 1 ? 'move' : 'moves'} shown</div>
              </div>
            </div>
            <div className="transfer-list-items">
              {filteredDetails.map(({ record, detail }) => {
                const isSelected = selected?.record.id === record.id
                const step = workflowStep(record.requestStatus)
                const simpleRecord = record.workflowMode === 'simple'
                const away = awayFromHomeSummary(record.homeStore, record.currentLocation, record.events, { destination: record.destination })
                const issueLabel = transferIssueLabel(detail)
                const nextStatus = statusFor({ record, detail })
                return (
                  <button
                    type="button"
                    key={record.id}
                    className={`transfer-list-item${isSelected ? ' is-selected' : ''}`}
                    onClick={() => navigate(movePath(`/transfers?id=${encodeURIComponent(record.id)}`))}
                    aria-current={isSelected ? 'true' : undefined}
                    aria-controls="transfer-detail-workspace"
                  >
                    <TransferListPhoto vehicle={detail.vehicle} />
                    <span className="transfer-list-copy transfer-list-copy--concise">
                      <span className="move-row-vehicle">
                        <span className="transfer-list-top"><strong>{detail.vehicle.vehicleLabel}</strong>{detail.priority === 'high' || detail.priority === 'critical' ? <b className={`priority-${detail.priority}`}>{detail.priority === 'critical' ? 'Urgent' : 'High priority'}</b> : null}</span>
                        <span className="move-row-stock">Stock {detail.vehicle.stock}</span>
                        <span className="move-row-vin">VIN {record.vin}</span>
                      </span>
                      <span className="move-row-route">
                        <span className="transfer-list-route">{detail.vehicle.homeStore} → {record.destination}</span>
                        <span className="transfer-location"><MapPin aria-hidden="true" />{record.currentLocation}</span>
                        {away.isAway ? <span>{away.label}</span> : null}
                      </span>
                      <span className="move-row-next">
                        <span className="transfer-list-stage">{simpleRecord ? compactRequestStatus(record.requestStatus, true) : `Step ${step} of 5 · ${compactRequestStatus(record.requestStatus)}`}</span>
                        <span className="transfer-next"><small>Next</small><strong>{compactNextAction(record.nextAction, { homeStore: record.homeStore, destination: record.destination })}</strong></span>
                        <span className="transfer-list-owner-row">{nextStatus.overdue && !isOwnOverdue(nextStatus) ? null : <span>{record.nextActionOwner || 'Responsible person not recorded'}</span>}<span className={DUE_TONE_CLASS[nextStatus.tone]}>{dueLabel(detail, nextStatus)}</span></span>
                        {issueLabel ? <span className="transfer-list-alert"><CircleAlert aria-hidden="true" />{issueLabel}</span> : record.returnRequired && away.isAway ? <span className="transfer-list-return">{returnTimingLabel(record)}</span> : null}
                      </span>
                      <span className="move-row-supporting" aria-label="Vehicle specifications">
                        <VehicleQuickFacts vehicle={data.vehicles.find(vehicle => vehicle.vin === record.vin)} />
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                )
              })}
              {filteredDetails.length === 0 ? <div className="transfer-list-no-results"><strong>{matchesOutsideView.length ? 'Matching moves are outside this view' : queueView === 'needs-action' ? 'No move updates assigned to you' : 'No moves match this view and search.'}</strong><p>{matchesOutsideView.length ? `${matchesOutsideView.length} matching ${matchesOutsideView.length === 1 ? 'move is' : 'moves are'} in another queue view or filter.` : queueView === 'needs-action' ? 'Active shows moves waiting on another person.' : storeScope === 'home' ? 'Try All stores, or reset search and queue filters.' : 'Reset the view to show active moves.'}</p><span className="transfer-list-no-results-actions">{matchesOutsideView.length ? <button type="button" onClick={revealSearchMatchesOutsideView}>Show matching moves</button> : null}{query || queueView !== 'active' || activeFilter !== 'all' || linkedHomeStore || linkedRoute ? <button type="button" onClick={() => { setQuery(''); setQueueView('active'); setQueueFilter('all'); setLinkedHomeStore(null); setLinkedRoute(null) }}>{WORKFLOW_RESET_LABELS.resetView}</button> : null}{storeScope === 'home' ? <button type="button" onClick={() => { setStoreScope('group'); setLinkedHomeStore(null) }}>{WORKFLOW_RESET_LABELS.viewAllStores}</button> : null}</span></div> : null}
            </div>
          </aside>
          <div className="transfer-detail-surface" id="transfer-detail-workspace">
            {(requestedId || requestedVin) && selected ? (
              <header className="transfer-mobile-detail-bar">
                <FlowIconButton size="md" variant="secondary" onClick={() => navigate(safeReturnTo)} label={workspaceReturnLabel(safeReturnTo, 'Back to vehicle moves')}><ArrowLeft aria-hidden="true" /></FlowIconButton>
                <span>
                  <h1>Vehicle move</h1>
                  <small>{selected.detail.vehicle.stock} · {selected.record.workflowMode === 'simple' ? compactRequestStatus(selected.record.requestStatus, true) : `Step ${workflowStep(selected.record.requestStatus)} of 5 · ${compactRequestStatus(selected.record.requestStatus)}`}</small>
                </span>
              </header>
            ) : null}
            <TransferDetailLoader key={accessContext} selected={selected} data={data} role={role} homeStore={homeStore} onAction={handleAction} returnTo={workspaceReturnPath} />
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
            navigate(withWorkspaceReturnPath(`/transfers?id=${encodeURIComponent(updated.id)}`, origin ?? undefined))
          }}
        />
      ) : null}
    </section>
  )
}
