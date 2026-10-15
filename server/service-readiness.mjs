import { createHash, randomUUID } from 'node:crypto'
import { STORE_NAMES } from './constants.mjs'
import { WorkflowError } from './workflow.mjs'

export const SERVICE_STATUSES = Object.freeze(['needs_service', 'in_service', 'serviced'])
export const SERVICE_EVENT_COLUMNS = Object.freeze([
  'id', 'vin', 'version', 'status', 'service_entered_at', 'completed_at', 'notes',
  'updated_at', 'actor', 'actor_user_id', 'actor_role', 'store_id', 'input_hash', 'idempotency_key',
])

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const AUTOCHECK_INSPECTION_TYPES = new Set([
  'Vehicle Serviced or Inspected',
  'Multiple Point Vehicle Inspection',
  'Multi-Point Vehicle Inspection',
  'Certified Pre-Owned Inspection',
  'Pre-Purchase Inspection',
  'Safety Inspection',
  'Vehicle Inspected',
])

function isoDay(value) {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : value
}

function oasisDay(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const [, month, day, year] = match
  return isoDay(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`)
}

function intakeDay(vehicle) {
  // A complete source capture can first observe a unit after the dealership
  // listing already began. Use the earliest valid dealership-arrival evidence
  // so a late import cannot invalidate a post-listing inspection.
  const days = [
    isoDay(vehicle.serviceIntake?.first_arrival_date),
    isoDay(vehicle.inventoryDate),
  ].filter(Boolean)
  return days.sort()[0] ?? null
}

function autoCheckReadinessEvidence(vehicle) {
  if (/^(ford|linc|lincoln)$/i.test(String(vehicle.make ?? '').trim())) return null
  const report = vehicle.autoCheckReport
  if (report?.dataState !== 'current') return null
  const intakeDate = intakeDay(vehicle)
  const inspectionDate = isoDay(report.recentInspection?.date)
  const types = Array.isArray(report.recentInspection?.types)
    ? report.recentInspection.types.filter((value) => AUTOCHECK_INSPECTION_TYPES.has(value)).slice(0, 8)
    : []
  if (!intakeDate || !inspectionDate || inspectionDate < intakeDate || !types.length) return null
  return { source: 'autocheck', inspectionDate, types }
}

function isCertifiedBlueOvalInspection(order) {
  return order?.inspection?.status === 'confirmed' &&
    /^certified blue oval inspection$/i.test(String(order.inspection.type ?? '').trim())
}

function latestCertifiedBlueOvalInspection(history) {
  const inspections = [
    history?.certifiedInspection,
    history?.recentInspection,
    ...(Array.isArray(history?.recentRepairOrders) ? history.recentRepairOrders : []),
  ].filter(isCertifiedBlueOvalInspection)
  return inspections.sort((left, right) => (oasisDay(right.closeDate) ?? '').localeCompare(oasisDay(left.closeDate) ?? ''))[0] ?? null
}

function fordServiceReadinessEvidence(vehicle) {
  if (!/^(ford|linc|lincoln)$/i.test(String(vehicle.make ?? '').trim())) return null
  const history = vehicle.fordOasis?.serviceHistory
  const inspection = latestCertifiedBlueOvalInspection(history)
  if (history?.dataState !== 'current' || history.historyCaptured !== true || !inspection) return null
  const intakeDate = intakeDay(vehicle)
  const inServiceDate = oasisDay(inspection.openDate)
  const readyDate = oasisDay(inspection.closeDate)
  const inspectionType = typeof inspection.inspection.type === 'string' ? inspection.inspection.type.trim() : ''
  if (!intakeDate || !inServiceDate || !readyDate || inServiceDate < intakeDate || readyDate < inServiceDate || !inspectionType) return null
  return { source: 'ford_service_history', inspectionDate: readyDate, inServiceDate, readyDate, types: [inspectionType] }
}

export function serviceStore(vehicle) {
  if (vehicle.movement?.locationConfidence === 'verified' && STORE_NAMES.includes(vehicle.movement.currentLocation)) {
    return vehicle.movement.currentLocation
  }
  // Ownership falls back to the server's home-store calculation. This grants
  // the store manager a service action without asserting physical custody.
  return STORE_NAMES.includes(vehicle.homeStore) ? vehicle.homeStore : null
}

/**
 * Minimal vehicle used only to project saved service history after the VIN
 * leaves the current public/DealerMail release. The durable home assignment
 * is the vehicle's store. A service event's store is the recording actor's
 * store, so it is only a fallback. This never invents a listing.
 */
export function archivedServiceVehicle({ vin, rows = [], homeStore = null, serviceIntake = null }) {
  const latestStore = rows.at(-1)?.store_id
  const vehicle = {
    vin,
    homeStore: STORE_NAMES.includes(homeStore) ? homeStore
      : STORE_NAMES.includes(latestStore) ? latestStore
      : null,
  }
  if (serviceIntake) Object.defineProperty(vehicle, 'serviceIntake', { value: serviceIntake })
  return vehicle
}

export function serviceReadinessView(vehicle, row, context, { includeNotes = false } = {}) {
  const store = serviceStore(vehicle)
  const canManage = context.role === 'group_manager' || (context.role === 'manager' && store === context.store)
  const recordedStatus = SERVICE_STATUSES.includes(row?.status) ? row.status : null
  // A complete, exact-VIN inspection in the selected release is readiness evidence.
  // It never replaces a manager's recorded decision, but remains attached so
  // the SRP and VDP can show the independent source and its dates.
  const publishedEvidence = vehicle.publishedServiceEvidence ?? vehicle
  const readinessEvidence = fordServiceReadinessEvidence(publishedEvidence) ?? autoCheckReadinessEvidence(publishedEvidence)
  const readinessBasis = readinessEvidence?.source === 'ford_service_history'
    ? 'ford_service_history_inspection'
    : readinessEvidence ? 'autocheck_post_intake_inspection' : row ? 'legacy_review' : vehicle.serviceIntake ? 'new_arrival' : 'unconfirmed'
  return {
    vin: vehicle.vin,
    // Being listed, having no hold, or having an old warranty start date does
    // not establish that this vehicle finished the store's current service work.
    // Unconfirmed inventory shares the Waiting queue until a manager records it.
    status: recordedStatus ?? (readinessEvidence ? 'serviced' : 'needs_service'),
    readinessBasis: recordedStatus ? 'manager_updated' : readinessBasis,
    version: row?.version ?? 0,
    // A manager clearing/reopening work intentionally clears its dates. Source
    // inspection dates remain evidence, not dates for the new service cycle.
    serviceEnteredAt: recordedStatus ? row.service_entered_at ?? null : readinessEvidence?.inServiceDate ?? null,
    completedAt: recordedStatus ? row.completed_at ?? null : readinessEvidence?.readyDate ?? readinessEvidence?.inspectionDate ?? null,
    updatedAt: row?.updated_at ?? null, updatedBy: row?.actor ?? null,
    updatedByRole: row?.actor_role ?? null, updatedAtStore: row?.store_id ?? null,
    store, canManage, readinessEvidence,
    ...(includeNotes && context.canViewPrivateEvidence ? { notes: row?.notes ?? null } : {}),
  }
}

function serviceDate(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new WorkflowError('Enter a valid service date.', { code: 'INVALID_SERVICE_DATE' })
  }
  if (value > today) throw new WorkflowError('Service dates cannot be in the future.', { code: 'INVALID_SERVICE_DATE' })
  return value
}

export function buildServiceReadinessEvent(vehicle, rows, input, context, { now, today, idempotencyKey }) {
  const current = rows.at(-1) ?? null
  const view = serviceReadinessView(vehicle, current, context)
  if (!view.canManage) throw new WorkflowError('Only this vehicle’s store manager can update service status.', { status: 403, code: 'SERVICE_MANAGER_REQUIRED' })
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorkflowError('A service update is required.')
  const allowed = new Set(['status', 'serviceDate', 'notes', 'expectedVersion'])
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new WorkflowError('Unsupported service update field.', { code: 'INVALID_SERVICE_INPUT' })
  if (!SERVICE_STATUSES.includes(input.status)) throw new WorkflowError('Choose a valid service status.', { code: 'INVALID_SERVICE_STATUS' })
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new WorkflowError('Reload this vehicle before updating service status.', { code: 'SERVICE_VERSION_REQUIRED' })
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 160 || /[\x00-\x1f]/.test(idempotencyKey)) {
    throw new WorkflowError('A valid idempotency key is required.', { code: 'IDEMPOTENCY_KEY_REQUIRED' })
  }
  if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.notes))) {
    throw new WorkflowError('Service notes must be text, up to 1,000 characters.', { code: 'INVALID_SERVICE_NOTES' })
  }
  const notes = input.notes?.trim() || null
  const date = ['in_service', 'serviced'].includes(input.status) ? serviceDate(input.serviceDate, today) : null
  if (date === null && input.serviceDate) throw new WorkflowError('A date applies only to in-service or completed work.', { code: 'INVALID_SERVICE_DATE' })
  const inputHash = createHash('sha256').update(JSON.stringify({
    status: input.status, date, notes, expectedVersion: input.expectedVersion,
    actor: context.userId || context.user, role: context.role, store: context.store,
  })).digest('hex')
  const replay = rows.find((row) => row.idempotency_key === idempotencyKey)
  if (replay) {
    if (replay.input_hash !== inputHash) throw new WorkflowError('This request key was already used for a different service update.', { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    return { row: replay, created: false }
  }
  if (input.expectedVersion !== view.version) throw new WorkflowError('Another manager updated this vehicle. Review the latest status and save again.', { status: 409, code: 'SERVICE_VERSION_CONFLICT' })
  const enteredAt = input.status === 'in_service' ? date : input.status === 'serviced' ? current?.service_entered_at ?? null : null
  if (input.status === 'serviced' && enteredAt && date < enteredAt) {
    throw new WorkflowError('Completion date cannot be before the date service started.', { code: 'INVALID_SERVICE_DATE' })
  }
  return { created: true, row: {
    id: randomUUID(), vin: vehicle.vin, version: view.version + 1, status: input.status,
    service_entered_at: enteredAt, completed_at: input.status === 'serviced' ? date : null,
    notes, updated_at: now.toISOString(), actor: context.user, actor_user_id: context.userId || null,
    // Audit the signed-in role, not a group manager's previewed role, the same
    // convention transfer events follow (workflow.mjs).
    actor_role: context.authenticatedRole || context.role, store_id: context.store, input_hash: inputHash, idempotency_key: idempotencyKey,
  } }
}
