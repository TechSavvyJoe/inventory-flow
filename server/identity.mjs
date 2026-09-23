import { STORE_NAMES } from './constants.mjs'
import { USER_ROLES } from './workflow.mjs'

// The Node server hosts only the synthetic demo. Production identity is
// resolved by the Cloudflare Worker from Cloudflare Access and D1 memberships
// (docs/ADR-001-SERVER-OWNED-IDENTITY.md); this module has no production mode.

export class IdentityError extends Error {
  constructor(message, { status = 401, code = 'AUTHENTICATION_REQUIRED', details } = {}) {
    super(message)
    this.name = 'IdentityError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export class IdentityConfigurationError extends Error {
  constructor(message, code = 'IDENTITY_CONFIGURATION_ERROR') {
    super(message)
    this.name = 'IdentityConfigurationError'
    this.code = code
  }
}

function headerValue(request, name) {
  const raw = request.headers[name]
  if (Array.isArray(raw)) return raw[0] ?? ''
  return String(raw ?? '')
}

function requiredIdentityValue(value, field, maxLength = 160) {
  const text = String(value ?? '').trim()
  if (!text) {
    throw new IdentityError(`Authenticated ${field} is missing`, {
      code: 'IDENTITY_INCOMPLETE',
      details: { field },
    })
  }
  if (text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new IdentityError(`Authenticated ${field} is invalid`, {
      status: 403,
      code: 'IDENTITY_INVALID',
      details: { field },
    })
  }
  return text
}

// Demo role/store values are preview choices, not authentication.
function demoContext(request, url, { allowQuery = false } = {}) {
  const user = requiredIdentityValue(
    headerValue(request, 'x-inventory-demo-user') || headerValue(request, 'x-inventory-user') || 'Local prototype user',
    'user',
  )
  const role = requiredIdentityValue(
    headerValue(request, 'x-inventory-demo-role') ||
      headerValue(request, 'x-inventory-role') ||
      (allowQuery ? url.searchParams.get('role') : ''),
    'role',
    40,
  )
  const store = requiredIdentityValue(
    headerValue(request, 'x-inventory-demo-store') ||
      headerValue(request, 'x-inventory-store') ||
      (allowQuery ? url.searchParams.get('homeStore') || url.searchParams.get('store') : ''),
    'store',
    40,
  )
  if (!USER_ROLES.includes(role)) {
    throw new IdentityError('Authenticated role is not authorized for Inventory Flow', {
      status: 403,
      code: 'ROLE_NOT_AUTHORIZED',
    })
  }
  if (!STORE_NAMES.includes(store)) {
    throw new IdentityError('Authenticated store is not authorized for Inventory Flow', {
      status: 403,
      code: 'STORE_NOT_AUTHORIZED',
    })
  }
  return { user, userId: null, role, store, allowLegacyTransportAssignmentByName: true }
}

const DEMO_IDENTITY_RESOLVER = Object.freeze({
  mode: 'demo',
  resolve: (request, url, options) => demoContext(request, url, options),
})

export function createIdentityResolver({ environment = process.env.NODE_ENV || 'development' } = {}) {
  if (environment === 'production') {
    throw new IdentityConfigurationError(
      'The Node server is synthetic-demo only; production runs on the Cloudflare Worker',
      'NODE_SERVER_DEMO_ONLY',
    )
  }
  return DEMO_IDENTITY_RESOLVER
}
