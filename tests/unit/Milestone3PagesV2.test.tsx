import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InventoryTableV2 } from '../../src/features/inventory/InventoryTableV2';
import { ServicePageV2 } from '../../src/features/service/ServicePageV2';
import { TransfersPageV2, calculateCountdown } from '../../src/features/transfers/TransfersPageV2';
import type { BootstrapData, VehicleRecord, TransferRecord } from '../../src/types';
import { createMockVehicle, setupClipboardMock } from './testHelpers';

const { mockVehicle1, mockTransfer1, mockAppData } = vi.hoisted(() => {
  const v1 = {
    vin: '1FTFW1E86HFA11111',
    stockNumber: 'STK101',
    year: 2024,
    make: 'Ford',
    model: 'F-150',
    trim: 'XLT',
    vehicleName: '2024 Ford F-150 XLT',
    homeStore: 'Howell',
    sourceReportedLocation: 'Howell',
    publicStore: 'Howell',
    homeStoreConfirmed: true,
    websiteStatus: 'active',
    publicListingState: 'listed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'None observed', backupCount: 0 },
    price: 45000,
    mileage: 12000,
    daysListed: 5,
    exteriorColor: 'Black',
    serviceReadiness: {
      vin: '1FTFW1E86HFA11111',
      status: 'needs_service',
      version: 1,
      serviceEnteredAt: null,
      completedAt: null,
      updatedAt: null,
      updatedBy: null,
      updatedByRole: null,
      updatedAtStore: null,
      store: 'Howell',
      canManage: true,
      notes: 'Inspection needed',
    },
    movement: {
      state: 'at_home',
      label: 'At Howell',
      currentLocation: 'Howell',
      locationConfidence: 'verified',
    },
    fordOasis: {
      openFieldServiceActions: [{ campaignNumber: '24S01', description: 'Brake inspection' } as any],
    },
  } as unknown as VehicleRecord;

  const v2 = {
    vin: '1FTFW1E86HFA22222',
    stockNumber: 'STK102',
    year: 2023,
    make: 'Ford',
    model: 'Explorer',
    trim: 'Limited',
    vehicleName: '2023 Ford Explorer Limited',
    homeStore: 'Howell',
    sourceReportedLocation: 'Howell',
    publicStore: 'Howell',
    homeStoreConfirmed: true,
    websiteStatus: 'active',
    publicListingState: 'listed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'None observed', backupCount: 0 },
    price: 38000,
    mileage: 24000,
    daysListed: 18,
    exteriorColor: 'Blue',
    serviceReadiness: {
      vin: '1FTFW1E86HFA22222',
      status: 'in_service',
      version: 1,
      serviceEnteredAt: '2026-09-15',
      completedAt: null,
      updatedAt: null,
      updatedBy: null,
      updatedByRole: null,
      updatedAtStore: null,
      store: 'Howell',
      canManage: true,
      notes: 'In brake service',
    },
    movement: {
      state: 'at_home',
      label: 'At Howell',
      currentLocation: 'Howell',
      locationConfidence: 'verified',
    },
  } as unknown as VehicleRecord;

  const v3 = {
    vin: '1FTFW1E86HFA33333',
    stockNumber: 'STK103',
    year: 2024,
    make: 'Ford',
    model: 'Bronco',
    trim: 'Badlands',
    vehicleName: '2024 Ford Bronco Badlands',
    homeStore: 'Howell',
    sourceReportedLocation: 'Howell',
    publicStore: 'Howell',
    homeStoreConfirmed: true,
    websiteStatus: 'active',
    publicListingState: 'listed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'None observed', backupCount: 0 },
    price: 52000,
    mileage: 8000,
    daysListed: 2,
    exteriorColor: 'Green',
    serviceReadiness: {
      vin: '1FTFW1E86HFA33333',
      status: 'serviced',
      version: 1,
      serviceEnteredAt: null,
      completedAt: '2026-09-16',
      updatedAt: null,
      updatedBy: null,
      updatedByRole: null,
      updatedAtStore: null,
      store: 'Howell',
      canManage: true,
      notes: 'Ready for delivery',
    },
    movement: {
      state: 'at_home',
      label: 'At Howell',
      currentLocation: 'Howell',
      locationConfidence: 'verified',
    },
  } as unknown as VehicleRecord;

  const t1: TransferRecord = {
    id: 'TR-1001',
    workflowMode: 'simple',
    vin: '1FTFW1E86HFA11111',
    stockNumber: 'STK101',
    vehicleName: '2024 Ford F-150 XLT',
    homeStore: 'Howell',
    requestingStore: 'Fowlerville',
    currentLocation: 'Howell',
    destination: 'Fowlerville',
    requestStatus: 'approved',
    movementStatus: 'release-approved',
    dealStatus: 'no-outcome',
    deliveryStatus: 'not-confirmed',
    dealerMailHoldState: 'not-observed',
    publicListingState: 'listed',
    cdkStatus: 'open',
    priority: 'high',
    requestedBy: 'Dan Miller',
    requestedAt: '2026-09-17T08:00:00Z',
    custodian: 'Sarah Jenkins',
    transportAssignee: 'Ray Bradley',
    nextAction: 'Confirm pickup and release vehicle to custodian',
    nextActionOwner: 'Sarah Jenkins',
    dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    returnRequired: true,
    returnDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    locationConfidence: 'verified',
    events: [],
    allowedActions: ['confirm-pickup', 'schedule-return'],
  };

  const t2: TransferRecord = {
    id: 'TR-1002',
    workflowMode: 'simple',
    vin: '1FTFW1E86HFA22222',
    stockNumber: 'STK102',
    vehicleName: '2023 Ford Explorer Limited',
    homeStore: 'Howell',
    requestingStore: 'Fowlerville',
    currentLocation: 'Fowlerville',
    destination: 'Fowlerville',
    requestStatus: 'arrived',
    movementStatus: 'at-requesting-store-verified',
    dealStatus: 'show-in-progress',
    deliveryStatus: 'not-confirmed',
    dealerMailHoldState: 'not-observed',
    publicListingState: 'listed',
    cdkStatus: 'open',
    priority: 'urgent',
    requestedBy: 'Alice Wong',
    requestedAt: '2026-09-16T10:00:00Z',
    custodian: 'Dave Clark',
    transportAssignee: 'Ray Bradley',
    nextAction: 'Return vehicle back to Howell home store',
    nextActionOwner: 'Dave Clark',
    dueAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    returnRequired: true,
    returnDueAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    locationConfidence: 'verified',
    events: [],
    allowedActions: ['confirm-return', 'schedule-return'],
  };

  const b = {
    vehicles: [v1, v2, v3],
    transfers: [t1, t2],
    stores: [
      { store: 'Howell' },
      { store: 'Fowlerville' },
    ],
    meta: {
      reportDate: '2026-09-17',
      completedAt: '2026-09-17T12:00:00Z',
      timezone: 'America/New_York',
      publicFreshness: 'current',
      dealerMailFreshness: 'current',
      publicCount: 3,
      crmCount: 3,
      heldVinCount: 1,
      publicChangeCounts: {
        newArrival: 1,
        removed: 0,
        priceChange: 0,
        mileageChange: 0,
        websiteStatusChange: 0,
        stockCorrection: 0,
        storeTransfer: 0,
      },
      holdChangeStatus: 'baseline',
      warnings: [],
    },
  } as unknown as BootstrapData;

  const appData = {
    data: b,
    homeStore: 'Howell' as const,
    role: 'manager' as const,
    currentUser: 'Sarah Jenkins',
    refresh: vi.fn(),
    submitTransfer: vi.fn(),
  };

  return {
    mockVehicle1: v1,
    mockVehicle2: v2,
    mockVehicle3: v3,
    mockTransfer1: t1,
    mockTransfer2: t2,
    mockBootstrap: b,
    mockAppData: appData,
  };
});

vi.mock('../../src/app/AppDataContext', () => ({
  useAppData: () => mockAppData,
}));

vi.mock('../../src/lib/api', () => ({
  getServiceReadiness: vi.fn().mockResolvedValue({
    vin: '1FTFW1E86HFA11111',
    status: 'needs_service',
    version: 1,
    notes: 'Initial notes',
    canManage: true, store: 'Howell', history: [],
  }),
  updateServiceReadiness: vi.fn().mockResolvedValue({
    success: true,
    vehicle: mockVehicle1,
  }),
  getTransfer: vi.fn().mockResolvedValue(mockTransfer1),
}));

describe('Premium pages preserve the complete operational workflow', () => {
  beforeEach(() => { setupClipboardMock(); vi.clearAllMocks(); });
  afterEach(cleanup);

  it('defaults service to the established list with an optional board', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/service']}><ServicePageV2 /></MemoryRouter>);
    expect(screen.getByRole('group', { name: 'Service view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.service-v2-board')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(await screen.findByRole('button', { name: 'Start service for STK101' })).toBeInTheDocument();
    expect(container.querySelectorAll('.service-v2-column')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: /Service Ready/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(container.querySelector('.service-v2-board')).toBeNull();
  });

  it('board actions open the shared confirmation editor without writing immediately', async () => {
    const api = await import('../../src/lib/api');
    render(<MemoryRouter initialEntries={['/service?view=board']}><ServicePageV2 /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Start service for STK101' }));
    expect(await screen.findByRole('button', { name: 'Save service status' })).toBeInTheDocument();
    expect(api.updateServiceReadiness).not.toHaveBeenCalled();
  });

  it('filters optional board vehicles by stock without changing their source state', async () => {
    render(<MemoryRouter initialEntries={['/service?view=board']}><ServicePageV2 /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Filter service vehicles' }), { target: { value: 'STK102' } });
    expect(screen.getByRole('button', { name: 'Mark Ready for STK102' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start service for STK101' })).not.toBeInTheDocument();
  });

  it('retains the full move queue with store, stage, sorting and search controls', () => {
    render(<MemoryRouter initialEntries={['/transfers']}><TransfersPageV2 /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Vehicle moves', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Vehicle move stores' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Move queue view' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter vehicle moves' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort vehicle moves' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search vehicle moves' }), { target: { value: 'STK102' } });
    const moves = within(screen.getByRole('complementary', { name: 'Vehicle moves' }));
    expect(moves.getByRole('button', { name: /STK102/ })).toHaveTextContent('Dave Clark');
    expect(moves.queryByRole('button', { name: /STK101/ })).not.toBeInTheDocument();
  });

  it('retains the new move vehicle picker from the default route', async () => {
    render(<MemoryRouter initialEntries={['/transfers/new']}><TransfersPageV2 /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Start a move' })).toBeInTheDocument();
    const search = screen.getByRole('textbox', { name: 'Search inventory to move' });
    fireEvent.change(search, { target: { value: 'STK103' } });
    expect(screen.getByText(/Stock STK103/)).toBeInTheDocument();
    expect(screen.queryByText(/Stock STK101/)).not.toBeInTheDocument();
  });

  it('keeps the retained alternative table qualified and permission-safe', () => {
    const vehicle = createMockVehicle({ dealerMail: { dataState: 'current', hasActiveHold: false, activeRecordCount: 0, canViewEvidence: false, canManageHold: false }, movement: null });
    render(<InventoryTableV2 vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} canRequestVehicle={false} />);
    expect(screen.getByText('No current DealerMail hold found')).toBeInTheDocument();
    expect(screen.queryByText(/^Available$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request transfer/ })).not.toBeInTheDocument();
  });

  it('classifies missing, invalid, overdue and due-soon deadlines without inventing a date', () => {
    expect(calculateCountdown(null)).toEqual({ label: 'No deadline', isOverdue: false, isDueSoon: false });
    expect(calculateCountdown('invalid')).toEqual({ label: 'No deadline', isOverdue: false, isDueSoon: false });
    expect(calculateCountdown(null, 'overdue').isOverdue).toBe(true);
    expect(calculateCountdown(new Date(Date.now()-3600000).toISOString()).isOverdue).toBe(true);
    expect(calculateCountdown(new Date(Date.now()+3600000).toISOString()).isDueSoon).toBe(true);
    expect(calculateCountdown(new Date(Date.now()+72*3600000).toISOString()).isDueSoon).toBe(false);
  });
});
