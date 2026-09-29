/**
 * One status vocabulary for a move's next step, used wherever a due time is
 * shown. Overdue is urgent (danger) only for the store that owns the next step
 * — the store the server published from the Action center's actionability
 * rule. Every other store sees the same fact neutrally, with who it is
 * waiting on, so red keeps meaning "this is yours to do".
 */

export type SlaState = 'none' | 'on-track' | 'due-soon' | 'overdue' | 'breached'

export type SlaTone = 'danger' | 'warning' | 'neutral' | 'ok' | 'none'

export interface SlaStatus {
  state: SlaState
  overdue: boolean
  /**
   * True when the viewer's store owns the next step, false when another store
   * does, null when the owning store was not published.
   */
  ownedByViewer: boolean | null
  tone: SlaTone
  label: string
}

export interface SlaStatusInput {
  sla: SlaState
  /** Store that owns the next step, as the server published it. */
  nextActionStore?: string | null
  /** Person or role named for the next step. */
  nextActionOwner?: string | null
  /** The viewer's working store. */
  viewerStore?: string | null
}

const HOUR_MS = 60 * 60 * 1000

/** Classify a due time. A due time more than an hour past is "breached", which only ranks higher. */
export function slaState(dueAt?: string | null, now: number = Date.now()): SlaState {
  if (!dueAt) return 'none'
  const due = new Date(dueAt).getTime()
  if (Number.isNaN(due)) return 'none'
  const delta = due - now
  if (delta < -HOUR_MS) return 'breached'
  if (delta < 0) return 'overdue'
  if (delta < HOUR_MS) return 'due-soon'
  return 'on-track'
}

export function isOverdueSla(state: SlaState): boolean {
  return state === 'overdue' || state === 'breached'
}

const RETURN_COMPLETE_STATES = new Set(['returned_home', 'closed'])
// A sold-pending vehicle waits on its customer delivery, not on a trip home.
const RETURN_PAUSED_STATES = new Set(['sale_confirmed', 'delivery_confirmed'])
const TERMINAL_REQUEST_STATES = new Set(['declined', 'canceled', 'closed'])

export interface ReturnDueFacts {
  requestStatus?: string | null
  movementStatus?: string | null
  returnRequired?: boolean | null
  returnDueAt?: string | null
}

function statusCode(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * The server's return-overdue rule (service-core storeSummaries): an active
 * move whose required return is past due, neither back home nor paused while
 * a sale waits on delivery. `now` is the current time: the server judges this
 * at request time (storeSummaries(..., state.currentNow)), so the client uses
 * the clock too and a return that falls due after the morning release shows.
 */
export function isReturnOverdue(facts: ReturnDueFacts, now: number): boolean {
  const request = statusCode(facts.requestStatus)
  const movement = statusCode(facts.movementStatus)
  if (!Number.isFinite(now)) return false
  if (facts.returnRequired !== true || !facts.returnDueAt) return false
  const due = new Date(facts.returnDueAt).getTime()
  if (Number.isNaN(due) || due >= now) return false
  return !TERMINAL_REQUEST_STATES.has(request) &&
    !RETURN_COMPLETE_STATES.has(request) &&
    !RETURN_PAUSED_STATES.has(request) &&
    !RETURN_COMPLETE_STATES.has(movement)
}

/** "Fowlerville sales" reads as a person the viewer can call: "Fowlerville salesperson". */
function waitingOn(store: string, owner?: string | null): string {
  const named = owner?.trim()
  if (!named || /^unassigned$/i.test(named)) return store
  const role = named.replace(/\bsales$/i, 'salesperson')
  return role.toLocaleLowerCase().includes(store.toLocaleLowerCase()) ? role : `${role} at ${store}`
}

export function slaLabel({ sla, nextActionStore, nextActionOwner, viewerStore }: SlaStatusInput): SlaStatus {
  const overdue = isOverdueSla(sla)
  const store = nextActionStore?.trim() || null
  const ownedByViewer = store && viewerStore ? store === viewerStore : null
  if (overdue) {
    // An unpublished owner keeps the conservative, urgent reading.
    if (ownedByViewer === false && store) {
      return { state: sla, overdue, ownedByViewer, tone: 'neutral', label: `Overdue · waiting on ${waitingOn(store, nextActionOwner)}` }
    }
    return { state: sla, overdue, ownedByViewer, tone: 'danger', label: 'Overdue' }
  }
  switch (sla) {
    case 'due-soon':
      return { state: sla, overdue, ownedByViewer, tone: 'warning', label: 'Due soon' }
    case 'on-track':
      return { state: sla, overdue, ownedByViewer, tone: 'ok', label: 'On track' }
    default:
      return { state: sla, overdue, ownedByViewer, tone: 'none', label: 'No due time' }
  }
}
