import type { AttentionItem, BootstrapData, StoreName } from '../../types'
import { serviceWorkflowStatus } from '../../lib/service-readiness'

export type ActionCategory = 'all' | 'moves' | 'holds' | 'inventory' | 'service'
export function actionCategory(item: AttentionItem): Exclude<ActionCategory, 'all'> {
  if (item.type === 'service_pending') return 'service'
  if (['transfer_next_action', 'return_overdue', 'location_exception'].includes(item.type)) return 'moves'
  if (['past_expected_hold', 'hold_alert', 'vehicle_alert'].includes(item.type)) return 'holds'
  return 'inventory'
}
export function belongsToActionStore(item: AttentionItem, store: StoreName) {
  return item.store === store || item.relatedStores?.includes(store) === true
}
export function actionableItems(data: BootstrapData): AttentionItem[] {
  // Feed health belongs in update details, not the salesperson's work queue.
  const items = data.attention.filter(item => item.type !== 'source_freshness').map(item => item.vin && item.href?.startsWith('/inventory') ? { ...item, href: `/inventory?scope=group&vin=${encodeURIComponent(item.vin)}${['past_expected_hold', 'hold_alert', 'vehicle_alert'].includes(item.type) ? '&tab=hold' : ''}` } : item)
  const serviceItems: AttentionItem[] = (data.vehicles ?? []).flatMap(vehicle => {
    const service = vehicle.serviceReadiness
    const normalizedStatus = serviceWorkflowStatus(service)
    if (normalizedStatus === 'serviced') return []
    // The ledger may temporarily omit its service-store association while a
    // vehicle is being reconciled. The vehicle's home store is still the
    // safest actionable owner; without this fallback, an open service task
    // silently disappears from every store's Action center.
    const serviceStore = service?.store ?? vehicle.homeStore
    return [{ id: `service-${vehicle.vin}`, type: 'service_pending', status: 'open', priority: 'normal', severity: 'info',
      label: normalizedStatus === 'in_service' ? 'Confirm service completion' : service ? 'Arrange service' : 'Review service status',
      vehicleName: vehicle.vehicleName, stockNumber: vehicle.stockNumber, vin: vehicle.vin,
      store: serviceStore, relatedStores: [serviceStore],
      owner: `${serviceStore} manager`,
      whyItMatters: normalizedStatus === 'in_service' ? 'Service has started. Completion has not been recorded.' : service ? 'This vehicle is marked as waiting for service.' : 'Service has not been confirmed for this vehicle.',
      recommendedAction: normalizedStatus === 'in_service' ? 'Check progress and record completion when service is finished.' : 'Confirm whether service is needed, then record when work starts or mark the vehicle Ready.',
      href: `/service?vin=${encodeURIComponent(vehicle.vin)}`, allowedActions: [], events: [],
    } satisfies AttentionItem]
  })
  return [...items, ...serviceItems]
}
export function openStoreActionCount(data: BootstrapData | null, store: StoreName): number {
  return data ? actionableItems(data).filter(item => item.status !== 'resolved' && belongsToActionStore(item, store)).length : 0
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
