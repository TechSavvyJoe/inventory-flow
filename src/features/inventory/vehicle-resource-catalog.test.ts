import { describe, expect, it } from 'vitest';
import { vehicleResourceCatalog, type VehicleResource, type VehicleResourceVehicle } from './vehicle-resource-catalog';

const vehicle = (fields: Partial<VehicleResourceVehicle> = {}): VehicleResourceVehicle => ({
  vin: '1FTFW1E84RKF12345', make: 'Ford', model: 'F-150', year: 2024, ...fields,
});
function resource(fields: Partial<VehicleResourceVehicle>, id: VehicleResource['id']) {
  const value = vehicleResourceCatalog(vehicle(fields)).find(entry => entry.id === id);
  expect(value, `Expected ${id} source`).toBeDefined();
  return value!;
}

describe('rich vehicle resource catalog', () => {
  it('retains explicit zero values without inventing a clean history check', () => {
    const history = resource({ autoCheckReport: { dataState: 'current', score: 0, ownerCount: 0, lastReportedOdometer: 0, checks: [] } }, 'autocheck');
    expect(history.score).toEqual({ value: 0, range: undefined });
    expect(history.facts).toEqual(['Score 0', '0 owners', 'Last reported 0 mi']);
    expect(history.compactFacts).toEqual(['Score 0 · 0 owners', 'Last reported 0 mi']);
    expect(history.hasCapturedData).toBe(true);
    expect(history.facts.join(' ')).not.toMatch(/clean|no accidents|no damage|clear/i);
    const sticker = resource({ windowSticker: { dataState: 'current', totalMsrp: 0, pricingCurrency: 'USD' } }, 'window-sticker');
    expect(sticker.facts[0]).toMatch(/^USD\s0 MSRP$/);
  });

  it('does not treat missing, empty, or non-finite history facts as captured checks', () => {
    expect(vehicleResourceCatalog(vehicle()).find(entry => entry.id === 'autocheck')).toBeUndefined();
    const history = resource({ autoCheckReport: { dataState: 'incomplete', score: NaN, ownerCount: Infinity, checks: [{label:'Title check'}] } }, 'autocheck');
    expect(history.hasCapturedData).toBe(false);
    expect(history.facts).toEqual([]);
    expect(history.compactFacts).toEqual([]);
    expect(history.score).toBeUndefined();
    expect(history.sourceNote).toBe('Partial captured record · No report details captured');
  });

  it('prioritizes captured title and odometer hazards over a high score or a clear accident result', () => {
    const history = resource({ autoCheckReport: { dataState: 'stale', score: 91, ownerCount: 1, usage: 'Personal', reportRunAt: '2026-08-30', checks: [
      {label:'Accident check', status:'No accidents reported'},
      {label:'Title check', status:'Salvage brand reported'},
      {label:'Odometer check', status:'Odometer discrepancy reported'},
    ] } }, 'autocheck');
    expect(history.compactFacts).toEqual(['Title check: Salvage brand reported', 'Odometer check: Odometer discrepancy reported']);
    expect(history.facts[0]).toBe('Score 91');
    expect(history.facts).toContain('Accident check: No accidents reported');
    expect(history.sourceNote).toBe('Saved report · refresh at source · Report run Aug 30, 2026');
    expect(history.facts.join(' ')).not.toMatch(/refresh at source|Report run/);
  });

  it('does not hide a warning in the detail beneath a nominally clear status', () => {
    const history = resource({ autoCheckReport: { dataState: 'incomplete', ownerCount: 2, checks: [
      {label:'Accident check',status:'No issues found'},
      {label:'Title check',status:'No issues found',detail:'Salvage title reported by state source'},
    ] } }, 'autocheck');
    expect(history.compactFacts[0]).toBe('Title check: No issues found · Salvage title reported by state source');
    expect(history.sourceNote).toBe('Partial captured record');
  });

  it('surfaces a positive accident record before clean checks without deriving new outcome text', () => {
    const history = resource({ autoCheckReport: { dataState: 'current', ownerCount: 1, usage: 'Rental', lastReportedOdometer: 12450, lastReportedOdometerDate:'2026-08-29', checks: [
      {label:'Title check',status:'No title brands found'},
      {label:'Accident check',status:'1 record reported'},
    ] } }, 'autocheck');
    expect(history.compactFacts[0]).toBe('Accident check: 1 record reported');
    expect(history.compactFacts[1]).toBe('1 owner');
    expect(history.facts).toContain('1 owner · Rental');
    expect(history.facts).toContain('Last reported 12,450 mi · Aug 29, 2026');
    expect(history.facts).toContain('Title check: No title brands found');
  });

  it('exposes original sticker price, group, actual options and powertrain without borrowing vehicle facts', () => {
    const sticker = resource({ windowSticker: { dataState:'current', totalMsrp:68420, pricingCurrency:'CAD', equipmentGroup:'502A', options:['Trailer Tow Package','Heated front seats','Trailer Tow Package'], engine:'3.5L EcoBoost V6', transmission:'10-speed automatic', warranty:['3 years / 60,000 km'] } }, 'window-sticker');
    expect(sticker.compactFacts).toEqual([expect.stringMatching(/^CAD\s68,420 MSRP · 502A$/), 'Trailer Tow Package · Heated front seats']);
    expect(sticker.facts).toContain('3.5L EcoBoost V6 · 10-speed automatic');
    expect(sticker.facts).toContain('Printed warranty: 3 years / 60,000 km');
    expect(sticker.facts.filter(fact => fact === 'Trailer Tow Package')).toHaveLength(1);
    expect(sticker.facts.join(' ')).not.toContain('captured options');
  });

  it('keeps unavailable sticker context separate from source facts and preserves URL guards', () => {
    const sticker = resource({ windowSticker: { dataState:'unavailable', url:'https://carfax.com/report', sourceMessage:'Original not published for this VIN', failureReason:'Lookup returned no document' } }, 'window-sticker');
    expect(sticker.href).toBeNull();
    expect(sticker.hasCapturedData).toBe(false);
    expect(sticker.facts).toEqual([]);
    expect(sticker.sourceNote).toContain('Source currently unavailable');
    expect(sticker.sourceNote).toContain('Original not published for this VIN');
  });

  it('uses named vAuto packages and important captured items rather than counts', () => {
    const equipment = resource({ factoryEquipment: { dataState:'stale_unverified', capturedAt:'2026-08-28', isOriginalWindowSticker:false, engine:'2.0L', drivetrain:'AWD', packages:[{name:'Technology Package',code:'66T',features:['360-degree camera']}], sections:[{name:'Equipment',items:[{label:'Floor mats'},{label:'Adaptive cruise control'},{label:'360-degree camera'},{label:'Adaptive cruise control'}]}] } }, 'vauto');
    expect(equipment.compactFacts).toEqual(['Technology Package · 66T', 'Adaptive cruise control · 360-degree camera']);
    expect(equipment.facts).toContain('2.0L · AWD');
    expect(equipment.facts.filter(fact => fact === 'Adaptive cruise control')).toHaveLength(1);
    expect(equipment.sourceNote).toBe('Informational · not an original sticker · Saved report · refresh at source · Captured Aug 28, 2026');
  });

  it('puts actual open OASIS codes and descriptions first while retaining exact coverage/date evidence', () => {
    const oasis = resource({ fordOasis:{dataState:'current',capturedAt:'2026-08-30',warrantyStartDate:'14-MAR-2024',buildDate:'20-FEB-2024',openFieldServiceActions:[{code:'DEMO-24A',description:'Synthetic camera inspection'}],warrantyCoverages:[{type:'Powertrain',description:'5 years / 60,000 miles'}],monthsInService:0,saleMileage:0} }, 'oasis');
    expect(oasis.compactFacts).toEqual(['Open FSA DEMO-24A · Synthetic camera inspection','Warranty start 14-MAR-2024']);
    expect(oasis.facts).toContain('Built 20-FEB-2024');
    expect(oasis.facts).toContain('Recorded coverage: Powertrain · 5 years / 60,000 miles');
    expect(oasis.facts).toContain('0 months in service at capture');
    expect(oasis.facts).toContain('0 mi at sale');
    expect(oasis.facts.join(' ')).not.toMatch(/active coverage|verified today/i);
  });

  it.each([undefined, 'current', 'incomplete', 'unknown'])('does not equate an undated %s empty OASIS array with a captured zero result', state => {
    const oasis = resource({fordOasis:{dataState:state,openFieldServiceActions:[],warrantyCoverages:[]}},'oasis');
    expect(oasis.hasCapturedData).toBe(false);
    expect(oasis.facts).toEqual([]);
    expect(oasis.compactFacts).toEqual(['DealerConnection sign-in']);
    expect(oasis.sourceNote).toContain('No OASIS report details captured');
  });

  it('reports zero only from a complete dated OASIS capture, never as current safety or availability', () => {
    const oasis = resource({fordOasis:{dataState:'stale',capturedAt:'2026-08-30',openActionsCaptured:true,openFieldServiceActions:[]}},'oasis');
    expect(oasis.facts).toEqual(['0 open Ford actions in captured report']);
    expect(oasis.sourceNote).toBe('Saved report · refresh at source · Captured Aug 30, 2026');
    const partial = resource({fordOasis:{dataState:'incomplete',capturedAt:'2026-08-30',warrantyStartDate:'14-MAR-2024',openFieldServiceActions:[]}},'oasis');
    expect(partial.facts).toEqual(['Warranty start 14-MAR-2024']);
    expect(partial.sourceNote).toContain('Open-action result not captured');
  });

  it.each([undefined, false])('does not treat a legacy or default empty action array with flag %s as a captured zero', openActionsCaptured => {
    const oasis = resource({fordOasis:{dataState:'current',capturedAt:'2026-08-30',warrantyStartDate:'14-MAR-2024',openFieldServiceActions:[],openActionsCaptured}},'oasis');
    expect(oasis.facts.join(' ')).not.toContain('0 open');
    expect(oasis.sourceNote).toContain('Open-action result not captured');
  });

  it.each(['9999-01-01', 'not a date', '2026-02-30'])('does not promote the %s capture timestamp into a zero action result', capturedAt => {
    const oasis = resource({fordOasis:{dataState:'current',capturedAt,openActionsCaptured:true,openFieldServiceActions:[]}},'oasis');
    expect(oasis.hasCapturedData).toBe(false);
    expect(oasis.facts).toEqual([]);
    expect(oasis.sourceNote).toMatch(/Future source date|Unrecognized source date/);
    expect(oasis.sourceNote).not.toContain('Captured ');
  });

  it('does not display a reversed score range as a source comparison', () => {
    const history = resource({autoCheckReport:{dataState:'current',score:91,scoreRangeLow:93,scoreRangeHigh:86}},'autocheck');
    expect(history.score).toEqual({value:91,range:undefined});
    expect(history.facts).toEqual(['Score 91']);
  });

  it('keeps synthetic sticker identity and facts explicitly separate from an official original', () => {
    const sticker = resource({vin:'TESTDATAHWELL0001',imageUrl:'/demo-vehicles/f150.png',msrp:68420,trim:'Lariat'},'window-sticker');
    expect(sticker.demo).toBe(true);
    expect(sticker.brand).toBeNull();
    expect(sticker.sourceNote).toBe('Synthetic sample · not an original');
    expect(sticker.compactFacts).toEqual(['F-150 Lariat',expect.stringMatching(/^USD\s68,420 MSRP$/)]);
    expect(sticker.href).toBe('/demo-documents/window-sticker.html?vehicle=TESTDATAHWELL0001');
  });
});
