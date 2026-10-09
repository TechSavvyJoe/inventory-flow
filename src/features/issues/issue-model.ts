import type { StoreName, UserRole, VehicleIssue, VehicleIssueAction, VehicleIssueCategory, VehicleIssueStatus } from '../../types'
import type { InventoryVehicle } from '../inventory/types'

export interface VehicleIssueContext {
  role: UserRole
  homeStore: StoreName
  currentUser: string
  enabled: boolean
  issues: VehicleIssue[]
  onChanged: () => Promise<void>
}

export const ISSUE_CATEGORIES: Record<VehicleIssueCategory, string> = {
  cleaning: 'Cleaning', fuel: 'Fuel', mechanical: 'Mechanical', damage: 'Damage', other: 'Other',
}
export const ISSUE_STATUSES: Record<VehicleIssueStatus, string> = {
  open: 'Open', in_progress: 'In progress', awaiting_review: 'Awaiting manager review', completed: 'Completed',
}
export const ISSUE_ACTIONS: Record<VehicleIssueAction, string> = {
  assign: 'Assign', start_work: 'Start work', request_completion: 'Send for manager review',
  complete: 'Confirm completion', reopen: 'Reopen issue', add_note: 'Add update',
}

export function canReportVehicleIssue(vehicle: InventoryVehicle, context: VehicleIssueContext) {
  if (!context.enabled) return false
  if (vehicle.canReportIssue !== undefined) return vehicle.canReportIssue
  if (context.role === 'group_manager') return true
  return (context.role === 'manager' || context.role === 'sales') &&
    (vehicle.location.homeStore.name === context.homeStore || vehicle.location.appConfirmedStore?.name === context.homeStore)
}

export function issueNextStep(issue: VehicleIssue) {
  if (issue.status === 'completed') return 'Manager confirmed completion.'
  if (issue.status === 'awaiting_review') return 'A manager needs to check the work and confirm completion.'
  if (issue.status === 'in_progress') return 'Record progress, then send the finished work for manager review.'
  return issue.assignee ? 'Start work and record progress.' : 'Assign someone to check and address this issue.'
}

export function issueNextAction(issue: VehicleIssue): VehicleIssueAction | null {
  const allowed = new Set(issue.allowedActions)
  if (issue.status === 'awaiting_review' && allowed.has('complete')) return 'complete'
  if (issue.status === 'completed') return null
  const preferred: VehicleIssueAction[] = issue.status === 'open' && !issue.assignee
    ? ['assign', 'add_note', 'request_completion']
    : issue.status === 'open'
      ? ['start_work', 'add_note', 'request_completion']
      : ['add_note', 'request_completion']
  return preferred.find(action => allowed.has(action)) ?? null
}
