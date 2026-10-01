// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { salesSpecifications } from '../../extension/sidepanel/lib/sales-specs.mjs';

describe('source-backed sales specifications', () => {
  it('fills missing listing facts without replacing published values or mutating evidence', () => {
    const record = { engine: 'Published engine', transmission: ' ', exteriorColor: null };
    const documents = { windowSticker: { dataState: 'current', engine: 'Sticker engine', transmission: '10-speed automatic', exteriorColor: 'Oxford White' }, factoryEquipment: { dataState: 'stale', drivetrain: '4x4', interiorColor: 'Black' } };
    const before = JSON.stringify({ record, documents });
    expect(salesSpecifications(record, documents)).toEqual({ engine: 'Published engine', transmission: '10-speed automatic', drivetrain: '4x4', exteriorColor: 'Oxford White', interiorColor: 'Black' });
    expect(JSON.stringify({ record, documents })).toBe(before);
  });
  it('does not fill specifications from incomplete or unavailable documents', () => {
    expect(salesSpecifications({}, { windowSticker: { dataState: 'incomplete', engine: 'Unverified' }, factoryEquipment: { dataState: 'unavailable', drivetrain: 'Unverified' } })).toEqual({ engine: null, transmission: null, drivetrain: null, exteriorColor: null, interiorColor: null });
  });
});
