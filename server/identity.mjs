import { timingSafeEqual } from 'node:crypto'
import { STORE_NAMES } from './importer.mjs'
import { USER_ROLES } from './workflow.mjs'

export const IDENTITY_MODES = Object.freeze({
  DEMO: 'demo',
  TRUSTED_PROXY: 'trusted_proxy',
})

const TRUSTED_PROXY_SECRET_HEADER = 'x-inventory-proxy-secret'
const TRUSTED_USER_HEADER = 'x-inventory-authenticated-user'
const TRUSTED_ROLE_HEADER = 'x-inventory-authenticated-role'
const TRUSTED_STORE_HEADER = 'x-inventory-authenticated-store'
const MINIMUM_PROXY_SECRET_LENGTH = 32

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

function validatedContext({ user, role, store }) {
  const normalizedUser = requiredIdentityValue(user, 'user')
  const normalizedRole = requiredIdentityValue(role, 'role', 40)
  const normalizedStore = requiredIdentityValue(store, 'store', 40)
  if (!USER_ROLES.includes(normalizedRole)) {
    throw new IdentityError('Authenticated role is not authorized for Inventory Flow', {
      status: 403,
      code: 'ROLE_NOT_AUTHORIZED',
    })
  }
  if (!STORE_NAMES.includes(normalizedStore)) {
    throw new IdentityError('Authenticated store is not authorized for Inventory Flow', {
      status: 403,
      code: 'STORE_NOT_AUTHORIZED',
    })
  }
  return { user: normalizedUser, role: normalizedRole, store: normalizedStore }
}

function secretsMatch(provided, expected) {
  const providedBuffer = Buffer.from(String(provided ?? ''), 'utf8')
  const expectedBuffer = Buffer.from(String(expected ?? ''), 'utf8')
  if (providedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(providedBuffer, expectedBuffer)
}

function demoContext(request, url, { allowQuery = false } = {}) {
  return validatedContext({
    user: headerValue(request, 'x-inventory-demo-user') || headerValue(request, 'x-inventory-user') || 'Local prototype user',
    role:
      headerValue(request, 'x-inventory-demo-role') ||
      headerValue(request, 'x-inventory-role') ||
      (allowQuery ? url.searchParams.get('role') : ''),
    store:
      headerValue(request, 'x-inventory-demo-store') ||
      headerValue(request, 'x-inventory-store') ||
      (allowQuery ? url.searchParams.get('homeStore') || url.searchParams.get('store') : ''),
  })
}

function trustedProxyContext(request, trustedProxySecret) {
  if (!secretsMatch(headerValue(request, TRUSTED_PROXY_SECRET_HEADER), trustedProxySecret)) {
    throw new IdentityError('A trusted authenticated upstream is required', {
      code: 'AUTHENTICATION_REQUIRED',
    })
  }
  return validatedContext({
    user: headerValue(request, TRUSTED_USER_HEADER),
    role: headerValue(request, TRUSTED_ROLE_HEADER),
    store: headerValue(request, TRUSTED_STORE_HEADER),
  })
}

export function createIdentityResolver({
  mode = process.env.INVENTORY_OPS_IDENTITY_MODE,
  environment = process.env.NODE_ENV || 'development',
  trustedProxySecret = process.env.INVENTORY_OPS_TRUSTED_PROXY_SECRET,
} = {}) {
  const production = environment === 'production'
  const selectedMode = String(mode || (production ? '' : IDENTITY_MODES.DEMO)).trim().toLowerCase()

  if (!selectedMode) {
    throw new IdentityConfigurationError(
      'Production startup requires INVENTORY_OPS_IDENTITY_MODE=trusted_proxy',
      'IDENTITY_MODE_REQUIRED',
    )
  }
  if (selectedMode === IDENTITY_MODES.DEMO) {
    if (production) {
      throw new IdentityConfigurationError(
        'Demo identity is disabled in production; configure a trusted authenticated upstream',
        'INSECURE_IDENTITY_MODE',
      )
    }
    return Object.freeze({
      mode: selectedMode,
      resolve: (request, url, options) => demoContext(request, url, options),
    })
  }
  if (selectedMode === IDENTITY_MODES.TRUSTED_PROXY) {
    const secret = String(trustedProxySecret ?? '')
    if (secret.length < MINIMUM_PROXY_SECRET_LENGTH) {
      throw new IdentityConfigurationError(
        `INVENTORY_OPS_TRUSTED_PROXY_SECRET must contain at least ${MINIMUM_PROXY_SECRET_LENGTH} characters`,
        'TRUSTED_PROXY_SECRET_REQUIRED',
      )
    }
    return Object.freeze({
      mode: selectedMode,
      resolve: (request) => trustedProxyContext(request, secret),
    })
  }
  throw new IdentityConfigurationError(
    `Unsupported Inventory Flow identity mode: ${selectedMode}`,
    'IDENTITY_MODE_UNSUPPORTED',
  )
}

export const identityInternals = Object.freeze({
  MINIMUM_PROXY_SECRET_LENGTH,
  TRUSTED_PROXY_SECRET_HEADER,
  TRUSTED_ROLE_HEADER,
  TRUSTED_STORE_HEADER,
  TRUSTED_USER_HEADER,
  secretsMatch,
  validatedContext,
})
