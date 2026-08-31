import { AlertTriangle, CircleCheck, MapPin, Truck, UserRound } from 'lucide-react';
import type { TransferTimelineEvent } from './types';
import { formatDateTime } from './presentation';

export interface TransferTimelineProps {
  events: TransferTimelineEvent[];
  emptyLabel?: string;
}

export function TransferTimeline({
  events,
  emptyLabel = 'No custody events have been recorded yet.',
}: TransferTimelineProps) {
  if (events.length === 0) {
    return <p className="mif-timeline-empty">{emptyLabel}</p>;
  }

  return (
    <ol className="mif-custody-timeline" aria-label="Custody timeline">
      {events.map((event) => (
        <li
          className={event.exception ? 'mif-timeline-event is-exception' : 'mif-timeline-event'}
          data-event-kind={event.kind}
          key={event.id}
        >
          <span className="mif-timeline-marker" aria-hidden="true">
            {event.exception ? (
              <AlertTriangle size={14} strokeWidth={1.75} />
            ) : (
              <CircleCheck size={14} strokeWidth={1.75} />
            )}
          </span>
          <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
          <div className="mif-timeline-copy">
            <strong>{event.title}</strong>
            {event.detail ? <span>{event.detail}</span> : null}
            <div className="mif-timeline-meta">
              {event.location ? (
                <span>
                  <MapPin aria-hidden="true" size={13} strokeWidth={1.75} />
                  {event.location}
                </span>
              ) : null}
              {event.actorLabel ? (
                <span>
                  <UserRound aria-hidden="true" size={13} strokeWidth={1.75} />
                  {event.actorLabel}
                  {event.actorRole ? ` · ${event.actorRole}` : ''}
                </span>
              ) : null}
              {event.custodianLabel ? (
                <span>
                  <UserRound aria-hidden="true" size={13} strokeWidth={1.75} />
                  Custodian: {event.custodianLabel}
                </span>
              ) : null}
              {event.transportAssigneeLabel ? (
                <span>
                  <Truck aria-hidden="true" size={13} strokeWidth={1.75} />
                  Driver: {event.transportAssigneeLabel}
                </span>
              ) : null}
              {event.source ? <span className="mif-event-source">Source: {event.source}</span> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
