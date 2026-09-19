import { describe, expect, it } from 'vitest';
import { awayFromHomeSummary } from './moveSummary';

const now = Date.parse('2026-09-09T16:00:00Z');
const detroit = { destination: 'Ford Detroit', now };

describe('away-from-home timing', () => {
  it('uses the first actual departure, not later notes or arrival', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { type: 'requested', occurredAt: '2026-09-01T10:00:00Z' },
      { type: 'vehicle_departed', occurredAt: '2026-09-07T14:00:00Z' },
      { type: 'in_transit', occurredAt: '2026-09-07T14:30:00Z' },
      { type: 'arrived', occurredAt: '2026-09-07T15:00:00Z' },
      { type: 'note_added', occurredAt: '2026-09-09T15:00:00Z' },
    ], detroit)).toEqual({ isAway: true, label: '2 days away', departedAt: '2026-09-07T14:00:00Z', elapsedHours: 50, evidence: 'collected' });
  });

  it('resets a previous trip on confirmed home receipt', () => {
    expect(awayFromHomeSummary('Howell', 'In transit', [
      { kind: 'picked_up', occurredAt: '2026-09-01T10:00:00Z' },
      { kind: 'returned_home', occurredAt: '2026-09-03T10:00:00Z' },
      { kind: 'picked_up', occurredAt: '2026-09-09T14:00:00Z' },
    ], detroit)).toMatchObject({ isAway: true, label: '2 hours away', departedAt: '2026-09-09T14:00:00Z' });
  });

  it('does not invent elapsed time from an approval or arrival', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { type: 'approved', occurredAt: '2026-09-01T10:00:00Z' },
      { type: 'arrived', occurredAt: '2026-09-02T10:00:00Z' },
    ], detroit)).toEqual({ isAway: true, label: 'Departure not recorded' });
  });

  it('distinguishes home and unknown locations from verified time away', () => {
    expect(awayFromHomeSummary('Howell', 'Howell', [], detroit)).toEqual({ isAway: false, label: 'At home store' });
    expect(awayFromHomeSummary('Howell', 'Unknown', [], detroit)).toEqual({ isAway: false, label: 'Location needs checking' });
  });

  // The simplified workflow approves, records an outcome and returns; nobody logs a pickup.
  it('accepts a showing at the destination when no collection was recorded', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { type: 'request_approved', toLocation: 'Howell', occurredAt: '2026-09-07T12:00:00Z' },
      { type: 'customer_showing', toLocation: 'Ford Detroit', occurredAt: '2026-09-07T14:00:00Z' },
    ], detroit)).toEqual({ isAway: true, label: '2 days away', departedAt: '2026-09-07T14:00:00Z', elapsedHours: 50, evidence: 'at-destination' });
  });

  it('accepts a confirmed sale at the destination from a tracker timeline event', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { kind: 'sale_confirmed', location: 'Ford Detroit', occurredAt: '2026-09-09T10:00:00Z' },
    ], detroit)).toMatchObject({ isAway: true, label: '6 hours away', departedAt: '2026-09-09T10:00:00Z', evidence: 'at-destination' });
  });

  it('accepts a return that started at the destination', () => {
    expect(awayFromHomeSummary('Howell', 'In transit', [
      { kind: 'return_started', fromLocation: 'Ford Detroit', toLocation: 'In transit', occurredAt: '2026-09-09T13:00:00Z' },
    ], detroit)).toMatchObject({ isAway: true, label: '3 hours away', departedAt: '2026-09-09T13:00:00Z', evidence: 'return-started' });
  });

  it('clears destination custody evidence on a later home receipt', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { kind: 'sale_confirmed', location: 'Ford Detroit', occurredAt: '2026-09-01T10:00:00Z' },
      { kind: 'returned_home', occurredAt: '2026-09-03T10:00:00Z' },
    ], detroit)).toEqual({ isAway: true, label: 'Departure not recorded' });
  });

  it('treats an approval, note or ETA update at the destination as no evidence', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { type: 'request_approved', toLocation: 'Ford Detroit', occurredAt: '2026-09-07T10:00:00Z' },
      { type: 'note_added', toLocation: 'Ford Detroit', occurredAt: '2026-09-07T11:00:00Z' },
      { type: 'eta_updated', toLocation: 'Ford Detroit', occurredAt: '2026-09-08T09:00:00Z' },
      { type: 'condition_issue', toLocation: 'Ford Detroit', occurredAt: '2026-09-08T10:00:00Z' },
    ], detroit)).toEqual({ isAway: true, label: 'Departure not recorded' });
  });

  it('ignores an outcome recorded somewhere other than the destination', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { type: 'not_sold', toLocation: 'Lincoln', occurredAt: '2026-09-07T14:00:00Z' },
      { type: 'return_started', fromLocation: 'Lincoln', toLocation: 'In transit', occurredAt: '2026-09-08T14:00:00Z' },
    ], detroit)).toEqual({ isAway: true, label: 'Departure not recorded' });
  });

  it('keeps an unknown destination from turning an outcome into a departure', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { type: 'sale_confirmed', toLocation: 'Ford Detroit', occurredAt: '2026-09-07T14:00:00Z' },
    ], { now })).toEqual({ isAway: true, label: 'Departure not recorded' });
  });

  it('prefers a recorded collection over a later outcome at the destination', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { type: 'picked_up', occurredAt: '2026-09-07T09:00:00Z' },
      { type: 'sale_confirmed', toLocation: 'Ford Detroit', occurredAt: '2026-09-08T14:00:00Z' },
    ], detroit)).toMatchObject({ departedAt: '2026-09-07T09:00:00Z', evidence: 'collected' });
  });
});
