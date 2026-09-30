import { demoIdentityHeaders, request } from './api'
import type { StoreName, UserRole } from '../types'

export interface SavedVehicleListItem {
  vin: string
  addedAt: string
  available: boolean
}

export interface SavedVehicleList {
  id: string
  label: string
  revision: number
  createdAt: string
  updatedAt: string
  items: SavedVehicleListItem[]
}

export type SavedListMutation =
  | { action: 'create'; label: string }
  | { action: 'rename'; listId: string; expectedRevision: number; label: string }
  | { action: 'delete'; listId: string; expectedRevision: number }
  | { action: 'add' | 'remove'; listId: string; expectedRevision: number; vin: string }

export function getSavedVehicleLists(role: UserRole, store: StoreName, signal?: AbortSignal) {
  return request<{ lists: SavedVehicleList[] }>('/api/saved-lists', {
    headers: demoIdentityHeaders(role, store),
    signal,
  })
}

export function mutateSavedVehicleList(input: SavedListMutation, role: UserRole, store: StoreName) {
  return request<SavedVehicleList | { id: string; deleted: true; revision: number }>('/api/saved-lists', {
    method: 'POST',
    headers: demoIdentityHeaders(role, store),
    body: JSON.stringify(input),
  })
}

export function savedListLabelError(value: string): string | null {
  const label = value.trim()
  if (!label) return 'Enter initials or a nickname.'
  if ([...label].length > 80) return 'Use 80 characters or fewer.'
  if (/@|https?:\/\/|www\./i.test(label) || (label.match(/\d/g)?.length ?? 0) >= 7) {
    return 'Use initials or a nickname, without contact information.'
  }
  return null
}
