import type { AppDisposition, AppDispositionCode, StoreName, UserRole } from '../../types'

/**
 * Client vocabulary for the app's disposition ledger (OVERVIEW_SPEC §6, §13).
 * The transition list mirrors server/vehicle-disposition.mjs so the dialog
 * offers only allowed choices; the server stays authoritative on every save.
 */

export const DISPOSITION_CODES: readonly AppDispositionCode[] = ['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out']

export const DISPOSITION_LABELS: Record<AppDispositionCode, string> = {
  keep: 'Keep',
  sold_pending: 'Sold pending',
  delivered: 'Delivered',
  wholesale: 'Wholesale',
  transfer_out: 'Transfer out',
}

export const DISPOSITION_TRANSITIONS: Record<AppDispositionCode | 'none', readonly AppDispositionCode[]> = {
  none: ['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out'],
  keep: ['sold_pending', 'delivered', 'wholesale', 'transfer_out'],
  sold_pending: ['delivered', 'keep', 'wholesale', 'transfer_out'],
  delivered: ['keep'],
  wholesale: ['keep'],
  transfer_out: ['keep', 'sold_pending'],
}

/** Delivered and wholesale close a unit; changing one back to Keep is a correction that needs a note. */
export function isCorrection(from: AppDispositionCode | null | undefined): boolean {
  return from === 'delivered' || from === 'wholesale'
}

export function dateRequired(code: AppDispositionCode | null | undefined): boolean {
  return code === 'delivered' || code === 'wholesale'
}

export function allowedDispositions(current: AppDispositionCode | null | undefined): readonly AppDispositionCode[] {
  return DISPOSITION_TRANSITIONS[current ?? 'none']
}

export const DISPOSITION_QUALIFIER = 'recorded in Inventory Flow'

/** What the vehicle workspace needs to open the dialog and refresh afterwards. */
export interface DispositionContext {
  role: UserRole
  homeStore: StoreName
  reportDate?: string
  onChanged: () => Promise<void>
}

/** The imported manager-log line shown beside, never merged with, the app's record. */
export interface ManagerLogEvidence {
  soldLabel: string
  deliveryLabel?: string | null
  sourceStore?: string | null
  sourcePeriod?: string | null
}

export function managerLogLine(evidence: ManagerLogEvidence | null | undefined): string | null {
  if (!evidence) return null
  return [evidence.soldLabel, evidence.deliveryLabel, evidence.sourceStore, evidence.sourcePeriod].filter(Boolean).join(' · ')
}

export function dispositionSummary(disposition: Pick<AppDisposition, 'code' | 'destinationStore'> | null | undefined): string {
  if (!disposition?.code) return 'No disposition recorded'
  const label = DISPOSITION_LABELS[disposition.code]
  return disposition.code === 'transfer_out' && disposition.destinationStore ? `${label} to ${disposition.destinationStore}` : label
}

/** Synthetic demo VINs date from the fixture's report day; real VINs from the device's today. */
export function defaultDispositionDate(vin: string, reportDate: string | undefined): string {
  if (vin.startsWith('TESTDATA') && reportDate) return reportDate
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
