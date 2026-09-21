import { describe, expect, it } from 'vitest';
import { resolveVehicleInService } from './vehicle-in-service';

describe('one source-prioritized vehicle in-service date', () => {
  it('uses OASIS over a differing AutoCheck estimate, including the captured warranty channel', () => {
    const autoCheckReport = { estimatedInServiceDate: '2024-11-21' };
    expect(resolveVehicleInService({ fordOasis: { warrantyStartDate: '2024-11-26' }, autoCheckReport })).toMatchObject({ date: '2024-11-26', source: 'oasis' });
    expect(resolveVehicleInService({ autoCheckReport, warrantyCheck: { fordOasis: { warrantyStartDate: '2024-11-26' } } })).toMatchObject({ date: '2024-11-26', source: 'oasis' });
  });

  it('falls back to a labelled estimate whenever the OASIS date is absent or blank', () => {
    for (const fordOasis of [undefined, {}, { warrantyStartDate: '' }, { warrantyStartDate: '   ' }]) {
      expect(resolveVehicleInService({ fordOasis, autoCheckReport: { estimatedInServiceDate: '2024-11-21' } })).toEqual({ date: '2024-11-21', source: 'autocheck', label: 'In-service · AutoCheck estimate' });
    }
    expect(resolveVehicleInService({ warrantyCheck: { autoCheck: { inServiceDate: '2024-11-21' } } })).toMatchObject({ date: '2024-11-21', source: 'autocheck' });
  });

  it('does not manufacture an in-service date when neither source supplies one', () => {
    expect(resolveVehicleInService({})).toMatchObject({ date: null, source: null });
  });
});
