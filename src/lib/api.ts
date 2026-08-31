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

export function getBootstrap(homeStore: StoreName, role: UserRole): Promise<BootstrapData> {
  const params = new URLSearchParams({ homeStore, role })
  return request<BootstrapData>(`/api/bootstrap?${params}`)
}

export function getVehicle(vin: string, role: UserRole, store: StoreName): Promise<VehicleRecord> {
  return request<VehicleRecord>(`/api/vehicles/${encodeURIComponent(vin)}`, {
    headers: { 'x-inventory-role': role, 'x-inventory-store': store, 'x-inventory-user': 'Joe Gallant' },
  })
}

export function createTransfer(input: TransferRequestInput, role: UserRole, store: StoreName): Promise<TransferRecord> {
  return request<TransferRecord>('/api/transfers', {
    method: 'POST',
    headers: { 'x-inventory-role': role, 'x-inventory-store': store, 'x-inventory-user': 'Joe Gallant' },
    body: JSON.stringify(input),
  })
}

export function getTransfer(transferId: string, role: UserRole, store: StoreName): Promise<TransferRecord> {
  return request<TransferRecord>(`/api/transfers/${encodeURIComponent(transferId)}`, {
    headers: { 'x-inventory-role': role, 'x-inventory-store': store, 'x-inventory-user': 'Joe Gallant' },
  })
}

export function appendTransferEvent(
  transferId: string,
  input: TransferEventInput,
  role: UserRole,
  store: StoreName,
): Promise<TransferRecord> {
  return request<TransferRecord>(`/api/transfers/${encodeURIComponent(transferId)}/events`, {
    method: 'POST',
    headers: { 'x-inventory-role': role, 'x-inventory-store': store, 'x-inventory-user': 'Joe Gallant' },
    body: JSON.stringify(input),
  })
}

export function appendAttentionEvent(
  attentionId: string,
  input: AttentionEventInput,
  role: UserRole,
  store: StoreName,
): Promise<AttentionItem> {
  return request<AttentionItem>(`/api/attention/${encodeURIComponent(attentionId)}/events`, {
    method: 'POST',
    headers: { 'x-inventory-role': role, 'x-inventory-store': store, 'x-inventory-user': 'Joe Gallant' },
    body: JSON.stringify(input),
  })
}
