export type VehicleChangeKind =
  | 'new_arrival'
  | 'price_change'
  | 'website_status_change'
  | 'mileage_change'
  | 'stock_correction'
  | 'store_transfer'
  | 'other'

export interface VehicleChangeSignal {
  kind: VehicleChangeKind
  label: string
  shortLabel: string
}

const SIGNALS: Array<{
  kind: Exclude<VehicleChangeKind, 'other'>
  pattern: RegExp
  label: string
  shortLabel: string
  /** Recognised so it never falls through to a generic badge, but not shown. */
  hidden?: boolean
}> = [
  { kind: 'new_arrival', pattern: /\bnew\s+arrival\b/i, label: 'New arrival', shortLabel: 'New today' },
  { kind: 'price_change', pattern: /\bprice\s+(?:change|changed)\b/i, label: 'Price changed', shortLabel: 'Price changed' },
  {
    // Website status is listing noise for store staff; it confirms nothing
    // about a sale, delivery, hold, or location.
    kind: 'website_status_change',
    pattern: /\b(?:website\s+)?status\s+(?:change|changed)\b/i,
    label: 'Website status changed',
    shortLabel: 'Status changed',
    hidden: true,
  },
  { kind: 'mileage_change', pattern: /\bmileage\s+(?:change|changed)\b/i, label: 'Mileage changed', shortLabel: 'Mileage changed' },
  { kind: 'stock_correction', pattern: /\bstock\s+(?:correction|corrected|change|changed)\b/i, label: 'Stock corrected', shortLabel: 'Stock corrected' },
  { kind: 'store_transfer', pattern: /\b(?:store\s+transfer|transferred\s+store|location\s+change)\b/i, label: 'Store changed', shortLabel: 'Store changed' },
]

export function vehicleChangeSignals(summary?: string | null): VehicleChangeSignal[] {
  const text = String(summary ?? '').trim()
  if (!text || /^no\s+change$/i.test(text)) return []

  const matched = SIGNALS.filter((signal) => signal.pattern.test(text))
  const signals = matched.filter((signal) => !signal.hidden).map(({ pattern: _pattern, hidden: _hidden, ...signal }) => signal)
  if (signals.length) return signals
  if (matched.length) return []
  return [{ kind: 'other', label: 'Inventory updated', shortLabel: 'Updated' }]
}

export function visibleVehicleChangeSignals(summary?: string | null, limit = 2) {
  const signals = vehicleChangeSignals(summary)
  return {
    visible: signals.slice(0, Math.max(0, limit)),
    hiddenCount: Math.max(0, signals.length - Math.max(0, limit)),
  }
}

export function primaryVehicleChangeSignal(summary?: string | null): VehicleChangeSignal | null {
  return vehicleChangeSignals(summary)[0] ?? null
}
