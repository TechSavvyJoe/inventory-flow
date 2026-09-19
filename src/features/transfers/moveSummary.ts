/**
 * Evidence the server accepts as a departure when the simplified workflow never
 * recorded a collection: see movementDepartureAt() in server/service-core.mjs.
 */
const COLLECTION_EVENTS = ['vehicle_departed', 'picked_up', 'in_transit'];
const DESTINATION_CUSTODY_EVENTS = ['customer_showing', 'sale_outcome_pending', 'sale_confirmed', 'not_sold'];

interface MoveEvidenceEvent {
  kind?: string;
  type?: string;
  occurredAt: string;
  /** Move rows carry both ledger locations; tracker timeline events carry the to-location as `location`. */
  fromLocation?: string;
  toLocation?: string;
  location?: string;
}

/** How the clock was proved: a recorded collection, custody at the destination, or a return leaving it. */
export type DepartureEvidence = 'collected' | 'at-destination' | 'return-started';

export interface AwayFromHomeSummary {
  isAway: boolean;
  label: string;
  departedAt?: string;
  elapsedHours?: number;
  evidence?: DepartureEvidence;
}

/** Notes, approvals, ETA updates and reported issues are not departure evidence. */
export function awayFromHomeSummary(
  homeStore: string,
  currentLocation: string,
  events: MoveEvidenceEvent[],
  { destination, now = Date.now() }: { destination?: string; now?: number } = {},
): AwayFromHomeSummary {
  const current = currentLocation.trim().toLowerCase();
  if (current === homeStore.trim().toLowerCase()) return { isAway: false, label: 'At home store' };
  if (!current || /unknown|not recorded|not provided|unverified/.test(current)) {
    return { isAway: false, label: 'Location needs checking' };
  }
  const target = destination?.trim().toLowerCase();
  const atDestination = (value?: string) => Boolean(target) && value?.trim().toLowerCase() === target;
  let departedAt: string | undefined;
  let evidence: DepartureEvidence | undefined;
  for (const event of [...events].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))) {
    const timestamp = Date.parse(event.occurredAt);
    if (!Number.isFinite(timestamp) || timestamp > now) continue;
    const kind = (event.kind ?? event.type ?? '').replace(/-/g, '_');
    // Only a recorded home receipt clears the clock; keep the earliest proof after it.
    if (kind === 'returned_home') {
      departedAt = undefined;
      evidence = undefined;
      continue;
    }
    if (departedAt) continue;
    if (COLLECTION_EVENTS.includes(kind)) evidence = 'collected';
    else if (kind === 'direct_move_recorded') evidence = 'at-destination';
    else if (DESTINATION_CUSTODY_EVENTS.includes(kind) && atDestination(event.toLocation ?? event.location)) evidence = 'at-destination';
    else if (kind === 'return_started' && atDestination(event.fromLocation)) evidence = 'return-started';
    else continue;
    departedAt = event.occurredAt;
  }
  if (!departedAt) return { isAway: true, label: 'Departure not recorded' };
  const elapsedHours = Math.max(0, Math.floor((now - Date.parse(departedAt)) / 3_600_000));
  const days = Math.floor(elapsedHours / 24);
  const label = days > 0
    ? `${days} ${days === 1 ? 'day' : 'days'} away`
    : elapsedHours > 0
      ? `${elapsedHours} ${elapsedHours === 1 ? 'hour' : 'hours'} away`
      : 'Less than 1 hour away';
  return { isAway: true, label, departedAt, elapsedHours, evidence };
}
