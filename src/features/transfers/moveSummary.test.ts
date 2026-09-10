import { describe, expect, it } from 'vitest';
import { awayFromHomeSummary } from './moveSummary';

const now = Date.parse('2026-09-09T16:00:00Z');

describe('away-from-home timing', () => {
  it('uses the first actual departure, not later notes or arrival', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { type: 'requested', occurredAt: '2026-09-01T10:00:00Z' },
      { type: 'vehicle_departed', occurredAt: '2026-09-07T14:00:00Z' },
      { type: 'in_transit', occurredAt: '2026-09-07T14:30:00Z' },
      { type: 'arrived', occurredAt: '2026-09-07T15:00:00Z' },
      { type: 'note_added', occurredAt: '2026-09-09T15:00:00Z' },
    ], now)).toEqual({ isAway: true, label: '2 days away', departedAt: '2026-09-07T14:00:00Z', elapsedHours: 50 });
  });

  it('resets a previous trip on confirmed home receipt', () => {
    expect(awayFromHomeSummary('Howell', 'In transit', [
      { kind: 'picked_up', occurredAt: '2026-09-01T10:00:00Z' },
      { kind: 'returned_home', occurredAt: '2026-09-03T10:00:00Z' },
      { kind: 'picked_up', occurredAt: '2026-09-09T14:00:00Z' },
    ], now)).toMatchObject({ isAway: true, label: '2 hours away', departedAt: '2026-09-09T14:00:00Z' });
  });

  it('does not invent elapsed time from an approval or arrival', () => {
    expect(awayFromHomeSummary('Howell', 'Ford Detroit', [
      { type: 'approved', occurredAt: '2026-09-01T10:00:00Z' },
      { type: 'arrived', occurredAt: '2026-09-02T10:00:00Z' },
    ], now)).toEqual({ isAway: true, label: 'Departure not recorded' });
  });

  it('distinguishes home and unknown locations from verified time away', () => {
    expect(awayFromHomeSummary('Howell', 'Howell', [], now)).toEqual({ isAway: false, label: 'At home store' });
    expect(awayFromHomeSummary('Howell', 'Unknown', [], now)).toEqual({ isAway: false, label: 'Location needs checking' });
  });
});
