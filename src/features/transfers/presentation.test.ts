import { describe, expect, it } from 'vitest';
import { humanizeStatusLabel } from './presentation';

describe('humanizeStatusLabel', () => {
  it('turns raw underscore status codes into readable labels', () => {
    expect(humanizeStatusLabel('at_home')).toBe('At home');
    expect(humanizeStatusLabel('not_confirmed')).toBe('Not confirmed');
  });

  it('preserves already-presented status text', () => {
    expect(humanizeStatusLabel('Pickup scheduled')).toBe('Pickup scheduled');
  });
});
