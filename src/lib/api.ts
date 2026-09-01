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
} from '../types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }))
    throw new ApiError(payload.error ?? 'Request failed', response.status)
  }

  return response.json() as Promise<T>
}

function demoIdentityHeaders(role: UserRole, store: StoreName): Record<string, string> {
  return {
    'x-inventory-demo-role': role,
    'x-inventory-demo-store': store,
    'x-inventory-demo-user': import.meta.env.VITE_DEMO_USER_NAME || 'Joe Gallant',
  }
}

export function getBootstrap(homeStore: StoreName, role: UserRole): Promise<BootstrapData> {
  const params = new URLSearchParams({ homeStore, role })
  return request<BootstrapData>(`/api/bootstrap?${params}`, { headers: demoIdentityHeaders(role, homeStore) })
}

export function getVehicle(vin: string, role: UserRole, store: StoreName): Promise<VehicleRecord> {
  return request<VehicleRecord>(`/api/vehicles/${encodeURIComponent(vin)}`, {
    headers: demoIdentityHeaders(role, store),
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

export function getTransfer(transferId: string, role: UserRole, store: StoreName): Promise<TransferRecord> {
  return request<TransferRecord>(`/api/transfers/${encodeURIComponent(transferId)}`, {
    headers: demoIdentityHeaders(role, store),
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
