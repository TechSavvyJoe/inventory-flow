/**
 * Repository-safe Inventory Flow data.
 *
 * Every person, VIN, stock number, note, price, and workflow fact in this file
 * is fabricated. This module deliberately does not read the dealership report
 * workspace, browser state, cookies, or the local runtime database.
 */

import { buildPublicChangeEvents, summarizePublicChangeEvents } from '../server/public-change-events.mjs'

export const SYNTHETIC_FIXTURE_MARKER = 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS'
export const SYNTHETIC_REPORT_DATE = '2026-08-30'
export const SYNTHETIC_NOW = new Date('2026-08-30T10:15:00-04:00')

const STORES = {
  Howell: {
    host: 'www.bobmaxeyfordhowell.com',
    code: 'H',
  },
  Fowlerville: {
    host: 'www.bobmaxeyfordinfowlerville.com',
    code: 'F',
  },
  'Ford Detroit': {
    host: 'www.bobmaxeyford.com',
    code: 'D',
  },
  Lincoln: {
    host: 'www.bobmaxeylincoln.com',
    code: 'L',
  },
}

const VEHICLES = [
  {
    vin: 'TESTDATAHWELL0001',
    stock: 'DEMO-H01',
    store: 'Howell',
    year: 2024,
    make: 'Ford',
    model: 'F-150',
    trim: 'Lariat',
    price: 51800,
    msrp: 68420,
    mileage: 12450,
    exterior: 'Antimatter Blue Metallic',
    interior: 'Black',
    body: 'SuperCrew',
    drivetrain: '4WD',
    engine: '3.5L EcoBoost V6',
    transmission: '10-Speed Automatic',
    fuel: 'Gasoline',
    inventoryDate: '2026-07-18',
    features: 'Ford Co-Pilot360 Assist 2.0 | 360-Degree Camera | Adaptive Cruise Control | Max Trailer Tow Package | Heated and Ventilated Front Seats | B&O Sound System',
  },
  {
    vin: 'TESTDATAHWELL0002',
    stock: 'DEMO-H02',
    store: 'Howell',
    year: 2023,
    make: 'Ford',
    model: 'Bronco Sport',
    trim: 'Badlands',
    price: 31900,
    msrp: 40375,
    mileage: 18920,
    exterior: 'Cactus Gray',
    interior: 'Ebony/Roast',
    body: 'SUV',
    drivetrain: '4WD',
    engine: '2.0L EcoBoost',
    transmission: '8-Speed Automatic',
    fuel: 'Gasoline',
    inventoryDate: '2026-08-30',
    features: 'Badlands Package | Advanced 4x4 | Trail Control | Heated Front Seats | Ford Co-Pilot360 | Class II Trailer Tow Package',
  },
  {
    vin: 'TESTDATAFWELL0001',
    stock: 'DEMO-F01',
    store: 'Fowlerville',
    year: 2025,
    make: 'Ford',
    model: 'Escape',
    trim: 'ST-Line Select',
    price: 34850,
    msrp: 41780,
    mileage: 7200,
    exterior: 'Rapid Red Metallic',
    interior: 'Ebony',
    body: 'SUV',
    drivetrain: 'AWD',
    engine: '2.0L EcoBoost',
    transmission: '8-Speed Automatic',
    fuel: 'Gasoline',
    inventoryDate: '2026-08-19',
    features: 'Tech Pack 2 | 360-Degree Camera | Adaptive Cruise Control | Panoramic Vista Roof | Heated Steering Wheel | Wireless Apple CarPlay',
  },
  {
    vin: 'TESTDATAFWELL0002',
    stock: 'DEMO-F02',
    store: 'Fowlerville',
    year: 2022,
    make: 'Ford',
    model: 'Maverick',
    trim: 'Lariat',
    price: 28750,
    msrp: 34260,
    mileage: 33640,
    exterior: 'Area 51',
    interior: 'Desert Brown',
    body: 'Crew Cab',
    drivetrain: 'AWD',
    engine: '2.0L EcoBoost',
    transmission: '8-Speed Automatic',
    fuel: 'Gasoline',
    inventoryDate: '2026-06-26',
    features: 'Lariat Luxury Package | FX4 Off-Road Package | Ford Co-Pilot360 | 4K Tow Package | Spray-In Bedliner | B&O Sound System',
  },
  {
    vin: 'TESTDATADETRT0001',
    stock: 'DEMO-D01',
    store: 'Ford Detroit',
    year: 2024,
    make: 'Ford',
    model: 'Explorer',
    trim: 'Platinum',
    price: 46900,
    msrp: 58955,
    mileage: 15800,
    exterior: 'Star White Metallic',
    interior: 'Light Sandstone',
    body: 'SUV',
    drivetrain: '4WD',
    engine: '3.0L EcoBoost V6',
    transmission: '10-Speed Automatic',
    fuel: 'Gasoline',
    inventoryDate: '2026-07-30',
    features: 'Premium Technology Package | Active Park Assist 2.0 | 360-Degree Camera | Massaging Front Seats | Twin-Panel Moonroof | Class IV Trailer Tow Package',
  },
  {
    vin: 'TESTDATADETRT0002',
    stock: 'DEMO-D02',
    store: 'Ford Detroit',
    year: 2023,
    make: 'Chevrolet',
    model: 'Silverado 1500',
    trim: 'RST',
    price: 43810,
    msrp: 57390,
    mileage: 22052,
    exterior: 'Glacier Blue Metallic',
    interior: 'Jet Black',
    body: 'Crew Cab',
    drivetrain: '4WD',
    engine: '5.3L V8',
    transmission: '10-Speed Automatic',
    fuel: 'Gasoline',
    inventoryDate: '2026-08-08',
    features: 'All Star Premium Package | Safety Package | Trailering Package | Blind Spot Monitoring | HD Surround Vision | Heated Front Seats',
  },
  {
    vin: 'TESTDATALNCN00001',
    stock: 'DEMO-L01',
    store: 'Lincoln',
    year: 2024,
    make: 'Lincoln',
    model: 'Nautilus',
    trim: 'Reserve',
    price: 52950,
    msrp: 67125,
    mileage: 9800,
    exterior: 'Infinite Black Metallic',
    interior: 'Black Onyx',
    body: 'SUV',
    drivetrain: 'AWD',
    engine: '2.0L Turbocharged I-4',
    transmission: '8-Speed Automatic',
    fuel: 'Gasoline',
    inventoryDate: '2026-08-12',
    features: 'Jet Appearance Package | Lincoln Co-Pilot360 2.2 Vision | Revel Ultima 3D Audio | 24-Way Perfect Position Seats | Panoramic Vista Roof | Phone As A Key',
  },
  {
    vin: 'TESTDATALNCN00002',
    stock: 'DEMO-L02',
    store: 'Lincoln',
    year: 2022,
    make: 'Lincoln',
    model: 'Corsair',
    trim: 'Grand Touring',
    price: 36750,
    msrp: 56530,
    mileage: 29450,
    exterior: 'Ceramic Pearl',
    interior: 'Cashew',
    body: 'SUV',
    drivetrain: 'AWD',
    engine: '2.5L Plug-In Hybrid',
    transmission: 'eCVT',
    fuel: 'Plug-In Hybrid',
    inventoryDate: '2026-07-05',
    features: 'Elements Technology Bundle | Lincoln Co-Pilot360 1.5 Plus | Head-Up Display | Panoramic Vista Roof | Hands-Free Liftgate | Revel Audio',
  },
]

function listingUrl(vehicle) {
  return `https://${STORES[vehicle.store].host}/used-Synthetic-${vehicle.vin}`
}

function publicRecord(vehicle) {
  return {
    vin: vehicle.vin,
    stock_number: vehicle.stock,
    store: vehicle.store,
    actual_location: `${vehicle.store} — synthetic fixture`,
    vehicle_name: `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    listed_price: vehicle.price,
    msrp: vehicle.msrp,
    mileage: vehicle.mileage,
    exterior_color: vehicle.exterior,
    interior_color: vehicle.interior,
    body_style: vehicle.body,
    body_type: vehicle.body,
    drivetrain: vehicle.drivetrain,
    engine: vehicle.engine,
    transmission: vehicle.transmission,
    fuel_type: vehicle.fuel,
    mpg_city: vehicle.fuel === 'Plug-In Hybrid' ? 34 : 18,
    mpg_highway: vehicle.fuel === 'Plug-In Hybrid' ? 32 : 24,
    certified: vehicle.make === 'Ford' || vehicle.make === 'Lincoln',
    availability: 'Synthetic demo listing — not a real vehicle',
    in_stock: true,
    in_transit: false,
    in_production: false,
    features: vehicle.features,
    listing_url: listingUrl(vehicle),
    photo_count: 0,
    inventory_date: vehicle.inventoryDate,
    first_seen: vehicle.inventoryDate,
    last_seen: SYNTHETIC_REPORT_DATE,
    model_code: `DEMO-${vehicle.model.replace(/\W/g, '').toUpperCase()}`,
    generic_color: vehicle.exterior.split(' ')[0],
    dealer_comments: 'Synthetic demonstration record. No customer, dealership, or source-system data is present.',
    source_sites: [`Synthetic ${vehicle.store} fixture`],
    data_status: SYNTHETIC_FIXTURE_MARKER,
    change_summary: 'No production change history — synthetic fixture',
  }
}

function crmRecord(vehicle, held = false) {
  return {
    vin: vehicle.vin,
    stockNumber: vehicle.stock,
    storeName: vehicle.store,
    storeCode: STORES[vehicle.store].code,
    yearRaw: String(vehicle.year),
    makeRaw: vehicle.make,
    modelRaw: vehicle.model,
    seriesRaw: vehicle.trim,
    bodyRaw: vehicle.body,
    engineRaw: vehicle.engine,
    colorRaw: vehicle.exterior,
    mileageNumber: vehicle.mileage,
    priceNumber: vehicle.price,
    inventoryAgeNumber: 12,
    certificationRaw: vehicle.make === 'Ford' || vehicle.make === 'Lincoln' ? 'SYNTHETIC CERTIFIED FLAG' : '',
    holdStateFromRowClass: held ? 'synthetic_active_hold' : 'synthetic_no_hold_observed',
    sourceCellCount: 22,
    extractionStatus: SYNTHETIC_FIXTURE_MARKER,
  }
}

function holdRecord(vehicle, { backup = false } = {}) {
  const rows = [
    {
      lifecycleStatus: 'active',
      holdPosition: 'primary',
      holdOrderNumber: 1,
      salespersonRaw: 'Demo Salesperson',
      customerOrReasonRaw: 'Synthetic customer request — training data only',
      holdDateRaw: '2026-08-29 9:15 AM',
      expectedDeliveryDateRaw: '2026-08-31',
      heldByRaw: 'Demo Manager',
    },
  ]
  if (backup) {
    rows.push({
      lifecycleStatus: 'active',
      holdPosition: 'backup',
      holdOrderNumber: 2,
      salespersonRaw: 'Backup Demo Salesperson',
      customerOrReasonRaw: 'Synthetic backup request — training data only',
      holdDateRaw: '2026-08-29 11:30 AM',
      expectedDeliveryDateRaw: '2026-09-01',
      heldByRaw: 'Demo Manager',
    })
  }
  return {
    mainRow: {
      vin: vehicle.vin,
      stockNumber: vehicle.stock,
      vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    },
    store: { name: vehicle.store, code: STORES[vehicle.store].code },
    holdDetailRows: rows,
    comments: [
      {
        rows: [
          {
            authorRaw: 'Demo Manager',
            commentTextRaw: 'Synthetic note: verify the demonstration appointment before any action.',
            timestampRaw: '2026-08-30 8:10 AM',
          },
        ],
      },
    ],
    alerts: [
      {
        authorRaw: 'Demo Manager',
        alertTextRaw: 'Synthetic alert — training data only.',
        timestampRaw: '2026-08-30 8:12 AM',
      },
    ],
    extractionStatus: SYNTHETIC_FIXTURE_MARKER,
  }
}

function factoryEquipment(vehicle) {
  return {
    dataState: 'current',
    sourceLabel: 'Synthetic factory-equipment fixture',
    capturedAt: '2026-08-30T09:00:00-04:00',
    vehicleDescription: `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`,
    basePrice: vehicle.msrp - 5000,
    totalOptions: 3005,
    destinationCharge: 1995,
    totalMsrp: vehicle.msrp,
    exteriorColor: vehicle.exterior,
    interiorColor: vehicle.interior,
    engine: vehicle.engine,
    transmission: vehicle.transmission,
    drivetrain: vehicle.drivetrain,
    packages: [
      {
        name: 'Synthetic Premium Technology Package',
        code: 'DEMO',
        price: 3005,
        features: ['360-Degree Camera', 'Adaptive Cruise Control', 'Blind Spot Monitoring'],
      },
    ],
    sections: [
      {
        name: 'Safety and Driver Assistance',
        items: [
          { label: 'Pre-Collision Assist with Automatic Emergency Braking' },
          { label: 'Lane-Keeping System' },
          { label: 'Rear Cross-Traffic Alert' },
        ],
      },
      {
        name: 'Comfort and Convenience',
        items: [
          { label: 'Heated front seats' },
          { label: 'Wireless smartphone integration' },
        ],
      },
    ],
    disclaimer: 'Synthetic fixture only. Equipment and pricing are fabricated and must never be used for a customer or vehicle decision.',
    isOriginalWindowSticker: false,
  }
}

function autoCheckReport() {
  return {
    dataState: 'current',
    reportRunAt: '2026-08-30T09:05:00-04:00',
    score: 91,
    scoreRangeLow: 86,
    scoreRangeHigh: 93,
    usage: 'Synthetic personal-use history',
    ownerCount: 1,
    lastReportedOdometer: 12450,
    lastReportedOdometerDate: '2026-08-29',
    estimatedInServiceDate: '2024-03-14',
    vehicleClass: 'Synthetic light-duty vehicle',
    assemblyCountry: 'Synthetic fixture',
    checks: [
      { label: 'Accident check', status: 'Synthetic clear result', detail: 'Training data only' },
      { label: 'Title check', status: 'Synthetic clear result', detail: 'Training data only' },
    ],
  }
}

function syntheticFordServiceHistory(vehicle) {
  const order = (repairOrderNumber, openDate, closeDate, odometer, services, inspection = null) => ({
    repairOrderNumber, dealerCode: 'DEMO1', openDate, closeDate, odometer, detailComplete: true,
    inspection: inspection ? { status: 'confirmed', type: inspection } : { status: 'not_identified' },
    parts: [], laborOperations: [], services,
    summary: `${services.join('; ')}. Synthetic demonstration only.`,
  })
  const recentRepairOrders = [
    order(`9000${vehicle.stock.slice(-2)}01`, '08/25/2026', '08/26/2026', vehicle.mileage, ['Used-car inspection', 'Oil and filter service', 'Brake inspection/service'], 'Used-car inspection'),
    order(`9000${vehicle.stock.slice(-2)}02`, '05/10/2026', '05/10/2026', Math.max(0, vehicle.mileage - 1800), ['Tire inspection/service', 'Wheel alignment']),
    order(`9000${vehicle.stock.slice(-2)}03`, '01/17/2026', '01/17/2026', Math.max(0, vehicle.mileage - 4200), ['Oil and filter service', 'Cabin air filter']),
  ]
  return {
    dataState: 'current', checkedAt: '2026-08-30T09:12:00-04:00',
    sourceLabel: 'Synthetic Ford service history demonstration — fabricated, not operational',
    historyCaptured: true, repairOrderCount: 8, detailScanCount: recentRepairOrders.length,
    inspectionSearchStatus: 'confirmed', latestRepairOrder: recentRepairOrders[0],
    recentInspection: recentRepairOrders[0], recentRepairOrders,
  }
}

const heldVins = new Set(['TESTDATAHWELL0001', 'TESTDATALNCN00001'])

// Rich source coverage is opt-in for the local demonstration. Keep the default
// recovery/test release unchanged, including its single resource record.
function demoResources(vehicle) {
  const features = vehicle.features.split(' | ')
  const packages = features.filter((feature) => /package|pack |bundle/i.test(feature))
  const equipment = features.filter((feature) => !packages.includes(feature))
  const truck = /crew/i.test(vehicle.body)
  // These fabricated option lines exercise the structure of a dense sticker:
  // priced packages, included child items and explicit no-charge equipment.
  // DEMO identifiers and the document warning keep them distinct from a real
  // manufacturer's configuration; the five amounts sum to the demo's $3,005.
  const additionalOptions = truck
    ? ['Bed utility package · DEMO-BED · USD 1,100.00', '.Tailgate step', '.Bed illumination', 'Cargo tie-down kit · DEMO-CARGO · USD 500.00', 'Trailer camera preparation · DEMO-TOW · USD 600.00', 'Running boards · DEMO-STEP · USD 550.00', 'All-weather floor liners · DEMO-FLOOR · USD 255.00', 'Rear-seat charging · DEMO-USB · NO CHARGE']
    : ['Cargo organization package · DEMO-CARGO · USD 1,100.00', '.Adjustable cargo dividers', '.Cargo storage tray', 'Roof crossbars · DEMO-ROOF · USD 500.00', 'All-weather floor liners · DEMO-FLOOR · USD 600.00', 'Rear-seat charging · DEMO-USB · USD 550.00', 'Illuminated entry · DEMO-ENTRY · USD 255.00', 'Cargo-area protection · DEMO-LINER · NO CHARGE']
  const selectedOptions = additionalOptions
  const description = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`
  const inServiceDate = `${vehicle.year}-03-14`
  const disclaimer = 'Synthetic demonstration only: all equipment, pricing, history, and coverage facts are fabricated. Never use for a customer or vehicle decision.'
  const factory = {
    ...factoryEquipment(vehicle),
    sourceLabel: 'Synthetic vAuto equipment demonstration',
    packages: packages.map((name, index) => ({ name, code: `DEMO-${index + 1}`, features: [] })),
    sections: [{ name: 'Synthetic vehicle equipment', items: equipment.map((label) => ({ label })) }],
    disclaimer,
  }
  return {
    factoryEquipment: factory,
    autoCheckReport: {
      ...autoCheckReport(),
      lastReportedOdometer: vehicle.mileage,
      estimatedInServiceDate: inServiceDate,
      vehicleClass: `Synthetic ${vehicle.body}`,
      checks: [
        { label: 'State title brand', status: 'Clean', detail: 'Synthetic result' },
        { label: 'Auction brand / issues', status: 'No issue', detail: 'Synthetic result' },
        { label: 'Accident / damage', status: 'No issue', detail: 'No accidents or damage reported · Synthetic result' },
        { label: 'Open recall check', status: 'No open recalls', detail: 'Synthetic report result' },
        { label: 'Insurance loss / transfer', status: 'No issue', detail: 'Synthetic result' },
        { label: 'Odometer check', status: 'No issue', detail: 'Synthetic result' },
        { label: 'Certified pre-owned', status: 'No CPO info available', detail: 'Synthetic report result' },
        { label: 'Service / repair', status: 'No issue', detail: '5 service records reported · Synthetic example' },
        { label: 'Additional history', status: 'Events reported', detail: 'Corrected title · Synthetic example' },
      ],
    },
    ...(['DEMO-H01', 'DEMO-H02'].includes(vehicle.stock) ? {
      warrantyCheck: {
        dataState: 'current', capturedAt: '2026-08-30T09:15:00-04:00',
        sourceLabel: 'Synthetic warranty check — fabricated training results, not operational',
        mileageEntered: vehicle.mileage, mileageSource: 'Synthetic inventory mileage',
        fordOasis: {
          warrantyStartDate: inServiceDate, monthsInService: (2026 - vehicle.year) * 12 + 5,
          coverages: [{
            type: 'Bumper to Bumper', termText: '3 YRS / 36000 MILES',
            status: vehicle.stock === 'DEMO-H01' ? 'ACTIVE' : 'EXPIRED',
            remainingMilesText: `${Math.max(0, 36000 - vehicle.mileage).toLocaleString('en-US')} miles`,
            remainingTimeText: vehicle.stock === 'DEMO-H01' ? '7 months' : 'Expired by time',
            note: 'Synthetic example only; fabricated status and terms. Verify the actual source before any decision.',
          }, {
            type: 'Powertrain', termText: '5 YRS / 60000 MILES', status: 'ACTIVE',
            remainingMilesText: `${Math.max(0, 60000 - vehicle.mileage).toLocaleString('en-US')} miles`,
            remainingTimeText: `${60 - ((2026 - vehicle.year) * 12 + 5)} months`,
            note: 'Synthetic example only; condition and exclusions require source verification.',
          }],
        },
      },
    } : {}),
    windowSticker: {
      dataState: 'current',
      sourceMessage: disclaimer,
      originalMarket: 'United States',
      pricingCurrency: 'USD',
      pricingCurrencyEvidence: 'Fabricated USD pricing for demonstration only',
      vehicleDescription: description,
      equipmentGroup: `Synthetic ${vehicle.trim} equipment · DEMO-GRP`,
      equipmentGroupContents: features,
      basePrice: factory.basePrice,
      totalOptions: factory.totalOptions,
      destinationCharge: factory.destinationCharge,
      totalMsrp: vehicle.msrp,
      exteriorColor: vehicle.exterior,
      interiorColor: vehicle.interior,
      engine: vehicle.engine,
      transmission: vehicle.transmission,
      options: selectedOptions,
      standardEquipment: ['Power door locks', 'Automatic headlamps', 'Tire pressure monitoring', 'Rearview camera'],
      warranty: ['Synthetic sample: consult the actual manufacturer coverage record'],
    },
    ...(['Ford', 'Lincoln'].includes(vehicle.make) ? {
      fordOasis: {
        dataState: 'current',
        capturedAt: '2026-08-30T09:10:00-04:00',
        sourceLabel: 'Synthetic OASIS demonstration — fabricated, not operational',
        vehicleDescription: description,
        versionSeries: vehicle.trim,
        ...(['DEMO-H01', 'DEMO-H02'].includes(vehicle.stock) ? {
          engine: vehicle.engine, transmission: vehicle.transmission, driveType: vehicle.drivetrain,
          bodyStyle: vehicle.body, paintColor: vehicle.exterior, fuelType: 'Gasoline',
          engineCalibration: `DEMO-CAL-${vehicle.stock}`, axleCode: `DEMO-AXLE-${vehicle.stock}`,
          axleRatio: 'Synthetic ratio reference', tire: 'Synthetic tire specification',
          wheelSize: 'Synthetic wheel specification', grossVehicleWeight: 'Synthetic weight reference',
          syncVersion: 'DEMO-SYNC', paintCode: 'DEMO-PAINT',
        } : {}),
        buildDate: `${vehicle.year}-01-15`,
        releaseDate: `${vehicle.year}-02-01`,
        warrantyStartDate: inServiceDate,
        monthsInService: (2026 - vehicle.year) * 12 + 5,
        saleMileage: 12,
        openActionsCaptured: true,
        openFieldServiceActions: vehicle.stock === 'DEMO-H02'
          ? [{ code: '26N99', description: 'Synthetic non-recall service campaign: demonstration software inspection only' }]
          : [],
        warrantyCoverages: [{ type: 'Synthetic coverage sample', description: 'Fabricated coverage record; verify actual terms before any vehicle decision' }],
        extendedCoverageExpirations: [],
        serviceHistory: syntheticFordServiceHistory(vehicle),
      },
    } : {}),
  }
}

function releaseTemplate(includeDemoChanges = false) {
  const records = VEHICLES.map((vehicle) => {
    const held = heldVins.has(vehicle.vin)
    const { windowSticker, ...resources } = includeDemoChanges ? demoResources(vehicle) : {}
    return {
      vin: vehicle.vin,
      publicRecord: { ...publicRecord(vehicle), ...(windowSticker ? { windowSticker } : {}) },
      crmRecord: crmRecord(vehicle, held),
      holdRecord: held ? holdRecord(vehicle, { backup: vehicle.vin === 'TESTDATAHWELL0001' }) : null,
      cdkRecord: held
        ? {
            result: 'SYNTHETIC RESPONSE — no production CDK meaning',
            fields: {
              STATUS: 'DEMO',
              YEAR: String(vehicle.year),
              MODEL: vehicle.model,
              STOCKNO: vehicle.stock,
              VIN: vehicle.vin,
            },
          }
        : null,
      resourceRecord:
        includeDemoChanges ? resources : vehicle.vin === 'TESTDATAHWELL0001'
          ? { factoryEquipment: factoryEquipment(vehicle), autoCheckReport: autoCheckReport() }
          : null,
    }
  })

  const storeCounts = Object.fromEntries(Object.keys(STORES).map((store) => [store, VEHICLES.filter((row) => row.store === store).length]))
  // Two fabricated snapshots exercise the same reconciliation path as real
  // imports. These are demonstration changes, never production history.
  const currentSnapshot = { report_date: SYNTHETIC_REPORT_DATE, vehicles: Object.fromEntries(records.map(row => [row.vin, row.publicRecord])) }
  const previousSnapshot = { report_date: '2026-08-29', vehicles: Object.fromEntries(records.filter(row => row.vin !== 'TESTDATAHWELL0002').map(row => [row.vin, { ...row.publicRecord, listed_price: row.publicRecord.listed_price + (['TESTDATAHWELL0001', 'TESTDATALNCN00001'].includes(row.vin) ? 1500 : 0) }])) }
  const publicChangeEvents = includeDemoChanges ? buildPublicChangeEvents({ previousSnapshot, currentSnapshot }) : []
  const changeCounts = summarizePublicChangeEvents(publicChangeEvents)

  return {
    reportDate: SYNTHETIC_REPORT_DATE,
    timezone: 'America/New_York',
    completedAt: '2026-08-30T10:00:00-04:00',
    manifestPath: 'synthetic-fixture://manifest',
    manifest: {
      fixture_marker: SYNTHETIC_FIXTURE_MARKER,
      report_date: SYNTHETIC_REPORT_DATE,
      timezone: 'America/New_York',
      completed_at: '2026-08-30T10:00:00-04:00',
      complete: true,
      public_inventory_status: 'complete',
      dealermail_status: 'complete_authenticated_read_only',
      hold_change_status: 'synthetic_baseline',
      source_counts: {
        public_unique_vins: records.length,
        dealermail_used_rows: records.length,
        active_held_vins: heldVins.size,
      },
      public_change_counts: changeCounts,
      validation_results: { passed: true },
    },
    warnings: [
      `${SYNTHETIC_FIXTURE_MARKER}: all vehicles, people, holds, comments, alerts, and workflow facts are fabricated.`,
    ],
    sourceRuns: {
      public: {
        type: 'public_inventory',
        reportDate: SYNTHETIC_REPORT_DATE,
        extractedAt: '2026-08-30T09:55:00-04:00',
        snapshotPath: 'synthetic-fixture://public-inventory',
        sha256: 'A'.repeat(64),
        bytes: 1,
        schemaVersion: 'synthetic-public-inventory-v1',
        status: 'current',
        staleReason: null,
        rowCount: records.length,
        metadata: {
          fixtureMarker: SYNTHETIC_FIXTURE_MARKER,
          storeCounts,
          sourceStatuses: Object.keys(STORES).map((source) => ({ source, status: 'SYNTHETIC' })),
          changeBaseline: includeDemoChanges ? '2026-08-29' : null,
          changeEventCount: publicChangeEvents.length,
        },
      },
      dealerMail: {
        type: 'dealermail_inventory_holds',
        reportDate: SYNTHETIC_REPORT_DATE,
        extractedAt: '2026-08-30T09:57:00-04:00',
        snapshotPath: 'synthetic-fixture://dealermail',
        sha256: 'B'.repeat(64),
        bytes: 1,
        schemaVersion: 'synthetic-dealermail-v1',
        status: 'current',
        staleReason: null,
        rowCount: records.length,
        metadata: {
          fixtureMarker: SYNTHETIC_FIXTURE_MARKER,
          heldVinCount: heldVins.size,
          authentication: { persistentDailyAccess: 'synthetic', readOnly: true },
        },
      },
      resources: {
        type: 'vin_document_enrichment',
        reportDate: SYNTHETIC_REPORT_DATE,
        extractedAt: '2026-08-30T09:58:00-04:00',
        snapshotPath: 'synthetic-fixture://vehicle-resources',
        sha256: 'C'.repeat(64),
        bytes: 1,
        schemaVersion: 'synthetic-vehicle-resources-v1',
        status: 'current',
        staleReason: null,
        rowCount: 1,
        metadata: { fixtureMarker: SYNTHETIC_FIXTURE_MARKER, recordCount: 1 },
      },
    },
    publicSnapshot: { fixture_marker: SYNTHETIC_FIXTURE_MARKER },
    dealerMailSnapshot: { fixture_marker: SYNTHETIC_FIXTURE_MARKER },
    publicChangeEvents,
    vehicles: records,
  }
}

export function buildSyntheticRelease({ includeDemoChanges = false } = {}) {
  return structuredClone(releaseTemplate(includeDemoChanges))
}

export const syntheticFixtureInternals = Object.freeze({
  vehicles: VEHICLES,
  heldVins,
})
