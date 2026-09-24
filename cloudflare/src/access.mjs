import { createRemoteJWKSet, jwtVerify } from 'jose'

const ACCESS_MESSAGES = {"ACCESS_AUTHENTICATION_REQUIRED":"Please sign in to access this application.","ACCESS_NOT_CONFIGURED":"The authentication service is currently unavailable.","ACCESS_TOKEN_INVALID":"Your session has expired or is invalid. Please sign in again.","EMPLOYEE_ACCESS_REQUIRED":"You must sign in with a valid employee account.","EMPLOYEE_NOT_AUTHORIZED":"You do not have access to the Inventory Flow app.","INVALID_PREVIEW_ROLE":"The requested preview role is not permitted.","INVALID_PREVIEW_STORE":"The requested preview store is not permitted.","SAME_ORIGIN_REQUIRED":"Cross-origin requests are not permitted.","PUBLISHER_IDENTITY_REQUIRED":"The publisher identity is required.","PUBLISHER_AUTHENTICATION_REQUIRED":"Publisher authentication is required.","PRIVATE_HOST_REQUIRED":"This application must be accessed through its private hostname.","INVOICE_ACCESS_REQUIRED":"You do not have permission to view factory invoices.","JSON_CONTENT_REQUIRED":"The request body must be JSON.","BODY_TOO_LARGE":"The request payload is too large.","EMPTY_BODY":"The request payload is empty.","INVALID_JSON":"The request payload is not valid JSON.","INVALID_ENCRYPTED_CONTENT":"The encrypted content is invalid.","INVALID_PATH":"The request path is invalid.","INVALID_INVOICE_PATH":"The invoice request path is invalid.","PDF_CONTENT_REQUIRED":"The uploaded document must be a PDF.","INVOICE_NOT_IN_CURRENT_RELEASE":"This invoice does not belong to the current release.","INVALID_PDF":"The uploaded file is not a valid PDF document.","INVOICE_ARTIFACT_UNAVAILABLE":"The invoice document is currently unavailable.","INVOICE_NOT_CAPTURED":"No invoice was captured for this vehicle.","ASSIGNEE_IDENTITY_CLIENT_CONTROLLED":"The assignee identity cannot be client-controlled.","ASSIGNEE_REQUIRED":"An assignee name is required.","ASSIGNEE_DIRECTORY_UNAVAILABLE":"The employee directory is currently unavailable.","ASSIGNEE_NOT_AUTHORIZED":"The selected employee is not authorized for this assignment.","ASSIGNEE_NAME_AMBIGUOUS":"The assignee name matches multiple employees.","ADMIN_DIRECTORY_UNAVAILABLE":"The employee directory is currently unavailable.","INVALID_ENVELOPE":"The release envelope is invalid.","RELEASE_KEY_NOT_CONFIGURED":"The release encryption key is not configured.","INVALID_OR_INCOMPLETE_RELEASE":"The release data is invalid or incomplete.","OLDER_RELEASE_REJECTED":"This release is older than the currently active release.","CURRENT_RELEASE_METADATA_INVALID":"The current release metadata is invalid.","INVENTORY_NOT_IMPORTED":"No inventory data has been imported yet.","RELEASE_ARTIFACT_UNAVAILABLE":"The release data is currently unavailable.","INVALID_EQUIPMENT_DOCUMENT":"The equipment document details are invalid.","EQUIPMENT_DOCUMENT_CONFLICT":"The equipment document conflicts with an existing one.","EQUIPMENT_PDF_NOT_CAPTURED":"No equipment PDF was captured for this vehicle.","EQUIPMENT_PDF_UNAVAILABLE":"The equipment PDF is currently unavailable.","DATABASE_NOT_CONFIGURED":"The application database is not fully configured.","PUBLISH_CONFLICT_RETRY":"A conflict occurred while publishing. Please try again.","METHOD_NOT_ALLOWED":"This method is not allowed for this route.","NOT_FOUND":"The requested resource was not found.","IDEMPOTENCY_KEY_REQUIRED":"An idempotency key is required for this action.","REPOSITORY_CONFLICT":"A conflict occurred while saving changes. Please try again."};
export class AccessError extends Error {
  constructor(code = 'ACCESS_AUTHENTICATION_REQUIRED', status = 401) { super(code); this.code = code; this.status = status; this.humanMessage = ACCESS_MESSAGES[code] || 'Access denied.'; }
}

// Decrypted evidence lives in module scope (releaseCache). Decrypt, hash and validation run once per isolate per bundle hash.
const keySets = new Map()
export async function verifyAccess(request, env, audience = env.ACCESS_AUDIENCE) {
  const issuer = env.ACCESS_ISSUER
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer ?? '') || !audience) {
    throw new AccessError('ACCESS_NOT_CONFIGURED', 503)
  }
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token || token.length > 16384) throw new AccessError()
  let keys = keySets.get(issuer)
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 300000 })
    keySets.set(issuer, keys)
  }
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience, algorithms: ['RS256'],
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub'], clockTolerance: 5,
    })
    return payload
  } catch { throw new AccessError('ACCESS_TOKEN_INVALID') }
}

export async function memberContext(claims, env, request) {
  if (typeof claims.email !== 'string' || !claims.email || claims.common_name) throw new AccessError('EMPLOYEE_ACCESS_REQUIRED',403)
  const row = await env.INVENTORY_DB.prepare(`
    SELECT member.user_id, member.name, member.role, member.home_store,
      (SELECT COUNT(*) FROM cloud_memberships AS candidate
         WHERE candidate.enabled = 1
         AND candidate.role IN ('porter', 'driver')
         AND candidate.name = member.name COLLATE BINARY) AS transport_name_matches
    FROM cloud_memberships AS member
    WHERE member.email = ? AND member.enabled = 1
  `).bind(claims.email.toLowerCase()).first()
  const roles = ['sales','manager','group_manager','coordinator','porter','driver']
  const stores = ['Howell','Fowlerville','Ford Detroit','Lincoln']
  const validIdentity = (value) => typeof value === 'string' && value.trim() && value === value.trim() && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
  const legacyTransportName = (value) => /^[\x20-\x7e]+$/.test(value)
  if (!row || !roles.includes(row.role) || !stores.includes(row.home_store) || !validIdentity(row.name) || !validIdentity(row.user_id)) {
    throw new AccessError('EMPLOYEE_NOT_AUTHORIZED',403)
  }
  // Preview context is available only after a freshly verified group-manager
  // membership. Neither JWT role claims nor browser headers grant authority.
  const canPreviewRoles = row.role === 'group_manager'
  const canPreviewStores = row.role === 'group_manager'
  const previewRole = canPreviewRoles ? request?.headers.get('x-inventory-preview-role') : null
  const previewStore = canPreviewStores ? request?.headers.get('x-inventory-preview-store') : null
  if (previewRole && !roles.includes(previewRole)) throw new AccessError('INVALID_PREVIEW_ROLE', 400)
  if (previewStore && !stores.includes(previewStore)) throw new AccessError('INVALID_PREVIEW_STORE', 400)
  const effectiveRole = previewRole || row.role
  const effectiveStore = previewStore || row.home_store
  return {
    role: effectiveRole,
    authenticatedRole: row.role,
    rolePreviewActive: effectiveRole !== row.role,
    store: effectiveStore,
    authenticatedStore: row.home_store,
    storePreviewActive: effectiveStore !== row.home_store,
    user: row.name,
    userId: row.user_id,
    allowLegacyTransportAssignmentByName:
      ['porter', 'driver'].includes(row.role) &&
      legacyTransportName(row.name) &&
      Number(row.transport_name_matches) === 1,
    authenticated: true,
    canPreviewRoles,
    canPreviewStores,
  }
}
