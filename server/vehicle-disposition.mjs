import { createHash, randomUUID } from 'node:crypto'
import { STORE_NAMES } from './constants.mjs'
import { employeeNoteHasContactInformation } from './employee-note-validation.mjs'
import { WorkflowError } from './workflow.mjs'

/**
 * The app-owned disposition ledger (OVERVIEW_SPEC §6). A row is a manager's
 * recorded decision about a vehicle. It never changes DealerMail, CDK, the
 * public listing, the imported manager log or physical location, and it is
 * never inferred from any of them: only this module's explicit, audited write
 * creates one. A delivered disposition never hides a vehicle; only sources do.
 */

export const DISPOSITION_CODES = Object.freeze(['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out', 'other'])
export const DISPOSITION_EVENT_COLUMNS = Object.freeze([
  'id', 'vin', 'version', 'disposition', 'effective_date', 'destination_store', 'note',
  'updated_at', 'actor', 'actor_user_id', 'actor_role', 'store_id', 'input_hash', 'idempotency_key',
])

// Allowed transitions (from → to). Key `none` = no row yet (a string key,
// never a literal null key). Delivered and wholesale close a unit: the only
// way back is a correction to Keep, which requires a note.
export const DISPOSITION_TRANSITIONS = Object.freeze({
  none: Object.freeze(['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out', 'other']),
  keep: Object.freeze(['sold_pending', 'delivered', 'wholesale', 'transfer_out', 'other']),
  // keep = the deal fell through; wholesale / transfer_out = the deal
  // collapsed and the unit was re-dispositioned.
  sold_pending: Object.freeze(['delivered', 'keep', 'wholesale', 'transfer_out', 'other']),
  delivered: Object.freeze(['keep']),
  wholesale: Object.freeze(['keep']),
  transfer_out: Object.freeze(['keep', 'sold_pending', 'other']),
  other: Object.freeze(['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out', 'other']),
})

export const DISPOSITION_NOTE_LIMIT = 500
const CORRECTIONS = new Set(['delivered', 'wholesale'])
const DATE_REQUIRED = new Set(['delivered', 'wholesale'])
const INPUT_KEYS = new Set(['disposition', 'effectiveDate', 'destinationStore', 'note', 'expectedVersion'])
const WRITER_ROLES = new Set(['manager', 'group_manager'])
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const NOTE_CONTROL_CHARACTERS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

// Operational words a hold's customer/reason text uses without naming anyone.
// They are dropped only from that text's evidence tokens, so "Deposit taken;
// delivery this week" stays writable on a unit held for "Smith — deposit".
// Nothing that can be a first name or surname belongs here (no day names, no
// "will"); salesperson tokens and the note's own tokens are never filtered.
const REASON_TEXT_COMMON_WORDS = new Set((
  'customer customers deposit deposits delivery deliver delivered sold sale hold holds held deal deals ' +
  'pending wholesale transfer trade keep today tomorrow week weekend with from have that this when after before until'
).split(' '))

/**
 * The store whose manager owns a vehicle's disposition. Role-independent on
 * purpose: `vehicle.homeStore` depends on which move rows the caller may see,
 * so an authorization decision uses only the confirmed home assignment and
 * the source store, never the caller's view.
 */
export function dispositionOwnerStore(source) {
  const store = source?.homeAssignment?.home_store_id || source?.publicRecord?.store || source?.crmRecord?.storeName
  return STORE_NAMES.includes(store) ? store : null
}

function canManageDisposition(ownerStore, context, enabled) {
  return enabled && Boolean(ownerStore) &&
    (context.role === 'group_manager' || (context.role === 'manager' && context.store === ownerStore))
}

/**
 * One disposition as a caller may see it. The note and the writer's name are
 * private evidence (sales, managers, group managers), and only a detail read
 * asks for them; list views carry codes, dates and stores only.
 */
export function dispositionView(source, row, context, { includeNote = false, enabled = true } = {}) {
  const ownerStore = dispositionOwnerStore(source)
  return {
    vin: source.vin,
    code: DISPOSITION_CODES.includes(row?.disposition) ? row.disposition : null,
    version: Number.isSafeInteger(row?.version) ? row.version : 0,
    effectiveDate: row?.effective_date ?? null,
    destinationStore: STORE_NAMES.includes(row?.destination_store) ? row.destination_store : null,
    updatedAt: row?.updated_at ?? null,
    updatedByRole: WRITER_ROLES.has(row?.actor_role) ? row.actor_role : null,
    store: STORE_NAMES.includes(row?.store_id) ? row.store_id : null,
    ownerStore,
    canManage: canManageDisposition(ownerStore, context, enabled),
    ...(includeNote && context.canViewPrivateEvidence ? { updatedBy: row?.actor ?? null, note: row?.note ?? null } : {}),
  }
}

export function dispositionDetail(source, rows, context, { enabled = true } = {}) {
  return {
    ...dispositionView(source, rows.at(-1) ?? null, context, { includeNote: true, enabled }),
    history: context.canViewPrivateEvidence
      ? [...rows].reverse().map((row) => dispositionView(source, row, context, { includeNote: true, enabled }))
      : [],
  }
}

/** Lower-cased letter/number runs of four or more characters (the spec's floor). */
function tokens(value) {
  return String(value ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 4)
}

/** Name and reason tokens from this VIN's DealerMail hold rows, active, deleted and released. */
function holdEvidenceTokens(source) {
  const rows = [
    ...(source?.holdRecord?.holdDetailRows ?? []),
    ...(source?.releasedHistoryRecord?.holdDetailRows ?? []),
  ]
  const evidence = new Set()
  for (const row of rows) {
    for (const token of tokens(row?.customerOrReasonRaw)) if (!REASON_TEXT_COMMON_WORDS.has(token)) evidence.add(token)
    // A salesperson field is always a name: every token counts.
    for (const token of tokens(row?.salespersonRaw)) evidence.add(token)
  }
  return evidence
}

function blank(value) {
  return value === undefined || value === null || value === ''
}

/** A calendar day in the release timezone, never after today. */
function effectiveDay(value, today, required) {
  if (blank(value)) {
    if (required) throw new WorkflowError('Enter the date this disposition took effect.', { code: 'INVALID_DISPOSITION_DATE' })
    return null
  }
  const date = typeof value === 'string' && ISO_DAY.test(value) ? new Date(`${value}T12:00:00Z`) : null
  if (!date || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new WorkflowError('Enter a valid disposition date.', { code: 'INVALID_DISPOSITION_DATE' })
  }
  if (value > today) throw new WorkflowError('A disposition date cannot be in the future.', { code: 'INVALID_DISPOSITION_DATE' })
  return value
}

/**
 * Validates one requested disposition against the vehicle's ledger rows and
 * returns the append-only row to insert, or the original row for a replay.
 * Identity (actor, role, store) comes only from the server-resolved context.
 */
export function buildDispositionEvent(source, rows, input, context, { now, today, idempotencyKey, enabled = true }) {
  if (!enabled) throw new WorkflowError('Disposition storage is not enabled yet.', { status: 503, code: 'MIGRATION_REQUIRED' })
  const current = rows.at(-1) ?? null
  const view = dispositionView(source, current, context, { enabled })
  if (!view.canManage) {
    throw new WorkflowError('Only this vehicle’s home-store manager can record a disposition.', { status: 403, code: 'DISPOSITION_MANAGER_REQUIRED' })
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !INPUT_KEYS.has(key))) {
    throw new WorkflowError('Unsupported disposition field.', { code: 'INVALID_DISPOSITION_INPUT' })
  }
  if (!DISPOSITION_CODES.includes(input.disposition)) throw new WorkflowError('Choose a valid disposition.', { code: 'INVALID_DISPOSITION' })
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new WorkflowError('Reload this vehicle before recording a disposition.', { code: 'DISPOSITION_VERSION_REQUIRED' })
  }
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 160 || /[\x00-\x1f]/.test(idempotencyKey)) {
    throw new WorkflowError('A valid idempotency key is required.', { code: 'IDEMPOTENCY_KEY_REQUIRED' })
  }
  const disposition = input.disposition
  // A retry is answered from the ledger before the date, destination and note
  // are judged again: a hold or a calendar day that changed since the original
  // save must not turn a confirmed write into an error. The hash uses the same
  // normalized values the original validation stored.
  const inputHash = createHash('sha256').update(JSON.stringify({
    disposition,
    effectiveDate: blank(input.effectiveDate) ? null : input.effectiveDate,
    destinationStore: blank(input.destinationStore) ? null : input.destinationStore,
    note: typeof input.note === 'string' ? input.note.trim() || null : input.note ?? null,
    expectedVersion: input.expectedVersion,
    actor: context.userId || context.user, role: context.role, store: context.store,
  })).digest('hex')
  const replay = rows.find((row) => row.idempotency_key === idempotencyKey)
  if (replay) {
    if (replay.input_hash !== inputHash) {
      throw new WorkflowError('This request key was already used for a different disposition.', { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    }
    return { row: replay, created: false }
  }
  const effectiveDate = effectiveDay(input.effectiveDate, today, DATE_REQUIRED.has(disposition))
  const rawDestination = input.destinationStore
  let destinationStore = null
  if (disposition === 'transfer_out') {
    if (blank(rawDestination)) {
      throw new WorkflowError('Choose the store this vehicle is transferring to.', { code: 'DESTINATION_STORE_REQUIRED' })
    }
    if (!STORE_NAMES.includes(rawDestination) || rawDestination === view.ownerStore) {
      throw new WorkflowError('Choose another store in the group as the destination.', { code: 'INVALID_DESTINATION_STORE' })
    }
    destinationStore = rawDestination
  } else if (!blank(rawDestination)) {
    throw new WorkflowError('A destination store applies only to a transfer out.', { code: 'INVALID_DESTINATION_STORE' })
  }
  if (input.note != null && (typeof input.note !== 'string' || input.note.length > DISPOSITION_NOTE_LIMIT || NOTE_CONTROL_CHARACTERS.test(input.note))) {
    throw new WorkflowError(`Disposition notes must be text, up to ${DISPOSITION_NOTE_LIMIT} characters.`, { code: 'INVALID_DISPOSITION_NOTE' })
  }
  const note = input.note?.trim() || null
  if (note) {
    if (employeeNoteHasContactInformation(note)) {
      throw new WorkflowError('Keep contact information in the CRM, not in disposition notes.', { code: 'INVALID_DISPOSITION_NOTE' })
    }
    const evidence = holdEvidenceTokens(source)
    // Every note token is compared: the reason-text allowlist never applies here.
    if (tokens(note).some((token) => evidence.has(token))) {
      throw new WorkflowError('Notes cannot repeat names or reasons from the DealerMail hold.', { code: 'DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE' })
    }
  }
  if (input.expectedVersion !== view.version) {
    throw new WorkflowError('Another manager updated this vehicle’s disposition. Review the latest and save again.', { status: 409, code: 'DISPOSITION_VERSION_CONFLICT' })
  }
  const from = view.code ?? 'none'
  const allowed = DISPOSITION_TRANSITIONS[from]
  if (!allowed.includes(disposition)) {
    throw new WorkflowError('That disposition cannot follow the current one.', {
      code: 'INVALID_DISPOSITION_TRANSITION', details: { from, to: disposition, allowed: [...allowed] },
    })
  }
  if ((CORRECTIONS.has(from) || disposition === 'other') && (!note || note.length < 3)) {
    throw new WorkflowError(disposition === 'other' ? 'Explain the Other disposition in a note.' : 'Explain the correction in a note.', { code: 'INVALID_DISPOSITION_NOTE' })
  }
  return {
    created: true,
    row: {
      id: randomUUID(), vin: source.vin, version: view.version + 1, disposition,
      effective_date: effectiveDate, destination_store: destinationStore, note,
      updated_at: now.toISOString(), actor: context.user, actor_user_id: context.userId || null,
      // Audit the signed-in role, not a group manager's previewed role.
      actor_role: context.authenticatedRole || context.role, store_id: context.store,
      input_hash: inputHash, idempotency_key: idempotencyKey,
    },
  }
}
