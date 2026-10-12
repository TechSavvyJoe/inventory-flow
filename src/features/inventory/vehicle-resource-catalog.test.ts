import { describe, expect, it } from 'vitest';
import { vehicleOverviewResources, vehicleResourceCatalog, type VehicleResource, type VehicleResourceVehicle } from './vehicle-resource-catalog';

const vehicle = (fields: Partial<VehicleResourceVehicle> = {}): VehicleResourceVehicle => ({
  vin: '1FTFW1E84RKF12345', make: 'Ford', model: 'F-150', year: 2024, ...fields,
});
function resource(fields: Partial<VehicleResourceVehicle>, id: VehicleResource['id']) {
  const value = vehicleResourceCatalog(vehicle(fields)).find(entry => entry.id === id);
  expect(value, `Expected ${id} source`).toBeDefined();
  return value!;
}

describe('rich vehicle resource catalog', () => {
  it('keeps captured synthetic OASIS facts while omitting a live source destination', () => {
    const oasis = resource({
      vin: 'TESTDATASYN000001',
      make: 'Ford',
      fordOasis: { dataState: 'current', sourceLabel: 'Synthetic fabricated record', warrantyCoverages: [{ type: 'Powertrain', description: 'Synthetic coverage' }] },
    }, 'oasis');
    expect(oasis.href).toBeNull();
    expect(oasis.action).toBe('Open OASIS');
    expect(oasis.hasCapturedData).toBe(true);
    expect(oasis.facts).toContain('Coverage: Powertrain · Synthetic coverage');
  });

  it('uses the private saved invoice when the daily exact-VIN copy is available', () => {
    const invoice = resource({ fordInvoice: {
      dataState: 'current', available: true, capturedAt: '2026-09-21T20:45:00Z', sourceLabel: 'Saved Ford factory invoice',
    } }, 'invoice');
    expect(invoice.href).toBe('/api/vehicles/1FTFW1E84RKF12345/invoice');
    expect(invoice.action).toBe('Open saved invoice');
    expect(invoice.subtitle).toBe('Saved factory invoice');
    expect(invoice.sourceNote).toContain('Saved 09/21/2026');
  });

  it('retains explicit zero values without inventing a clean history check', () => {
    const history = resource({ autoCheckReport: { dataState: 'current', score: 0, ownerCount: 0, lastReportedOdometer: 0, checks: [] } }, 'autocheck');
    expect(history.score).toEqual({ value: 0, range: undefined });
    expect(history.facts).toEqual(['Score 0', '0 owners', 'Last reported 0 mi']);
    expect(history.compactFacts).toEqual(['Score 0 · 0 owners', 'Last reported 0 mi']);
    expect(history.hasCapturedData).toBe(true);
    expect(history.facts.join(' ')).not.toMatch(/clean|no accidents|no damage|clear/i);
    const sticker = resource({ windowSticker: { dataState: 'current', totalMsrp: 0, pricingCurrency: 'USD' } }, 'window-sticker');
    expect(sticker.facts[0]).toMatch(/^\$0 MSRP$/);
  });

  it('does not treat missing, empty, or non-finite history facts as captured checks', () => {
    expect(vehicleResourceCatalog(vehicle()).find(entry => entry.id === 'autocheck')).toBeUndefined();
    const history = resource({ autoCheckReport: { dataState: 'incomplete', score: NaN, ownerCount: Infinity, checks: [{label:'Title check'}] } }, 'autocheck');
    expect(history.hasCapturedData).toBe(false);
    expect(history.facts).toEqual([]);
    expect(history.compactFacts).toEqual([]);
    expect(history.score).toBeUndefined();
    expect(history.sourceNote).toBe('Partial captured record');
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
    expect(history.sourceNote).toBe('Saved report · refresh at source · Report run 08/30/2026');
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
    expect(history.compactFacts[1]).toBe('1 owner · Rental');
    expect(history.facts).toContain('1 owner · Rental');
    expect(history.facts).toContain('Last reported 12,450 mi · 08/29/2026');
    expect(history.facts).toContain('Title check: No title brands found');
  });

  it('exposes original sticker price, group, actual options and powertrain without borrowing vehicle facts', () => {
    const sticker = resource({ windowSticker: { dataState:'current', totalMsrp:68420, pricingCurrency:'CAD', equipmentGroup:'502A', options:['Trailer Tow Package','Heated front seats','Trailer Tow Package'], engine:'3.5L EcoBoost V6', transmission:'10-speed automatic', warranty:['3 years / 60,000 km'] } }, 'window-sticker');
    expect(sticker.compactFacts).toEqual([expect.stringMatching(/^CAD\s68,420 MSRP · 502A$/), 'Trailer Tow Package · Heated front seats']);
    expect(sticker.facts).toContain('3.5L EcoBoost V6 · 10-speed automatic');
    expect(sticker.facts).toContain('Printed warranty: 3 years / 37,282 mi (60,000 km in the source)');
    expect(sticker.facts.filter(fact => fact === 'Trailer Tow Package')).toHaveLength(1);
    expect(sticker.facts.join(' ')).not.toContain('captured options');
  });

  it('shows every source distance in US miles and keeps the source figure as evidence', () => {
    const sticker = resource({ windowSticker: { dataState:'current', warranty:['5 years / 100,000 km powertrain'], options:['Combined 9.8 L/100 km'] } }, 'window-sticker');
    expect(sticker.facts).toContain('Printed warranty: 5 years / 62,137 mi powertrain (100,000 km in the source)');
    expect(sticker.facts).toContain('Combined 24 mpg (9.8 L/100 km in the source)');
    expect(sticker.facts.join(' ')).not.toMatch(/\d\s*km\b(?! in the source)/);

    const history = resource({ autoCheckReport: { dataState:'current', usage:'Personal · 148 000 km reported', checks:[{ label:'Odometer check', detail:'Last reported odometer: 148,000 km' }] } }, 'autocheck');
    expect(history.facts).toContain('Personal · 91,963 mi reported (148,000 km in the source)');
    expect(history.facts).toContain('Odometer check: Last reported odometer: 91,963 mi (148,000 km in the source)');

    const oasis = resource({ make:'Ford', fordOasis: { dataState:'current', warrantyCoverages:[{ type:'Powertrain', description:'60 months/100,000 km' }], extendedCoverageExpirations:['ESP to 160,000 km'] } }, 'oasis');
    expect(oasis.facts).toContain('Coverage: Powertrain · 60 months/62,137 mi (100,000 km in the source)');
    expect(oasis.facts).toContain('Extended coverage: ESP to 99,419 mi (160,000 km in the source)');
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
    expect(history.summaryFacts).toEqual(['State Title Brand: Clean','Accident / Damage: No Accidents or Damage Reported','1 owner · Lease','Service: 4 records reported','Odometer Check: No Issue','Last reported 9,192 mi · 09/10/2026']);
    expect(history.summaryFacts!.join(' ').match(/9,192/g)).toHaveLength(1);
    expect(history.facts).toContain('Odometer Check: No Issue · Last reported odometer: 9,192 (09/10/2026)');
  });

  it('shows only the dated generic AutoCheck inspection evidence, never its location or provider detail', () => {
    const history = resource({ make: 'Cadillac', autoCheckReport: {
      dataState: 'current', recentInspection: { date: '2026-09-10', types: ['Vehicle Inspected', 'Multiple Point Vehicle Inspection'] },
    }, serviceReadiness: {
      status: 'serviced', readinessEvidence: { source: 'autocheck', inspectionDate: '2026-09-10', types: ['Vehicle Inspected', 'Multiple Point Vehicle Inspection'] },
    } }, 'autocheck');
    expect(history.facts).toContain('AutoCheck inspection 09/10/2026 · Vehicle Inspected · Multiple Point Vehicle Inspection');
    expect(history.summaryRows).toContainEqual({ label: 'Recent inspection', values: ['09/10/2026'], detail: 'Vehicle Inspected · Multiple Point Vehicle Inspection' });
    expect(history.scanFacts).toContain('Inspected 09/10/2026');
  });

  it('does not turn an historic AutoCheck inspection into a current inventory signal', () => {
    const history = resource({ make: 'Chevrolet', autoCheckReport: {
      dataState: 'current', recentInspection: { date: '2025-09-15', types: ['Vehicle Inspected'] },
    }, serviceReadiness: { status: 'needs_service', readinessEvidence: null } }, 'autocheck');
    expect(history.facts.join(' ')).not.toContain('AutoCheck inspection');
    expect(history.summaryRows).not.toContainEqual(expect.objectContaining({ label: 'Recent inspection' }));
    expect(history.scanFacts).not.toContain('Inspected 09/15/2025');
  });

  it('keeps Ford and Lincoln AutoCheck reports without showing competing inspection evidence', () => {
    for (const make of ['Ford', 'Lincoln']) {
      const history = resource({ make, autoCheckReport: {
        dataState: 'current', score: 92, ownerCount: 1,
        recentInspection: { date: '2026-09-10', types: ['Vehicle Inspected'] },
      } }, 'autocheck');
      expect(history.facts).toContain('Score 92');
      expect(history.facts.join(' ')).not.toContain('AutoCheck inspection');
      expect(history.summaryRows).not.toContainEqual(expect.objectContaining({ label: 'Recent inspection' }));
      expect(history.scanFacts).not.toContain('Inspected 09/10/2026');
    }
  });

  it('keeps low-value title administration out of quick AutoCheck summaries without losing the source record', () => {
    const history = resource({ autoCheckReport: { dataState: 'current', score: 90, ownerCount: 1, checks: [
      { label: 'Additional History', status: 'Events Reported', detail: 'Lien Reported · Corrected Title' },
      { label: 'Accident / Damage', status: 'No Issue', detail: 'No accidents or damage reported' },
    ] } }, 'autocheck');
    expect(history.facts.join(' ')).toContain('Lien Reported');
    expect(history.facts.join(' ')).toContain('Corrected Title');
    const quickText = [
      ...(history.summaryFacts ?? []),
      ...(history.compactFacts ?? []),
      ...(history.scanFacts ?? []),
    ].join(' ');
    expect(quickText).not.toMatch(/Lien Reported|Corrected Title/i);
    expect(quickText).toContain('No accidents or damage reported');
    expect((history.summaryRows ?? []).flatMap(row => [row.label, ...row.values, row.detail ?? '']).join(' ')).toMatch(/Lien Reported|Corrected Title/i);
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
    expect(oasis.summaryFacts).toEqual(['Open FSA TEST-24N · Synthetic inspection','Warranty start 08/08/2023','Coverage: Powertrain · 5 years / 60,000 miles']);
    expect(oasis.facts).toContain('Built 07/01/2023');
  });

  it('keeps unavailable sticker context separate from source facts and preserves URL guards', () => {
    const sticker = resource({ windowSticker: { dataState:'unavailable', url:'https://carfax.com/report', sourceMessage:'Original not published for this VIN', failureReason:'Lookup returned no document' } }, 'window-sticker');
    expect(sticker.href).toBeNull();
    expect(sticker.hasCapturedData).toBe(false);
    expect(sticker.facts).toEqual([]);
    expect(sticker.sourceNote).toContain('Source currently unavailable');
    expect(sticker.sourceNote).not.toContain('Original not published for this VIN');
    expect(sticker.sourceNote).not.toContain('Lookup returned no document');
  });

  it('uses the vAuto VIN equipment document when Ford supplies only a placeholder sticker', () => {
    const stickerUrl = 'https://www.bobmaxeyfordinfowlerville.com/api/vhcliaa/inventory/23328/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U';
    const equipmentUrl = 'https://assets.cai-media-management.com/window-stickers/d09817fc-332f-45c1-9e7f-86f0a9e16153.jpg';
    const sources = vehicle({
      windowSticker: { dataState: 'incomplete', url: stickerUrl },
      factoryEquipment: { dataState: 'current', url: equipmentUrl, isOriginalWindowSticker: false },
    });
    expect(resource(sources, 'window-sticker').href).toBeNull();
    const overview = vehicleOverviewResources(sources)[0];
    expect(overview.id).toBe('vauto');
    expect(overview.title).toBe('vAuto equipment');
    expect(overview.href).toBe(equipmentUrl);
    expect(overview.alternateSticker).toBeUndefined();
    expect(overview.equipmentContext).toContain('not an original window sticker');
    expect(vehicleOverviewResources({ ...sources, factoryEquipment: { ...sources.factoryEquipment!, dataState: 'incomplete' } })[0].id).toBe('window-sticker');
  });

  it('uses named vAuto packages and important captured items rather than counts', () => {
    const equipment = resource({ factoryEquipment: { dataState:'stale_unverified', capturedAt:'2026-08-28', isOriginalWindowSticker:false, engine:'2.0L', drivetrain:'AWD', packages:[{name:'Technology Package',code:'66T',features:['360-degree camera']}], sections:[{name:'Equipment',items:[{label:'Floor mats'},{label:'Adaptive cruise control'},{label:'360-degree camera'},{label:'Adaptive cruise control'}]}] } }, 'vauto');
    expect(equipment.compactFacts).toEqual(['Technology Package · 66T', 'Adaptive cruise control']);
    expect(equipment.facts).toContain('2.0L · AWD');
    expect(equipment.facts.filter(fact => fact === 'Adaptive cruise control')).toHaveLength(1);
    expect(equipment.sourceNote).toBe('Saved report · refresh at source · Captured 08/28/2026');
  });

  it('puts actual open OASIS codes and descriptions first while retaining exact coverage/date evidence', () => {
    const oasis = resource({ fordOasis:{dataState:'current',capturedAt:'2026-08-30',warrantyStartDate:'14-MAR-2024',buildDate:'20-FEB-2024',openFieldServiceActions:[{code:'DEMO-24A',description:'Synthetic camera inspection'}],warrantyCoverages:[{type:'Powertrain',description:'5 years / 60,000 miles'}],monthsInService:0,saleMileage:0} }, 'oasis');
    expect(oasis.compactFacts).toEqual(['Open FSA DEMO-24A · Synthetic camera inspection', 'Warranty start 03/14/2024']);
    expect(oasis.facts).toContain('Built 02/20/2024');
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
    expect(oasis.sourceNote).toBe(state === 'incomplete' ? 'Partial captured record' : state === 'unknown' ? 'Source status unknown' : null);
  });

  it('reports zero only from a complete dated OASIS capture, never as current safety or availability', () => {
    const oasis = resource({fordOasis:{dataState:'stale',capturedAt:'2026-08-30',openActionsCaptured:true,openFieldServiceActions:[]}},'oasis');
    expect(oasis.facts).toEqual(['No open Ford actions']);
    expect(oasis.sourceNote).toBe('Saved report · refresh at source · Captured 08/30/2026');
    const partial = resource({fordOasis:{dataState:'incomplete',capturedAt:'2026-08-30',warrantyStartDate:'14-MAR-2024',openFieldServiceActions:[]}},'oasis');
    expect(partial.facts).toEqual(['Warranty start 03/14/2024']);
    expect(partial.sourceNote).toBe('Partial captured record · Captured 08/30/2026');
  });

  it.each([undefined, false])('does not treat a legacy or default empty action array with flag %s as a captured zero', openActionsCaptured => {
    const oasis = resource({fordOasis:{dataState:'current',capturedAt:'2026-08-30',warrantyStartDate:'14-MAR-2024',openFieldServiceActions:[],openActionsCaptured}},'oasis');
    expect(oasis.facts.join(' ')).not.toContain('0 open');
    expect(oasis.sourceNote).toBe('Captured 08/30/2026');
  });

  it.each(['9999-01-01', 'not a date', '2026-02-30'])('does not promote the %s capture timestamp into a zero action result', capturedAt => {
    const oasis = resource({fordOasis:{dataState:'current',capturedAt,openActionsCaptured:true,openFieldServiceActions:[]}},'oasis');
    expect(oasis.hasCapturedData).toBe(false);
    expect(oasis.facts).toEqual([]);
    expect(oasis.sourceNote).toMatch(/Future source date|Unrecognized source date/);
  });

  it('does not display a reversed score range as a source comparison', () => {
    const history = resource({autoCheckReport:{dataState:'current',score:91,scoreRangeLow:93,scoreRangeHigh:86}},'autocheck');
    expect(history.score).toEqual({value:91,range:undefined});
    expect(history.facts).toEqual(['Score 91']);
  });

  it('keeps synthetic sticker identity and facts explicitly separate from an official original', () => {
    const sticker = resource({vin:'TESTDATAHWELL0001',imageUrl:'/demo-vehicles/f150.jpg',msrp:68420,trim:'Lariat'},'window-sticker');
    expect(sticker.demo).toBe(true);
    expect(sticker.brand).toBeNull();
    expect(sticker.sourceNote).toBe('Synthetic sample · not an original');
    expect(sticker.compactFacts).toEqual(['F-150 Lariat',expect.stringMatching(/^\$68,420 MSRP$/)]);
    expect(sticker.href).toBe('/demo-documents/window-sticker.html?vehicle=TESTDATAHWELL0001');
  });
});


describe('combined sticker and equipment source fidelity', () => {
  it('keeps fractional and zero prices and repeated children associated with each package', () => {
    const combined = vehicleOverviewResources(vehicle({ factoryEquipment: {
      dataState: 'current', isOriginalWindowSticker: false, totalMsrp: 55000.50,
      packages: [
        { name: 'Package A', code: 'PKG-A', price: 1250.75, features: ['Shared feature'] },
        { name: 'Package B', code: 'PKG-B', price: 0, features: ['Shared feature'] },
      ],
      sections: [{ name: 'Options', items: [{ label: 'Exact option', price: 199.95 }] }],
    } }))[0];
    expect(combined.stickerDetails?.msrp).toBe('55,000.5');
    expect(combined.stickerDetails?.optionLines).toEqual([
      'Package A · PKG-A · Price 1,250.75', '. Shared feature',
      'Package B · PKG-B · Price 0', '. Shared feature', 'Exact option · Price 199.95',
    ]);
    expect(combined.equipmentContext).toBe('vAuto equipment profile · not an original window sticker');
  });
});
