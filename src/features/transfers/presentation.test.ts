import { describe, expect, it } from 'vitest';
import { formatDateTime, humanizeStatusLabel } from './presentation';

describe('humanizeStatusLabel', () => {
  it('turns raw underscore status codes into readable labels', () => {
    expect(humanizeStatusLabel('at_home')).toBe('At home');
    expect(humanizeStatusLabel('not_confirmed')).toBe('Not confirmed');
  });

  it('preserves already-presented status text', () => {
    expect(humanizeStatusLabel('Pickup scheduled')).toBe('Pickup scheduled');
  });
});

describe('formatDateTime', () => {
  it('uses the dealership timezone instead of the machine timezone', () => {
    expect(formatDateTime('2026-09-18T21:30:00.000Z')).toBe('09/18/2026, 5:30 PM');
  });
});
