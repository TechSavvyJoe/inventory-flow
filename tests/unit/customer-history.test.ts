// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { customerHistorySummary } from '../../extension/sidepanel/lib/customer-history.mjs';

describe('customer-safe history summary', () => {
  it('keeps adverse title and accident facts alongside score and owners', () => {
    expect(customerHistorySummary({ dataState: 'current', score: 78, ownerCount: 2, checks: [{ label: 'State title', status: 'Rebuilt' }, { label: 'Accident / damage', status: '1 accident reported' }] })).toBe('AutoCheck score 78 · 2 owners reported · Title: Rebuilt · Accident / damage: 1 accident reported');
  });
  it('keeps distinct adverse detail when a title or accident status appears positive', () => {
    expect(customerHistorySummary({ dataState: 'current', checks: [
      { label: 'Title', status: 'No issues found', detail: 'Salvage title reported' },
      { label: 'Accident / damage', status: 'No accidents reported', detail: 'Structural damage event reported' },
    ] })).toBe('Title: No issues found · Salvage title reported · Accident / damage: No accidents reported · Structural damage event reported');
  });
  it('includes explicit total-loss and odometer discrepancy findings', () => {
    expect(customerHistorySummary({ dataState: 'stale', checks: [
      { label: 'Insurance loss', status: '1 record reported', detail: 'Total loss reported' },
      { label: 'Odometer check', status: 'Problem found', detail: 'Odometer discrepancy reported' },
    ] })).toBe('Insurance loss: 1 record reported · Total loss reported · Odometer check: Problem found · Odometer discrepancy reported');
  });
  it('keeps an explicitly affirmative adverse-history result', () => {
    expect(customerHistorySummary({ dataState: 'current', checks: [
      { label: 'Adverse history', status: 'Yes' },
    ] })).toBe('Adverse history: Yes');
  });
  it('omits routine clean material checks rather than implying a complete clean history', () => {
    expect(customerHistorySummary({ dataState: 'current', checks: [
      { label: 'Insurance loss', status: 'No issues found' },
      { label: 'Odometer check', status: 'No problems reported' },
      { label: 'Auction history', status: 'No events reported' },
      { label: 'Odometer history', status: '1 reading reported' },
      { label: 'Vehicle history', status: '1 event reported' },
    ] })).toBeNull();
  });
  it('does not imply clean history when checks are missing or the capture is incomplete', () => {
    expect(customerHistorySummary({ dataState: 'current', checks: [] })).toBeNull();
    expect(customerHistorySummary({ dataState: 'incomplete', score: 91, ownerCount: 1 })).toBeNull();
    expect(customerHistorySummary({ dataState: 'stale', checks: [{ label: 'Accident', status: 'Not reported' }] })).toBe('Accident / damage: Not reported');
  });
});
