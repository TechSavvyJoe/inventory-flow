import type {
  AttentionEventInput,
  AttentionItem,
  BootstrapData,
  StoreName,
  TransferEventInput,
  TransferRecord,
  TransferRequestInput,
  UserRole,
  VehicleRecord,
  ServiceReadinessDetail,
  ServiceReadinessInput,
} from '../types'
import type { AdminOverview, MembershipDirectory, MembershipInput } from '../features/admin/types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type PendingMutation = {
  key: string
  inFlight: number
  confirmed: boolean
  lastUsed: number
}

type MutationRegistration = {
  consumers: number
  ready: Promise<{ signature: string, pending: PendingMutation }>
}

// Page-session only: the retry map retains digests, never request bodies,
// customer details, or identity headers. The short-lived registration map is
// discarded as soon as concurrent callers finish computing their digest.
const pendingMutations = new Map<string, PendingMutation>()
const mutationRegistrations = new Map<string, MutationRegistration>()
const MAX_PENDING_MUTATIONS = 128
const RETRY_WINDOW_MS = 30 * 60 * 1000
const SIGN_IN_MESSAGE = 'Your sign-in session has expired. Reload this page to sign in again.'

function mutationForSignature(signature: string) {
  const now = Date.now()
  for (const [id, pending] of pendingMutations) {
    if (!pending.inFlight && now - pending.lastUsed > RETRY_WINDOW_MS) pendingMutations.delete(id)
  }
  let pending = pendingMutations.get(signature)
  if (!pending) {
    if (pendingMutations.size >= MAX_PENDING_MUTATIONS) {
      const oldestIdle = [...pendingMutations.entries()]
        .filter(([, entry]) => !entry.inFlight)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]
      if (oldestIdle) pendingMutations.delete(oldestIdle[0])
      else throw new ApiError('Too many actions are still processing. Wait a moment and try again.', 429)
    }
    pending = { key: crypto.randomUUID(), inFlight: 0, confirmed: false, lastUsed: now }
    pendingMutations.set(signature, pending)
  }
  return { signature, pending }
}

async function beginMutation(path: string, body: RequestInit['body'], headers: Headers) {
  if (body != null && typeof body !== 'string') {
    throw new ApiError('This action must be sent as JSON.', 400)
  }
  const fingerprint = JSON.stringify([
    path,
    body ?? '',
    headers.get('x-inventory-demo-role'),
    headers.get('x-inventory-demo-store'),
    headers.get('x-inventory-demo-user'),
    headers.get('x-inventory-preview-role'),
  ])
  let registration = mutationRegistrations.get(fingerprint)
  if (!registration) {
    if (mutationRegistrations.size >= MAX_PENDING_MUTATIONS) {
      throw new ApiError('Too many actions are still processing. Wait a moment and try again.', 429)
    }
    registration = {
      consumers: 0,
      ready: crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)).then((digest) => {
        const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
        return mutationForSignature(signature)
      }),
    }
    mutationRegistrations.set(fingerprint, registration)
  }
  registration.consumers += 1
  try {
    const mutation = await registration.ready
    mutation.pending.inFlight += 1
    mutation.pending.lastUsed = Date.now()
    return mutation
  } finally {
    registration.consumers -= 1
    if (!registration.consumers) mutationRegistrations.delete(fingerprint)
  }
}

function isSignInResponse(response: Response) {
  if (!response.url) return false
  const url = new URL(response.url)
  return url.hostname.endsWith('.cloudflareaccess.com') || url.pathname.startsWith('/cdn-cgi/access/')
}

// A dealership network can stall a connection without ever failing it, which
// leaves `fetch` pending forever and the UI stuck loading with no recovery
// path. Compose the timeout with caller cancellation so changing vehicle or
// access context can end obsolete reads without waiting for the network.
const REQUEST_TIMEOUT_MS = 20_000
// The production bootstrap is intentionally rich and currently several MB.
// Keep the ordinary 20s deadline for reaching the server, but once its headers
// arrive allow a slower mobile connection enough time to finish that one large
// read. Mutations and every other request retain their existing total deadline.
const BOOTSTRAP_BODY_TIMEOUT_MS = 60_000

type RequestTiming = {
  bodyTimeoutMs?: number
}

async function request<T>(path: string, options: RequestInit = {}, timing: RequestTiming = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const mutation = options.method?.toUpperCase() === 'POST'
    ? await beginMutation(path, options.body, headers)
    : undefined
  if (mutation) headers.set('Idempotency-Key', mutation.pending.key)

  const timeoutController = new AbortController()
  let timeout = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal

  let confirmed = false
  try {
    let response: Response
    try {
      response = await fetch(path, { ...options, headers, signal })
    } catch (cause) {
      // A genuine network failure (offline, DNS, connection reset) propagates
      // unchanged, exactly as it did before this timeout existed — callers
      // and tests rely on seeing the browser's own rejection here. A timeout
      // is the one new case, and status 408 already flows through this
      // module's existing retry classification below, so it is treated as
      // retryable exactly like a server-reported request timeout.
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (options.signal?.aborted) throw cause
        throw new ApiError('The request timed out before the server responded. Try again.', 408)
      }
      throw cause
    }
    if (timing.bodyTimeoutMs != null) {
      clearTimeout(timeout)
      timeout = setTimeout(() => timeoutController.abort(), timing.bodyTimeoutMs)
    }
    const isJson = /^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    const isSignIn = isSignInResponse(response)
    if (response.status === 401 || isSignIn || (response.ok && !isJson)) {
      confirmed = response.status === 401 || isSignIn
      throw new ApiError(SIGN_IN_MESSAGE, 401)
    }
    if (!response.ok) {
      confirmed = response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status)
      const payload = isJson ? await response.json().catch(() => null) : null
      const message = typeof payload?.error === 'string' ? payload.error : response.statusText || 'Request failed'
      throw new ApiError(message, response.status)
    }
    let payload: T
    try {
      payload = await response.json() as T
    } catch (cause) {
      // `fetch()` resolves as soon as response headers arrive, while
      // `response.json()` continues consuming the body with the same signal.
      // Preserve intentional caller cancellation, and classify our own alarm
      // as a retryable timeout instead of falsely reporting valid JSON as bad.
      if (options.signal?.aborted) throw cause
      if (timeoutController.signal.aborted) {
        throw new ApiError('The server response took too long to finish. Try again.', 408)
      }
      // The action may have succeeded even if its response was interrupted.
      throw new ApiError('The server response could not be read. Please try again.', 502)
    }
    confirmed = true
    return payload
  } finally {
    clearTimeout(timeout)
    if (mutation) {
      mutation.pending.inFlight -= 1
      mutation.pending.confirmed ||= confirmed
      mutation.pending.lastUsed = Date.now()
      // Keep the shared key until all concurrent copies of an action finish.
      if (mutation.pending.confirmed && !mutation.pending.inFlight) pendingMutations.delete(mutation.signature)
    }
  }
}

function demoIdentityHeaders(role: UserRole, store: StoreName): Record<string, string> {
  return {
    'x-inventory-demo-role': role,
    // Production honors this only for a server-authenticated group manager.
    'x-inventory-preview-role': role,
    'x-inventory-demo-store': store,
    'x-inventory-demo-user': import.meta.env.VITE_DEMO_USER_NAME || 'Joe Gallant',
  }
}

export function getBootstrap(homeStore: StoreName, role: UserRole): Promise<BootstrapData> {
  const params = new URLSearchParams({ homeStore, role })
  return request<BootstrapData>(
    `/api/bootstrap?${params}`,
    { headers: demoIdentityHeaders(role, homeStore) },
    { bodyTimeoutMs: BOOTSTRAP_BODY_TIMEOUT_MS },
  )
}

export function getVehicle(vin: string, role: UserRole, store: StoreName): Promise<VehicleRecord> {
  return request<VehicleRecord>(`/api/vehicles/${encodeURIComponent(vin)}`, {
    headers: demoIdentityHeaders(role, store),
  })
}

/**
 * Group-manager-only, read-only Control Center projection. Authorization is
 * enforced by the API; the role/store headers preserve the local demo's
 * existing identity contract while the production Access layer supplies the
 * authenticated membership context.
 */
export function getAdminOverview(role: UserRole, store: StoreName, signal?: AbortSignal): Promise<AdminOverview> {
  return request<AdminOverview>('/api/admin/overview', {
    headers: demoIdentityHeaders(role, store),
    signal,
  })
}

export function getMembershipDirectory(role: UserRole, store: StoreName, signal?: AbortSignal): Promise<MembershipDirectory> {
  return request('/api/admin/members', { headers: demoIdentityHeaders(role, store), signal })
}

export function saveMembershipAccess(input: MembershipInput, role: UserRole, store: StoreName): Promise<{ saved: boolean; id: string }> {
  return request('/api/admin/members', { method: 'POST', headers: demoIdentityHeaders(role, store), body: JSON.stringify(input) })
}

export function getServiceReadiness(vin: string, role: UserRole, store: StoreName): Promise<ServiceReadinessDetail> {
  return request<ServiceReadinessDetail>(`/api/vehicles/${encodeURIComponent(vin)}/service`, {
    headers: demoIdentityHeaders(role, store),
  })
}

export function updateServiceReadiness(vin: string, input: ServiceReadinessInput, role: UserRole, store: StoreName): Promise<ServiceReadinessDetail> {
  return request<ServiceReadinessDetail>(`/api/vehicles/${encodeURIComponent(vin)}/service`, {
    method: 'POST', headers: demoIdentityHeaders(role, store), body: JSON.stringify(input),
  })
}

export function createTransfer(input: TransferRequestInput, role: UserRole, store: StoreName): Promise<TransferRecord> {
  const { requestedBy: _requestedBy, requestingStore: _requestingStore, ...requestInput } = input
  return request<TransferRecord>('/api/transfers', {
    method: 'POST',
    headers: demoIdentityHeaders(role, store),
    body: JSON.stringify(requestInput),
  })
}

export function getTransfer(transferId: string, role: UserRole, store: StoreName, signal?: AbortSignal): Promise<TransferRecord> {
  return request<TransferRecord>(`/api/transfers/${encodeURIComponent(transferId)}`, {
    headers: demoIdentityHeaders(role, store),
    signal,
  })
}

export function appendTransferEvent(
  transferId: string,
  input: TransferEventInput,
  role: UserRole,
  store: StoreName,
): Promise<TransferRecord> {
  const { actor: _actor, actorRole: _actorRole, store: _store, ...eventInput } = input
  return request<TransferRecord>(`/api/transfers/${encodeURIComponent(transferId)}/events`, {
    method: 'POST',
    headers: demoIdentityHeaders(role, store),
    body: JSON.stringify(eventInput),
  })
}

export function appendAttentionEvent(
  attentionId: string,
  input: AttentionEventInput,
  role: UserRole,
  store: StoreName,
): Promise<AttentionItem> {
  const { actor: _actor, actorRole: _actorRole, store: _store, ...eventInput } = input
  return request<AttentionItem>(`/api/attention/${encodeURIComponent(attentionId)}/events`, {
    method: 'POST',
    headers: demoIdentityHeaders(role, store),
    body: JSON.stringify(eventInput),
  })
}
