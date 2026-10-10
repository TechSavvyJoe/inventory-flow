import type { StoreName, UserRole } from '../types'

export interface AccessFailure {
  status: 401 | 403
  role: UserRole | null
  store: StoreName | null
  message: string
}

const accessListeners = new Set<(failure: AccessFailure) => void>()
const operationDenials = new WeakSet<Error>()
const bootstrapPreviewRequests = new WeakMap<AbortSignal, boolean>()

// Attach bootstrap intent to its cancellation lifetime, rather than a global
// identity setting that could leak across providers or superseded reads.
export function setBootstrapPreviewIntent(signal: AbortSignal, selected: boolean) { bootstrapPreviewRequests.set(signal, selected) }
export function bootstrapPreviewIntent(signal?: AbortSignal) { return signal ? bootstrapPreviewRequests.get(signal) ?? true : true }

// Only the API response classifier registers errors here. An unknown error
// body or a caller-created object cannot opt out of workspace invalidation.
export function markOperationDenial(error: Error) { operationDenials.add(error) }
export function isOperationDenial(error: unknown) { return error instanceof Error && operationDenials.has(error) }
let mutationRevision = 0
let accessGeneration = 0

export function apiAccessGeneration() {
  return accessGeneration
}

export function invalidateApiAccess() {
  accessGeneration += 1
}

// Session-only coordination. No request bodies, identity tokens, or records are
// persisted here. A read begun before a confirmed write cannot satisfy its refresh.
export function confirmedMutationRevision() {
  return mutationRevision
}

export function recordConfirmedMutation(requestGeneration = accessGeneration) {
  if (requestGeneration !== accessGeneration) return
  mutationRevision += 1
}

export function subscribeAccessFailures(listener: (failure: AccessFailure) => void) {
  accessListeners.add(listener)
  return () => { accessListeners.delete(listener) }
}

export function reportAccessFailure(failure: AccessFailure, requestGeneration = accessGeneration) {
  if (requestGeneration !== accessGeneration) return
  for (const listener of accessListeners) listener(failure)
}
