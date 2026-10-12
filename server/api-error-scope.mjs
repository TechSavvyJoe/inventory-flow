import { WorkflowError } from './workflow.mjs'

// Minted only by the employee API after identity resolution. Positive domain
// codes keep new/unknown access failures fail-closed, including membership
// revocation and saved-list owner changes. Never infer this scope in a client
// from an error body's code or message.
const OPERATION_DENIALS = new Set([
  'FORBIDDEN', 'WRONG_STORE_ROLE', 'STORE_MISMATCH', 'ACTOR_MISMATCH', 'ROLE_MISMATCH',
  'ADMIN_OVERVIEW_ACCESS_REQUIRED', 'SERVICE_MANAGER_REQUIRED',
  'ISSUE_REPORTER_REQUIRED', 'ISSUE_STORE_FORBIDDEN', 'ISSUE_MANAGER_REQUIRED',
  'DISPOSITION_MANAGER_REQUIRED', 'MANUAL_HOLD_ACCESS_DENIED', 'MANUAL_HOLD_APPROVAL_REQUIRED',
])

export function isOperationDenial(error) {
  return error instanceof WorkflowError && error.status === 403 && OPERATION_DENIALS.has(error.code)
}
