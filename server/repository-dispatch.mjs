/**
 * Storage boundary used by the synchronous presentation and workflow service.
 * Adapters preload their read model and persist planned mutations outside the core.
 * No runtime-specific database, filesystem, or network module belongs here.
 */
const REQUIRED_METHODS = Object.freeze([
  "appendTransferEvent",
  "getAttentionEvents",
  "getAttentionWorkflowRow",
  "getCurrentDataset",
  "getTransferEvents",
  "getTransferRow",
  "insertTransferRequest",
  "listAttentionWorkflowRows",
  "listTransferRows",
  "listServiceEvents",
  "insertServiceEvent",
  "dispositionsEnabled",
  "listDispositionEvents",
  "insertDispositionEvent",
  "vehicleIssuesEnabled",
  "listVehicleIssueRows",
  "listVehicleIssueEvents",
  "insertVehicleIssue",
  "appendVehicleIssueEvent",
  "supersedeTransferRequest",
  "upsertAttentionWorkflow"
])

export function createRepositoryContext(handle, repository) {
  if (!repository || REQUIRED_METHODS.some((name) => typeof repository[name] !== 'function')) {
    throw new TypeError('Inventory repository must implement every required synchronous storage method')
  }
  return Object.freeze({ handle, repository })
}

function invoke(context, method, args) {
  const result = context.repository[method](context.handle, ...args)
  if (result && typeof result.then === 'function') {
    throw new TypeError(`Inventory repository method ${method} must be synchronous; preload storage before creating the service`)
  }
  return result
}

function invokeOptional(context, method, args, fallback) {
  if (typeof context.repository[method] !== 'function') return fallback
  return invoke(context, method, args)
}

export function appendTransferEvent(context, ...args) {
  return invoke(context, 'appendTransferEvent', args)
}

export function getAttentionEvents(context, ...args) {
  return invoke(context, 'getAttentionEvents', args)
}

export function getAttentionWorkflowRow(context, ...args) {
  return invoke(context, 'getAttentionWorkflowRow', args)
}

export function getCurrentDataset(context, ...args) {
  return invoke(context, 'getCurrentDataset', args)
}

export function getTransferEvents(context, ...args) {
  return invoke(context, 'getTransferEvents', args)
}

export function getTransferRow(context, ...args) {
  return invoke(context, 'getTransferRow', args)
}

export function insertTransferRequest(context, ...args) {
  return invoke(context, 'insertTransferRequest', args)
}

export function supersedeTransferRequest(context, ...args) {
  return invoke(context, 'supersedeTransferRequest', args)
}

export function listAttentionWorkflowRows(context, ...args) {
  return invoke(context, 'listAttentionWorkflowRows', args)
}

export function listTransferRows(context, ...args) {
  return invoke(context, 'listTransferRows', args)
}

export function upsertAttentionWorkflow(context, ...args) {
  return invoke(context, 'upsertAttentionWorkflow', args)
}

export function listServiceEvents(context, ...args) {
  return invoke(context, 'listServiceEvents', args)
}

export function insertServiceEvent(context, ...args) {
  return invoke(context, 'insertServiceEvent', args)
}

export function dispositionsEnabled(context, ...args) {
  return invoke(context, 'dispositionsEnabled', args)
}

export function manualHoldApprovalsEnabled(context) { return invokeOptional(context, 'manualHoldApprovalsEnabled', [], false) }
export function manualHoldsEnabled(context) { return invokeOptional(context, 'manualHoldsEnabled', [], false) }
export function listManualHoldEvents(context) { return invokeOptional(context, 'listManualHoldEvents', [], []) }
export function insertManualHoldEvent(context, row) { return invoke(context, 'insertManualHoldEvent', [row]) }

export function listDispositionEvents(context, ...args) {
  return invoke(context, 'listDispositionEvents', args)
}

export function insertDispositionEvent(context, ...args) {
  return invoke(context, 'insertDispositionEvent', args)
}

export function vehicleIssuesEnabled(context, ...args) {
  return invoke(context, 'vehicleIssuesEnabled', args)
}

export function listVehicleIssueRows(context, ...args) {
  return invoke(context, 'listVehicleIssueRows', args)
}

export function listVehicleIssueEvents(context, ...args) {
  return invoke(context, 'listVehicleIssueEvents', args)
}

export function insertVehicleIssue(context, ...args) {
  return invoke(context, 'insertVehicleIssue', args)
}

export function appendVehicleIssueEvent(context, ...args) {
  return invoke(context, 'appendVehicleIssueEvent', args)
}

export function savedVehicleListsEnabled(context, ...args) {
  return invokeOptional(context, 'savedVehicleListsEnabled', args, false)
}

export function listSavedVehicleLists(context, ...args) {
  return invokeOptional(context, 'listSavedVehicleLists', args, [])
}

export function mutateSavedVehicleList(context, ...args) {
  return invoke(context, 'mutateSavedVehicleList', args)
}
