import type { StoreName, UserRole } from '../types'

export interface AccessFailure {
  status: 401 | 403
  role: UserRole | null
  store: StoreName | null
  message: string
}

const accessListeners = new Set<(failure: AccessFailure) => void>()
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
