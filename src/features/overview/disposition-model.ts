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
  timezone?: string
  /** False when the server's disposition table is not installed yet. */
  enabled?: boolean
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

/** Match the server's calendar; synthetic demo VINs retain their fixture day. */
export function defaultDispositionDate(vin: string, reportDate: string | undefined, timezone = 'America/New_York'): string {
  if (vin.startsWith('TESTDATA') && reportDate) return reportDate
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
