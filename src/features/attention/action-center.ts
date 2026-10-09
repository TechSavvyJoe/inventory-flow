import type {
  AttentionInformationalReason,
  AttentionItem,
  BootstrapData,
  StoreName,
  UserRole,
} from '../../types'
import { serviceWorkflowStatus } from '../../lib/service-readiness'
import { ISSUE_CATEGORIES, issueNextStep } from '../issues/issue-model'

export type ActionCategory = 'all' | 'moves' | 'holds' | 'inventory' | 'service' | 'issues'

/** The signed-in store and role the queue is being read for. */
export interface ActionViewer {
  store: StoreName
  role: UserRole
}

/** One queue row: a vehicle's conditions collapsed into a single next step. */
export interface ActionRow {
  key: string
  lead: AttentionItem
  items: AttentionItem[]
  conditions: string[]
}

const TRANSPORT_TYPES = ['transfer_next_action', 'return_overdue', 'location_exception']
const HOLD_TYPES = ['past_expected_hold', 'hold_alert', 'vehicle_alert', 'hold_request']
// Conditions that describe group data rather than one store's next step.
const INFORMATIONAL_TYPES: Record<string, AttentionInformationalReason> = {
  source_freshness: 'source_health',
  missing_price: 'public_listing',
}

export const INFORMATIONAL_REASON_LABELS: Record<AttentionInformationalReason, string> = {
  source_health: 'Source health',
  public_listing: 'Website listing',
  other_store: "Another store's next step",
  role_scope: 'Handled by another role',
}

export function actionCategory(item: AttentionItem): Exclude<ActionCategory, 'all'> {
  if (item.type === 'vehicle_issue') return 'issues'
  if (item.type === 'service_pending') return 'service'
  if (TRANSPORT_TYPES.includes(item.type)) return 'moves'
  if (HOLD_TYPES.includes(item.type)) return 'holds'
  return 'inventory'
}

export function belongsToActionStore(item: AttentionItem, store: StoreName) {
  // A group-wide notice names no store; it stays visible in every scope.
  if (!item.store && !item.relatedStores?.length) return true
  return item.store === store || item.relatedStores?.includes(store) === true
}

/**
 * The server classifies every item it builds against the caller's own store and
 * role. This mirrors that rule for items the client assembles itself, and for a
 * payload published before the field existed.
 */
function classify(item: AttentionItem, viewer: ActionViewer): AttentionItem {
  if (item.actionability) return item
  if (Object.hasOwn(INFORMATIONAL_TYPES, item.type)) {
    return { ...item, actionability: 'informational', informationalReason: INFORMATIONAL_TYPES[item.type] }
  }
  const owningStore = item.actionStore ?? item.store
  if (!owningStore || owningStore !== viewer.store) {
    return { ...item, actionability: 'informational', informationalReason: 'other_store' }
  }
  const transportOnlyRole = viewer.role === 'driver' || viewer.role === 'porter'
  const managerOnlyType = item.type === 'manager_pending_identity_review'
  if ((transportOnlyRole && !TRANSPORT_TYPES.includes(item.type)) ||
      (managerOnlyType && viewer.role !== 'manager' && viewer.role !== 'group_manager')) {
    return { ...item, actionability: 'informational', informationalReason: 'role_scope' }
  }
  return { ...item, actionability: 'actionable', informationalReason: null }
}

export function isActionable(item: AttentionItem) {
  return item.actionability !== 'informational'
}

/**
 * Every condition the payload carries, classified for this viewer. Source
 * health is returned too, so the badge and the page read the same list; the
 * Action center page then leaves it to its own source notice rather than
 * listing it as a queue entry.
 */
export function actionCenterItems(data: BootstrapData, viewer: ActionViewer): AttentionItem[] {
  const items = data.attention.map(item => item.vin && item.href?.startsWith('/inventory')
    ? { ...item, href: `/inventory?scope=group&vin=${encodeURIComponent(item.vin)}${HOLD_TYPES.includes(item.type) ? '&tab=hold' : ''}` }
    : item)
  const serviceItems: AttentionItem[] = (data.vehicles ?? []).flatMap(vehicle => {
    const service = vehicle.serviceReadiness
    const normalizedStatus = serviceWorkflowStatus(service)
    if (normalizedStatus === 'serviced') return []
    // The ledger may temporarily omit its service-store association while a
    // vehicle is being reconciled. The vehicle's home store is still the
    // safest actionable owner; without this fallback, an open service task
    // silently disappears from every store's Action center.
    const serviceStore = service?.store ?? vehicle.homeStore
    // Only this vehicle's store manager may record a service status, so for
    // anyone else the task is something to know about, not something to do.
    const canManage = service?.canManage ?? (viewer.role === 'group_manager' || (viewer.role === 'manager' && serviceStore === viewer.store))
    const actionable = canManage && serviceStore === viewer.store
    return [{ id: `service-${vehicle.vin}`, type: 'service_pending', status: 'open', priority: 'normal', severity: 'info',
      label: normalizedStatus === 'in_service' ? 'Confirm service completion' : service ? 'Arrange service' : 'Review service status',
      vehicleName: vehicle.vehicleName, stockNumber: vehicle.stockNumber, vin: vehicle.vin,
      store: serviceStore, relatedStores: [serviceStore],
      actionability: actionable ? 'actionable' : 'informational',
      informationalReason: actionable ? null : serviceStore === viewer.store ? 'role_scope' : 'other_store',
      owner: `${serviceStore} manager`,
      whyItMatters: normalizedStatus === 'in_service' ? 'Service has started. Completion has not been recorded.' : service ? 'This vehicle is marked as waiting for service.' : 'Service has not been confirmed for this vehicle.',
      recommendedAction: normalizedStatus === 'in_service' ? 'Check progress and record completion when service is finished.' : 'Confirm whether service is needed, then record when work starts or mark the vehicle Ready.',
      href: `/service?vin=${encodeURIComponent(vehicle.vin)}`, allowedActions: [], events: [],
    } satisfies AttentionItem]
  })
  const issueItems: AttentionItem[] = (data.vehicleIssues ?? []).map(issue => {
    const local = issue.reportStore === viewer.store
    const manager = viewer.role === 'manager' || viewer.role === 'group_manager'
    const actionable = local && issue.allowedActions.length > 0 && (issue.status !== 'awaiting_review' || manager)
    return {
      id: `issue-${issue.id}`, type: 'vehicle_issue', status: issue.status === 'completed' ? 'resolved' : 'open',
      priority: issue.priority, severity: issue.priority === 'urgent' ? 'critical' : 'info',
      label: `${ISSUE_CATEGORIES[issue.category]} issue`, vehicleName: issue.vehicleName,
      stockNumber: issue.stockNumber, vin: issue.vin, store: issue.reportStore, relatedStores: [issue.reportStore],
      actionStore: issue.reportStore, actionability: actionable ? 'actionable' : 'informational',
      informationalReason: actionable ? null : local ? 'role_scope' : 'other_store',
      owner: issue.status === 'awaiting_review' ? `${issue.reportStore} manager` : issue.assignee || `${issue.reportStore} manager`,
      whyItMatters: issue.description, recommendedAction: issueNextStep(issue),
      href: `/attention?issue=${encodeURIComponent(issue.id)}`,
      // Issue updates use their versioned ledger; generic review actions must
      // never bypass manager completion or write to a derived attention item.
      allowedActions: [], events: [], lastUpdatedAt: issue.updatedAt,
    }
  })
  const holdRequests: AttentionItem[] = (data.vehicles ?? []).flatMap(vehicle => {
    const hold = vehicle.manualHold
    if (hold?.state !== 'requested') return []
    const store = hold.ownerStore ?? vehicle.homeStore
    const actionable = hold.canApprove === true
    return [{ id: `hold-request-${vehicle.vin}`, type: 'hold_request', status: 'open', priority: 'high', severity: 'info',
      label: 'Review hold request', vehicleName: vehicle.vehicleName, stockNumber: vehicle.stockNumber, vin: vehicle.vin,
      store, actionStore: store, relatedStores: [store], owner: `${store} manager`,
      actionability: actionable ? 'actionable' : 'informational', informationalReason: actionable ? null : store === viewer.store ? 'role_scope' : 'other_store',
      whyItMatters: 'A salesperson has requested a hold. Manager approval has not been recorded.',
      recommendedAction: 'Review the request and supporting source evidence, then approve or decline the hold.',
      href: `/inventory?scope=group&vin=${encodeURIComponent(vehicle.vin)}&tab=hold`, allowedActions: [], events: [],
      lastUpdatedAt: hold.updatedAt ?? undefined,
    } satisfies AttentionItem]
  })
  return [...items, ...serviceItems, ...issueItems, ...holdRequests].map(item => classify(item, viewer))
}

/**
 * Collapse repeat conditions for one vehicle into a single row. Four separate
 * lines for the same unit read as four jobs; the vehicle only needs picking up
 * once, so the row keeps the most urgent next step and names the rest.
 */
export function groupByVehicle(items: AttentionItem[]): ActionRow[] {
  const rows = new Map<string, ActionRow>()
  for (const item of items) {
    const key = item.vin ? `vin:${item.vin}` : `item:${item.id}`
    const existing = rows.get(key)
    if (!existing) {
      rows.set(key, { key, lead: item, items: [item], conditions: [taskTitle(item)] })
      continue
    }
    existing.items.push(item)
    const condition = taskTitle(item)
    if (!existing.conditions.includes(condition)) existing.conditions.push(condition)
  }
  return [...rows.values()]
}

export function openStoreActionCount(data: BootstrapData | null, viewer: ActionViewer): number {
  if (!data) return 0
  const open = actionCenterItems(data, viewer)
    .filter(item => item.status !== 'resolved' && isActionable(item) && belongsToActionStore(item, viewer.store))
  return groupByVehicle(open).length
}

export function taskTitle(item: AttentionItem) {
  if (item.type === 'transfer_next_action') {
    if (/leaves.*home store|collect|pick.?up/i.test(item.label)) return 'Record vehicle collection'
    if (/approval|approv|availability/i.test(item.label)) return 'Review the vehicle request'
    if (/confirm.*back home|home receipt|returned home/i.test(item.label)) return 'Confirm the vehicle is back home'
    if (/arriv/i.test(item.label)) return 'Confirm vehicle arrival'
  }
  const labels: Record<string, string> = {
    past_expected_hold: 'Follow up on the expected hold date', hold_alert: 'Review the hold alert',
    vehicle_alert: 'Review the vehicle alert', missing_price: 'Confirm the missing website price',
    location_exception: 'Confirm the vehicle location', return_overdue: 'Follow up on overdue returns',
    source_freshness: 'Check source health before promising a vehicle',
  }
  return labels[item.type] ?? item.label
}
export function taskDescription(item: AttentionItem) {
  if (item.type === 'hold_alert') return 'Read the hold alert and confirm the next step with the salesperson.'
  if (item.type === 'vehicle_alert') return 'Read the vehicle alert and confirm what needs to be done.'
  if (item.type === 'past_expected_hold') return 'The expected date has passed. Check with the salesperson before making a commitment.'
  if (item.type === 'location_exception') return 'Confirm where the vehicle is and update its move record.'
  if (item.type === 'missing_price') return 'Confirm pricing with the manager before quoting these vehicles.'
  return item.recommendedAction
}
export function taskLinkLabel(item: AttentionItem) {
  if (item.type === 'hold_request') return 'Review hold request'
  if (item.type === 'vehicle_issue') return `Open ${item.label.toLowerCase()}`
  if (item.type === 'vehicle_alert') return 'Review vehicle'
  const category = actionCategory(item)
  if (category === 'service') return 'Update service'
  if (category === 'moves') return 'Open move'
  if (category === 'holds') return 'Review hold'
  return 'Review inventory'
}
export function isTaskOverdue(item: AttentionItem, reportDate: string) {
  const due = item.followUpAt || item.dueAt
  return Boolean(due && due.slice(0, 10) < reportDate)
}
