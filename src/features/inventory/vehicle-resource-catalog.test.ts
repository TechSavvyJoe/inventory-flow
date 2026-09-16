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
    expect(history.sourceNote).toBeNull();
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
    expect(history.sourceNote).toBeNull();
    expect(history.facts.join(' ')).not.toMatch(/refresh at source|Report run/);
  });

  it('does not hide a warning in the detail beneath a nominally clear status', () => {
    const history = resource({ autoCheckReport: { dataState: 'incomplete', ownerCount: 2, checks: [
      {label:'Accident check',status:'No issues found'},
      {label:'Title check',status:'No issues found',detail:'Salvage title reported by state source'},
    ] } }, 'autocheck');
    expect(history.compactFacts[0]).toBe('Title check: No issues found · Salvage title reported by state source');
    expect(history.sourceNote).toBeNull();
  });

  it('surfaces a positive accident record before clean checks without deriving new outcome text', () => {
    const history = resource({ autoCheckReport: { dataState: 'current', ownerCount: 1, usage: 'Rental', lastReportedOdometer: 12450, lastReportedOdometerDate:'2026-08-29', checks: [
      {label:'Title check',status:'No title brands found'},
      {label:'Accident check',status:'1 record reported'},
    ] } }, 'autocheck');
    expect(history.compactFacts[0]).toBe('Accident check: 1 record reported');
    expect(history.compactFacts[1]).toBe('1 owner · Rental');
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

  it('deduplicates an equipment group in summaries without deleting the priced source option', () => {
    const sticker = resource({ windowSticker: { dataState:'current', equipmentGroup:'502A 4,805.00', options:['EQUIPMENT GROUP 502A — $4,805.00', 'Twin panel moonroof'], totalMsrp:68420, pricingCurrency:'CAD' } }, 'window-sticker');
    expect(sticker.summaryFacts).toEqual(['CAD 68,420 MSRP · 502A 4,805.00', 'Twin panel moonroof']);
    expect(sticker.compactFacts).toEqual(['CAD 68,420 MSRP · 502A 4,805.00', 'Twin panel moonroof']);
    expect(sticker.facts).toContain('EQUIPMENT GROUP 502A — $4,805.00');
    const groupOnly = resource({windowSticker:{dataState:'current',equipmentGroup:'302A',options:['EQUIPMENT GROUP 302A']}},'window-sticker');
    expect(groupOnly.compactFacts).toEqual(['302A']);
  });

  it('shows concise history facts, service evidence and one matching last odometer while retaining full checks', () => {
    const history = resource({autoCheckReport:{dataState:'current',ownerCount:1,usage:'Lease',lastReportedOdometer:9192,lastReportedOdometerDate:'2026-09-10',checks:[
      {label:'State Title Brand',status:'Clean'},
      {label:'Accident / Damage',status:'No Issue',detail:'No Accidents or Damage Reported'},
      {label:'Service',status:'4 records reported'},
      {label:'Odometer Check',status:'No Issue',detail:'Last reported odometer: 9,192 (09/10/2026)'},
    ]}},'autocheck');
    expect(history.summaryFacts).toEqual(['State Title Brand: Clean','Accident / Damage: No Accidents or Damage Reported','1 owner · Lease','Service: 4 records reported','Odometer Check: No Issue','Last reported 9,192 mi · Sep 10, 2026']);
    expect(history.summaryFacts!.join(' ').match(/9,192/g)).toHaveLength(1);
    expect(history.facts).toContain('Odometer Check: No Issue · Last reported odometer: 9,192 (09/10/2026)');
  });

  it('never deduplicates a different historical odometer or suppresses its discrepancy warning', () => {
    const history = resource({autoCheckReport:{dataState:'current',lastReportedOdometer:9192,checks:[{label:'Odometer',status:'No Issue',detail:'Odometer discrepancy reported; Last reported odometer: 100,000 (09/01/2026)'}]}},'autocheck');
    expect(history.summaryFacts![0]).toContain('Odometer discrepancy reported');
    expect(history.summaryFacts![0]).toContain('100,000');
    expect(history.summaryFacts).toContain('Last reported 9,192 mi');
    const anotherDate = resource({autoCheckReport:{dataState:'current',lastReportedOdometer:9192,lastReportedOdometerDate:'2026-09-10',checks:[{label:'Odometer',status:'No Issue',detail:'Last reported odometer: 9,192 (09/01/2026)'}]}},'autocheck');
    expect(anotherDate.summaryFacts!.join(' ')).toContain('9,192 (09/01/2026)');
  });

  it('places relevant OASIS actions, warranty start and coverage ahead of build metadata', () => {
    const oasis=resource({fordOasis:{dataState:'current',capturedAt:'2026-09-01',warrantyStartDate:'08-AUG-2023',buildDate:'01-JUL-2023',openFieldServiceActions:[{code:'TEST-24N',description:'Synthetic inspection'}],warrantyCoverages:[{type:'Powertrain',description:'5 years / 60,000 miles'}]}},'oasis');
    expect(oasis.summaryFacts).toEqual(['Open FSA TEST-24N · Synthetic inspection','Warranty start 08-AUG-2023','Coverage: Powertrain · 5 years / 60,000 miles']);
    expect(oasis.facts).toContain('Built 01-JUL-2023');
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
    expect(equipment.compactFacts).toEqual(['Technology Package · 66T']);
    expect(equipment.facts).toContain('2.0L · AWD');
    expect(equipment.facts.filter(fact => fact === 'Adaptive cruise control')).toHaveLength(1);
    expect(equipment.sourceNote).toBeNull();
  });

  it('puts actual open OASIS codes and descriptions first while retaining exact coverage/date evidence', () => {
    const oasis = resource({ fordOasis:{dataState:'current',capturedAt:'2026-08-30',warrantyStartDate:'14-MAR-2024',buildDate:'20-FEB-2024',openFieldServiceActions:[{code:'DEMO-24A',description:'Synthetic camera inspection'}],warrantyCoverages:[{type:'Powertrain',description:'5 years / 60,000 miles'}],monthsInService:0,saleMileage:0} }, 'oasis');
    expect(oasis.compactFacts).toEqual(['Open FSA DEMO-24A · Synthetic camera inspection']);
    expect(oasis.facts).toContain('Built 20-FEB-2024');
    expect(oasis.facts).toContain('Coverage: Powertrain · 5 years / 60,000 miles');
    expect(oasis.facts).toContain('0 months in service');
    expect(oasis.facts).toContain('0 mi at sale');
    expect(oasis.facts.join(' ')).not.toMatch(/active coverage|verified today/i);
  });

  it('decodes OASIS display descriptions without changing captured evidence', () => {
    const fordOasis = {
      dataState: 'current', capturedAt: '2026-09-01',
      openFieldServiceActions: [{ code: 'TEST-26A', description: 'REAR AXLE &#x25B4; &amp; HUB' }],
      warrantyCoverages: [{ type: 'Powertrain', description: '5 years &amp; 60,000 miles' }],
    };
    const oasis = resource({ fordOasis }, 'oasis');
    expect(oasis.compactFacts[0]).toBe('Open FSA TEST-26A · REAR AXLE ▴ & HUB');
    expect(oasis.facts).toContain('Coverage: Powertrain · 5 years & 60,000 miles');
    expect(fordOasis.openFieldServiceActions[0].description).toBe('REAR AXLE &#x25B4; &amp; HUB');
    expect(fordOasis.warrantyCoverages[0].description).toBe('5 years &amp; 60,000 miles');
  });

  it.each([undefined, 'current', 'incomplete', 'unknown'])('does not equate an undated %s empty OASIS array with a captured zero result', state => {
    const oasis = resource({fordOasis:{dataState:state,openFieldServiceActions:[],warrantyCoverages:[]}},'oasis');
    expect(oasis.hasCapturedData).toBe(false);
    expect(oasis.facts).toEqual([]);
    expect(oasis.compactFacts).toEqual([]);
    expect(oasis.sourceNote).toBeNull();
  });

  it('reports zero only from a complete dated OASIS capture, never as current safety or availability', () => {
    const oasis = resource({fordOasis:{dataState:'stale',capturedAt:'2026-08-30',openActionsCaptured:true,openFieldServiceActions:[]}},'oasis');
    expect(oasis.facts).toEqual(['No open Ford actions']);
    expect(oasis.sourceNote).toBeNull();
    const partial = resource({fordOasis:{dataState:'incomplete',capturedAt:'2026-08-30',warrantyStartDate:'14-MAR-2024',openFieldServiceActions:[]}},'oasis');
    expect(partial.facts).toEqual(['Warranty start 14-MAR-2024']);
    expect(partial.sourceNote).toBeNull();
  });

  it.each([undefined, false])('does not treat a legacy or default empty action array with flag %s as a captured zero', openActionsCaptured => {
    const oasis = resource({fordOasis:{dataState:'current',capturedAt:'2026-08-30',warrantyStartDate:'14-MAR-2024',openFieldServiceActions:[],openActionsCaptured}},'oasis');
    expect(oasis.facts.join(' ')).not.toContain('0 open');
    expect(oasis.sourceNote).toBeNull();
  });

  it.each(['9999-01-01', 'not a date', '2026-02-30'])('does not promote the %s capture timestamp into a zero action result', capturedAt => {
    const oasis = resource({fordOasis:{dataState:'current',capturedAt,openActionsCaptured:true,openFieldServiceActions:[]}},'oasis');
    expect(oasis.hasCapturedData).toBe(false);
    expect(oasis.facts).toEqual([]);
    expect(oasis.sourceNote).toBeNull();
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
