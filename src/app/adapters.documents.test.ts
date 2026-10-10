import { describe, expect, it } from 'vitest';
import { buildInventorySearchIndex, rankInventorySearch } from '../features/inventory/inventory-search';
import type { BootstrapData, VehicleRecord } from '../types';
import { toInventoryVehicle } from './adapters';

describe('OASIS action capture provenance', () => {
  it('retains CARFAX status-only coverage categories with unknown balances', () => {
    const record = sourceVehicle();
    record.warrantyCheck = { mileageEntered: 25000, carfax: { coverages: [
      { type: 'Basic Warranty', status: 'EXPIRED' },
      { type: 'Corrosion', status: 'N/A' },
      { type: 'Emissions', status: 'ACTIVE', termMiles: 80000 },
    ] } };
    expect(toInventoryVehicle(record, sourceData()).warrantyCheck?.carfax?.coverages).toEqual([
      expect.objectContaining({ type: 'Basic Warranty', status: 'EXPIRED', termText: 'Unknown', remainingMilesText: 'Unknown', remainingTimeText: 'Unknown' }),
      expect.objectContaining({ type: 'Corrosion', status: 'N/A', termText: 'Unknown', remainingMilesText: 'Unknown', remainingTimeText: 'Unknown' }),
      expect.objectContaining({ type: 'Emissions', status: 'ACTIVE', termMiles: 80000, remainingMilesText: 'Unknown' }),
    ]);
  });
  it('fills missing sales specifications from usable VIN documents without overriding the listing', () => {
    const record = sourceVehicle();
    record.engine = 'Published engine';
    record.windowSticker = { dataState: 'current', engine: 'Sticker engine', transmission: '10-speed automatic', exteriorColor: 'Oxford White' };
    const mapped = toInventoryVehicle(record, sourceData());
    expect(mapped).toMatchObject({ engine: 'Published engine', transmission: '10-speed automatic', exteriorColor: 'Oxford White' });
    record.windowSticker.dataState = 'incomplete';
    record.factoryEquipment!.dataState = 'incomplete';
    expect(toInventoryVehicle(record, sourceData()).transmission).toBeNull();
  });
  it('keeps optional technical OASIS facts source-specific without deriving missing values from listing specs', () => {
    const record = sourceVehicle();
    const technicalFields = {
      bodyStyle: 'CREW CAB', driveType: '4X4', paintColor: 'SYNTHETIC WHITE', paintCode: 'YZ',
      engine: '3.5L V6', engineCalibration: 'DEMO-CAL', transmission: '10 SPEED',
      axleRatio: '3.73', axleCode: 'EL', grossVehicleWeight: '7,400 LB', wheelSize: '20 IN',
      tire: '275/60R20', syncVersion: 'SYNC 4', fuelType: 'GASOLINE',
    };
    record.fordOasis = { dataState: 'current', capturedAt: '2026-08-30T08:00:00Z', ...technicalFields };
    const original = JSON.stringify(record);
    expect(toInventoryVehicle(record, sourceData()).fordOasis).toMatchObject(technicalFields);
    expect(JSON.stringify(record)).toBe(original);
    record.engine = 'Listing-only engine';
    record.fordOasis.engine = null;
    record.fordOasis.engineCalibration = '  ';
    expect(toInventoryVehicle(record, sourceData()).fordOasis).toMatchObject({ engine: null, engineCalibration: null });
  });
  it.each([undefined, false, true])('preserves capture flag %s independently of normalized empty arrays', openActionsCaptured => {
    const record = sourceVehicle();
    record.fordOasis = { dataState: 'current', capturedAt: '2026-08-30T08:00:00Z', openFieldServiceActions: [], openActionsCaptured };
    expect(toInventoryVehicle(record, sourceData()).fordOasis).toMatchObject({ openFieldServiceActions: [], openActionsCaptured: openActionsCaptured === true });
  });

  it('never upgrades missing or dropped invalid actions into a captured zero', () => {
    const record = sourceVehicle();
    record.fordOasis = { dataState: 'current', capturedAt: '2026-08-30T08:00:00Z', openActionsCaptured: true };
    expect(toInventoryVehicle(record, sourceData()).fordOasis?.openActionsCaptured).toBe(false);
    record.fordOasis.openFieldServiceActions = [{ code: ' ' }];
    expect(toInventoryVehicle(record, sourceData()).fordOasis).toMatchObject({ openFieldServiceActions: [], openActionsCaptured: false });
  });
});

function sourceVehicle(): VehicleRecord {
  return {
    vin: 'TESTDATASYN000001',
    stockNumber: 'HT0529A',
    year: 2026,
    make: 'Ford',
    model: 'Explorer',
    trim: 'Active',
    vehicleName: '2026 Ford Explorer Active',
    publicStore: 'Howell',
    homeStore: 'Howell',
    homeStoreConfirmed: true,
    sourceReportedLocation: 'Howell',
    websiteStatus: 'Available',
    publicListingState: 'Listed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'No current hold', backupCount: 0 },
    // The server's shape for a vehicle with no transfer: a plain source report,
    // never app custody (see movementSummary in server/service-core.mjs).
    movement: {
      state: 'source_reported',
      label: 'Source-reported location',
      currentLocation: 'Howell',
      locationConfidence: 'reported',
    },
    autoCheckReport: {
      url: 'https://www.autocheck.com/report/TESTDATASYN000001',
      dataState: 'current',
      score: 92,
      usage: 'Personal',
      checks: [{ label: 'Open recall check', status: 'No open recalls' }],
    },
    windowSticker: {
      url: 'https://www.bobmaxeyfordhowell.com/window-sticker/TESTDATASYN000001.pdf',
      dataState: 'current',
      equipmentGroup: 'Equipment Group 200A',
      options: ['Active Comfort Package'],
    },
    factoryEquipment: {
      dataState: 'current',
      url: 'https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg',
      sourceLabel: 'vAuto Factory Equipment',
      capturedAt: '2026-08-30T08:47:00-04:00',
      vehicleDescription: '2026 Ford Explorer Active 4WD',
      basePrice: 41220,
      totalOptions: 2995,
      destinationCharge: 1595,
      totalMsrp: 45810,
      exteriorColor: 'Vapor Blue Metallic',
      interiorColor: 'Dark Space Gray',
      engine: '2.3L EcoBoost I-4',
      transmission: '10-speed automatic',
      drivetrain: 'Intelligent Four-Wheel Drive',
      packages: [
        {
          name: 'Active Comfort Package',
          code: '65A',
          price: 2495,
          features: ['Heated steering wheel', 'Remote start system'],
        },
        { name: '   ', code: 'DROP', features: ['Do not index'] },
      ],
      sections: [
        {
          name: 'Safety and Security',
          items: [
            { label: 'BLIS with Cross-Traffic Alert' },
            { label: '   ', price: 20 },
            { label: '360-Degree Camera', price: 500 },
          ],
        },
        { name: 'Empty section', items: [{ label: '  ' }] },
      ],
      disclaimer: 'Equipment data is informational and should be verified on the vehicle.',
      isOriginalWindowSticker: false,
    },
  };
}

function sourceData(): BootstrapData {
  return {
    meta: {
      reportDate: '2026-08-30',
      completedAt: '2026-08-30T09:00:00-04:00',
      timezone: 'America/New_York',
      publicFreshness: 'current',
      dealerMailFreshness: 'current',
      publicCount: 1,
      crmCount: 1,
      heldVinCount: 0,
      publicChangeCounts: {
        newArrival: 0,
        removed: 0,
        priceChange: 0,
        mileageChange: 0,
        websiteStatusChange: 0,
        stockCorrection: 0,
        storeTransfer: 0,
      },
      holdChangeStatus: 'current',
      warnings: [],
    },
    stores: [],
    vehicles: [],
    transfers: [],
    attention: [],
  };
}

describe('official document adapter', () => {
  it('maps document resources and indexes public parsed facts for predictive search', () => {
    const mapped = toInventoryVehicle(sourceVehicle(), sourceData());

    expect(mapped.autoCheckReport).toMatchObject({ dataState: 'current', score: 92, usage: 'Personal' });
    expect(mapped.windowSticker).toMatchObject({ dataState: 'current', equipmentGroup: 'Equipment Group 200A' });
    expect(mapped.factoryEquipment).toMatchObject({
      dataState: 'current',
      url: 'https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg',
      sourceLabel: 'vAuto Factory Equipment',
      isOriginalWindowSticker: false,
      packages: [{ name: 'Active Comfort Package', code: '65A', price: 2495 }],
      sections: [{ name: 'Safety and Security', items: [{ label: 'BLIS with Cross-Traffic Alert' }, { label: '360-Degree Camera', price: 500 }] }],
    });
    expect(mapped.factoryEquipment?.packages).toHaveLength(1);
    expect(mapped.factoryEquipment?.sections).toHaveLength(1);
    const index = buildInventorySearchIndex([mapped]);
    for (const query of [
      'AutoCheck score 92',
      'no open recalls',
      'Equipment Group 200A',
      'vAuto Factory Equipment',
      '15fe2ec7',
      '2026-08-30T08:47',
      '2026 Ford Explorer Active 4WD',
      '41220',
      '2995',
      '1595',
      '45810',
      'Vapor Blue Metallic',
      'Dark Space Gray',
      '2.3L EcoBoost',
      '10-speed automatic',
      'Intelligent Four-Wheel Drive',
      '65A',
      'Heated steering wheel',
      'Remote start system',
      'Safety and Security',
      'BLIS Cross-Traffic',
      '360-Degree Camera',
      '500',
      'informational should be verified',
      'not original window sticker',
    ]) {
      expect(rankInventorySearch(index, query)).toHaveLength(1);
    }
    expect(rankInventorySearch(index, 'Do not index')).toHaveLength(0);
    expect(rankInventorySearch(index, 'Empty section')).toHaveLength(0);
  });

  it('indexes vehicle-specific warranty facts without turning generic coverage terms into lot-wide matches', () => {
    const coverage = {
      type: 'Bumper-to-Bumper',
      termText: '36 months / 36,000 miles',
      termMonths: 36,
      termMiles: 36000,
      remainingMiles: 33948,
      remainingMonths: 22,
      remainingMilesText: 'No miles left',
      remainingTimeText: 'No time left',
      status: 'EXPIRED' as const,
    };
    const record = sourceVehicle();
    record.warrantyCheck = {
      dataState: 'current',
      capturedAt: '2026-09-12T15:00:00Z',
      sourceLabel: 'Warranty check',
      mileageEntered: 2052,
      mileageSource: 'listed odometer',
      autoCheck: { inServiceDate: '2024-03-14', inServiceAgeMonths: 30, coverages: [coverage] },
      carfax: { inServiceDate: '2024-04-15', coverages: [{ ...coverage, type: 'Powertrain', termText: '5 years / 60,000 miles', termMiles: 60000 }] },
      fordOasis: { warrantyStartDate: '14-March-2024', monthsInService: 30, coverages: [coverage] },
    };

    const index = buildInventorySearchIndex([toInventoryVehicle(record, sourceData())]);

    expect(rankInventorySearch(index, '2024-03-14')).toHaveLength(1);
    expect(rankInventorySearch(index, '2024-04-15')).toHaveLength(1);
    expect(rankInventorySearch(index, '14-March-2024')).toHaveLength(1);
    for (const generic of ['expired', '36,000', '36000', 'Bumper-to-Bumper', 'Powertrain', '60,000', '5 years', 'No time left', 'listed odometer', 'warranty check coverage']) {
      expect(rankInventorySearch(index, generic)).toEqual([]);
    }
  });

  it('uses public snapshot freshness when a resource has no separate freshness value', () => {
    const record = sourceVehicle();
    delete record.autoCheckReport?.dataState;
    const data = sourceData();
    data.meta.publicFreshness = 'stale_unverified';

    expect(toInventoryVehicle(record, data).autoCheckReport?.dataState).toBe('stale');
  });

  it('keeps CRM-side factory-equipment freshness independent from public listing freshness', () => {
    const record = sourceVehicle();
    delete record.factoryEquipment?.dataState;
    record.listingUrl = undefined;
    record.publicListingState = 'Not listed';
    const data = sourceData();
    data.meta.publicFreshness = 'incomplete';
    data.meta.dealerMailFreshness = 'current';

    const mapped = toInventoryVehicle(record, data);
    expect(mapped.publicListing.dataState).toBe('incomplete');
    expect(mapped.factoryEquipment?.dataState).toBe('current');

    record.factoryEquipment!.dataState = 'stale_unverified';
    data.meta.publicFreshness = 'current';
    expect(toInventoryVehicle(record, data).factoryEquipment?.dataState).toBe('stale');
  });

  it('rejects a non-CAI factory-equipment URL while retaining the safe parsed facts', () => {
    const record = sourceVehicle();
    record.factoryEquipment!.url = 'https://evil.example/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg';

    const mapped = toInventoryVehicle(record, sourceData());
    expect(mapped.factoryEquipment?.url).toBeNull();
    expect(mapped.factoryEquipment?.packages?.[0]?.name).toBe('Active Comfort Package');
  });

  it('preserves last-verified hold evidence when the DealerMail snapshot is stale', () => {
    const record = sourceVehicle();
    record.hold = {
      state: 'stale',
      label: 'Last verified hold — confirm in DealerMail',
      backupCount: 1,
      canViewEvidence: true,
    };
    record.privateEvidence = {
      primary: {
        salesperson: 'Example Salesperson',
        customerOrReason: 'Example reason',
        holdDate: '2026-08-29',
        expectedDate: '2026-09-02',
      },
      backups: [{ order: 2, salesperson: 'Backup Salesperson', customerOrReason: 'Backup reason' }],
      comments: [{ text: 'Example comment' }],
      alerts: [{ text: 'Example alert' }],
      cdk: { status: 'S' },
    };
    const data = sourceData();
    data.meta.dealerMailFreshness = 'stale_unverified';

    const mapped = toInventoryVehicle(record, data);

    expect(mapped.dealerMail.hasActiveHold).toBeNull();
    expect(mapped.holdEvidence).toHaveLength(2);
    expect(mapped.holdEvidence?.[0]).toMatchObject({
      dataState: 'stale',
      lifecycleStatus: 'last_verified_active',
      salesperson: 'Example Salesperson',
      customerOrReason: 'Example reason',
      commentFlag: true,
      alertFlag: true,
      cdkState: 'S',
    });
    expect(mapped.holdEvidence?.[1]).toMatchObject({
      dataState: 'stale',
      position: 'backup',
      salesperson: 'Backup Salesperson',
    });
  });

  it('preserves detail-only public scan provenance and data status', () => {
    const record = sourceVehicle();
    record.dataStatus = 'Current public inventory';
    record.publicScan = {
      actualLocation: 'Bob Maxey Ford of Howell',
      locationCity: 'Howell',
      dealerLocationId: 21521,
      dealerName: 'Bob Maxey Ford of Howell',
      vehicleId: 123456,
      genericColor: 'Blue',
      sourceSites: ['Howell', 'Ford Detroit'],
      sourceCount: 2,
      firstSeen: '2026-08-27',
      lastSeen: '2026-08-30',
    };

    const mapped = toInventoryVehicle(record, sourceData());

    expect(mapped.dataStatus).toBe('Current public inventory');
    expect(mapped.publicScan).toEqual(record.publicScan);
  });

  it('keeps vehicle comments and historical evidence separate from a current hold', () => {
    const record = sourceVehicle();
    record.hold.canViewEvidence = true;
    record.privateEvidence = {
      primary: null, backups: [],
      comments: [{ text: 'Synthetic vehicle inspection note' }],
      alerts: [{ text: 'Synthetic vehicle transport restriction' }],
      history: [{ orderRaw: '1', customerOrReason: 'Synthetic historical customer reason', statusLabel: 'Not in current live hold set; outcome unknown' }],
    };
    const mapped = toInventoryVehicle(record, sourceData());
    expect(mapped.holdEvidence).toEqual([]);
    expect(mapped.dealerMail.hasActiveHold).toBe(false);
    expect(mapped.dealerMailEvidence?.alerts).toHaveLength(1);
    const index = buildInventorySearchIndex([mapped]);
    expect(rankInventorySearch(index, 'Synthetic historical customer reason')).toHaveLength(1);
    expect(rankInventorySearch(index, 'Synthetic vehicle transport restriction')).toHaveLength(1);
    record.hold.canViewEvidence = false;
    expect(toInventoryVehicle(record, sourceData()).dealerMailEvidence).toBeUndefined();
  });
});


describe('provider report fallbacks', () => {
  it('maps CARFAX-only warranty and service events without populating OEM coverage', () => {
    const record = sourceVehicle();
    record.fordOasis = undefined;
    record.warrantyCheck = { mileageEntered: 21000, dataState: 'current', carfax: { coverages: [{ type: 'Powertrain', termText: '5 years / 60000 miles', remainingMilesText: '39000 miles', remainingTimeText: '18 months', status: 'ACTIVE' }] } };
    record.serviceHistory = { reports: [{ vin: record.vin, provider: 'carfax', sourceLabel: 'Synthetic CARFAX', capturedAt: '2026-08-30T14:00:00Z', dataState: 'current', historyStatus: 'reported', entries: [{ date: '2026-07-12', services: ['Synthetic oil service'] }] }] };
    const mapped = toInventoryVehicle(record, sourceData());
    expect(mapped.warrantyCheck?.carfax?.coverages[0].type).toBe('Powertrain');
    expect(mapped.warrantyCheck?.fordOasis).toBeNull();
    expect(mapped.serviceHistory?.reports[0].entries[0].services).toEqual(['Synthetic oil service']);
    expect(mapped.authorizedSearchText).toContain('Synthetic oil service');
  });
});
