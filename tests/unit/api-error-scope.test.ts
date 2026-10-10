// PRODUCT-RULE TEST
// @vitest-environment node
// @ts-nocheck -- shared Node/Worker ESM response classifier.
import { describe, expect, it } from 'vitest'
import { isOperationDenial } from '../../server/api-error-scope.mjs'
import { WorkflowError } from '../../server/workflow.mjs'
import { IdentityError } from '../../server/identity.mjs'
import { AccessError } from '../../cloudflare/src/access.mjs'

describe('server-authoritative operation-error response scope', () => {
  it.each(['FORBIDDEN', 'WRONG_STORE_ROLE', 'STORE_MISMATCH', 'ACTOR_MISMATCH', 'ROLE_MISMATCH', 'ADMIN_OVERVIEW_ACCESS_REQUIRED', 'SERVICE_MANAGER_REQUIRED', 'ISSUE_REPORTER_REQUIRED', 'ISSUE_STORE_FORBIDDEN', 'ISSUE_MANAGER_REQUIRED', 'DISPOSITION_MANAGER_REQUIRED', 'MANUAL_HOLD_ACCESS_DENIED', 'MANUAL_HOLD_APPROVAL_REQUIRED'])('allows only a known domain WorkflowError 403 (%s)', code => {
    expect(isOperationDenial(new WorkflowError('Synthetic operation refused', { code, status: 403 }))).toBe(true)
    expect(isOperationDenial(new WorkflowError('Synthetic invalid operation', { code, status: 401 }))).toBe(false)
    expect(isOperationDenial({ code, status: 403 })).toBe(false)
    expect(isOperationDenial(new AccessError(code, 403))).toBe(false)
    expect(isOperationDenial(new IdentityError('Synthetic identity denied', { code, status: 403 }))).toBe(false)
  })
  it.each(['UNKNOWN', 'AUTH_CONTEXT_INVALID', 'ACCESS_CONTEXT_CHANGED', 'ADMIN_ACCESS_CHANGED', 'EMPLOYEE_NOT_AUTHORIZED', 'PRIVATE_HOST_REQUIRED', 'TENANT_ACCESS_SUSPENDED'])('fails closed for identity/access or unknown codes even in a WorkflowError (%s)', code => {
    expect(isOperationDenial(new WorkflowError('Synthetic access denied', { code, status: 403 }))).toBe(false)
  })
})
