import { displayDate } from './date-display'

export function formatCurrency(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return 'Not published'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatNumber(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return 'Not published'
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatDateTime(value?: string): string {
  return value ? displayDate(value, { time: true }) : 'Not confirmed'
}

export function formatDate(value?: string): string {
  return value ? displayDate(value) : 'Not set'
}

export function compactVin(vin: string): string {
  return vin.length > 8 ? `••••${vin.slice(-8)}` : vin
}
