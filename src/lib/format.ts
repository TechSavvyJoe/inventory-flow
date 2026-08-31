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
  if (!value) return 'Not confirmed'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatDate(value?: string): string {
  if (!value) return 'Not set'
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export function compactVin(vin: string): string {
  return vin.length > 8 ? `••••${vin.slice(-8)}` : vin
}
