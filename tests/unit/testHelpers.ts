import { vi } from 'vitest'
import type { InventoryVehicle } from '../../src/features/inventory/types'

export function createMockVehicle(overrides: Partial<InventoryVehicle> = {}): InventoryVehicle {
  const base = {
    id: 'VIN1FTFW1E86HFA48871',
    vin: '1FTFW1E86HFA48871',
    stockNumber: 'W5863Q',
    year: 2024,
    make: 'Ford',
    model: 'F-150',
    trim: 'Lariat SuperCrew 4x4',
    price: 55495,
    msrp: 62240,
    mileage: 14230,
    daysListed: 12,
    inventoryDate: '2026-08-15',
    bodyType: 'SuperCrew',
    drivetrain: '4WD',
    engine: '3.5L V6 EcoBoost',
    transmission: '10-Speed Automatic',
    fuelType: 'Gasoline',
    exteriorColor: 'Agate Black Metallic',
    interiorColor: 'Black Leather',
    photoCount: 8,
    imageUrl: 'https://example.com/photos/f150-1.jpg',
    imageUrls: [
      'https://example.com/photos/f150-1.jpg',
      'https://example.com/photos/f150-2.jpg',
      'https://example.com/photos/f150-3.jpg',
    ],
    location: {
      homeStore: { id: 'howell', name: 'Howell' },
      sourceReportedStore: { id: 'howell', name: 'Howell' },
      conflict: false,
    },
    publicListing: {
      dataState: 'current',
      isListed: true,
      websiteStatus: 'Active on website',
      listingUrl: 'https://dealer.example.com/vehicles/W5863Q',
      updatedAt: '2026-08-29T12:00:00Z',
    },
    dealerOn: {
      dataState: 'current',
      inStock: true,
      inTransit: false,
      inProduction: false,
      updatedAt: '2026-08-29T12:00:00Z',
    },
    dealerMail: {
      dataState: 'current',
      hasActiveHold: true,
      position: 'primary',
      activeRecordCount: 1,
      canViewEvidence: true,
      canManageHold: true,
      updatedAt: '2026-08-29T12:00:00Z',
    },
    holdEvidence: [
      {
        id: 'hold-101',
        position: 'primary',
        salesperson: 'Sarah Jenkins',
        customerOrReason: 'Reserved for delivery',
        cdkState: 'STATUS: S',
      },
    ],
    serviceReadiness: {
      status: 'needs_service',
      notes: 'Recall 23S14 inspection pending; multipoint inspection required',
    },
    movement: {
      state: 'requested',
      requestId: 'MOV-2026-0042',
      destination: 'Fowlerville',
      requestedBy: 'Dan Miller',
      driver: 'Tom Vance',
      overdue: false,
    },
    windowSticker: {
      dataState: 'current',
      url: 'https://dealer.example.com/stickers/W5863Q.pdf',
      pricingCurrency: 'USD',
      basePrice: 51200,
      totalMsrp: 62240,
      equipmentGroup: '502A High Luxury',
      options: ['FX4 Off-Road Package', 'Max Trailer Tow Package', 'Twin Panel Moonroof'],
    },
    autoCheckReport: {
      dataState: 'current',
      url: 'https://autocheck.example.com/report/1FTFW1E86HFA48871',
      score: 91,
      scoreRangeLow: 85,
      scoreRangeHigh: 93,
      ownerCount: 1,
      usage: 'Personal lease',
      estimatedInServiceDate: '2024-03-15',
    },
    fordOasis: {
      dataState: 'current',
      warrantyStartDate: '2024-03-15',
      openFieldServiceActions: [
        {
          campaignNumber: '23S14',
          description: 'Trailer brake controller software update',
        },
      ],
      warrantyCoverages: [],
      extendedCoverageExpirations: [],
    },
    factoryEquipment: {
      dataState: 'current',
      basePrice: 51200,
      packages: ['FX4 Off-Road', 'Tow Tech Bundle'],
    },
    timeline: [
      {
        id: 'evt-1',
        occurredAt: '2026-08-15T09:00:00Z',
        title: 'Vehicle Received',
        detail: 'Stocked in at Howell lot',
        source: 'dealeron',
      },
      {
        id: 'evt-2',
        occurredAt: '2026-08-28T14:30:00Z',
        title: 'Customer Hold Placed',
        detail: 'Salesperson Sarah Jenkins placed primary hold',
        source: 'dealermail',
      },
    ],
    ...overrides,
  }
  return base as unknown as InventoryVehicle
}

export function setupClipboardMock() {
  const originalClipboard = navigator.clipboard
  let lastCopiedText = ''
  const writeTextMock = vi.fn().mockImplementation(async (text: string) => {
    lastCopiedText = text
    return Promise.resolve()
  })

  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: writeTextMock,
      readText: vi.fn().mockImplementation(async () => lastCopiedText),
    },
    configurable: true,
    writable: true,
  })

  return {
    getLastCopied: () => lastCopiedText,
    writeTextMock,
    restore: () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      })
    },
  }
}
