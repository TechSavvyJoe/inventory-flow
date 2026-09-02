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

export function listAttentionWorkflowRows(context, ...args) {
  return invoke(context, 'listAttentionWorkflowRows', args)
}

export function listTransferRows(context, ...args) {
  return invoke(context, 'listTransferRows', args)
}

export function upsertAttentionWorkflow(context, ...args) {
  return invoke(context, 'upsertAttentionWorkflow', args)
}
