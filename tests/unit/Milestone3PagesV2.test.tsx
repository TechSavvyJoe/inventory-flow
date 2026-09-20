import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InventoryTableV2 } from '../../src/features/inventory/InventoryTableV2';
import { InventoryExperienceV2 } from '../../src/features/inventory/InventoryExperienceV2';
import { ServicePageV2 } from '../../src/features/service/ServicePageV2';
import { TransfersPageV2, calculateCountdown } from '../../src/features/transfers/TransfersPageV2';
import type { InventoryStore, InventoryVehicle } from '../../src/features/inventory/types';
import type { BootstrapData, VehicleRecord, TransferRecord } from '../../src/types';
import { createMockVehicle, setupClipboardMock } from './testHelpers';

const { mockVehicle1, mockVehicle2, mockVehicle3, mockTransfer1, mockTransfer2, mockBootstrap, mockAppData } = vi.hoisted(() => {
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
    role: 'salesperson' as const,
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
  }),
  updateServiceReadiness: vi.fn().mockResolvedValue({
    success: true,
    vehicle: mockVehicle1,
  }),
  getTransfer: vi.fn().mockResolvedValue(mockTransfer1),
}));

describe('Milestone 3: App-Wide Page Upgrades (R3, R2, R4)', () => {
  beforeEach(() => {
    setupClipboardMock();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // 1. Inventory Table V2 Unit Tests
  // ===========================================================================
  describe('InventoryTableV2 Component', () => {
    const mockStore: InventoryStore = { id: 'howell', name: 'Howell' };
    const vehicleHeld = createMockVehicle({
      id: 'VIN-HELD',
      vin: '1FTFW1E86HFA77777',
      stockNumber: 'STK777',
      dealerMail: {
        dataState: 'current',
        hasActiveHold: true,
        position: 'primary',
        activeRecordCount: 1,
        canViewEvidence: true,
        canManageHold: true,
        updatedAt: '2026-09-17T12:00:00Z',
      },
      holdEvidence: [
        {
          id: 'h1',
          position: 'primary',
          salesperson: 'Sarah Jenkins',
          customerOrReason: 'Pending deposit',
        },
      ],
      serviceReadiness: { status: 'in_service' } as any,
    });

    const vehicleReady = createMockVehicle({
      id: 'VIN-READY',
      vin: '1FTFW1E86HFA88888',
      stockNumber: 'STK888',
      dealerMail: {
        dataState: 'current',
        hasActiveHold: false,
        activeRecordCount: 0,
        canViewEvidence: false,
        canManageHold: false,
        updatedAt: '2026-09-17T12:00:00Z',
      },
      serviceReadiness: { status: 'serviced' } as any,
      fordOasis: {
        openFieldServiceActions: [{ campaignNumber: '24S02', description: 'Wiper motor recall' } as any],
      } as any,
    });

    it('renders table with sticky header columns and uppercase labels', () => {
      render(
        <InventoryTableV2
          vehicles={[vehicleHeld]}
          sorts={[{ key: 'vehicle', direction: 'asc' }]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />,
      );

      expect(screen.getByRole('table', { name: /Inventory vehicles/i })).toBeInTheDocument();
      expect(screen.getByText('Vehicle')).toBeInTheDocument();
      expect(screen.getByText('Stock / VIN')).toBeInTheDocument();
      expect(screen.getByText('Price & Miles')).toBeInTheDocument();
      expect(screen.getByText('Location & Move')).toBeInTheDocument();
      expect(screen.getByText('Hold & Service')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('renders monospace Stock and VIN chips with CopyableValue', () => {
      render(
        <InventoryTableV2
          vehicles={[vehicleHeld]}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />,
      );

      expect(screen.getByText('#STK777')).toBeInTheDocument();
      expect(screen.getByText('1FTFW1E86HFA77777')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy Stock: STK777/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy VIN: 1FTFW1E86HFA77777/i })).toBeInTheDocument();
    });

    it('renders status badges: Hold salesperson, In Service, and Recall indicator', () => {
      render(
        <InventoryTableV2
          vehicles={[vehicleHeld, vehicleReady]}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />,
      );

      // Held vehicle badges
      expect(screen.getByText(/Hold: Sarah Jenkins/i)).toBeInTheDocument();
      expect(screen.getByText('In Service')).toBeInTheDocument();

      // Ready vehicle badges
      expect(screen.getByText('Available')).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getAllByText(/Recall/i).length).toBeGreaterThanOrEqual(1);
    });

    it('renders View, Move, and Request quick action shortcuts', () => {
      const onView = vi.fn();
      const onMove = vi.fn();
      const onRequest = vi.fn();

      render(
        <InventoryTableV2
          vehicles={[vehicleHeld]}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
          onViewVehicle={onView}
          onTrackMovement={onMove}
          onRequestVehicle={onRequest}
          canRequestVehicle={true}
        />,
      );

      const viewBtn = screen.getByRole('button', { name: /View details for STK777/i });
      const moveBtn = screen.getByRole('button', { name: /Move vehicle STK777/i });
      const requestBtn = screen.getByRole('button', { name: /Request transfer for STK777/i });

      expect(viewBtn).toBeInTheDocument();
      expect(moveBtn).toBeInTheDocument();
      expect(requestBtn).toBeInTheDocument();

      fireEvent.click(viewBtn);
      expect(onView).toHaveBeenCalledWith(vehicleHeld);

      fireEvent.click(moveBtn);
      expect(onMove).toHaveBeenCalledWith(vehicleHeld);

      fireEvent.click(requestBtn);
      expect(onRequest).toHaveBeenCalledWith(vehicleHeld);
    });

    it('disables Request button when canRequestVehicle is false', () => {
      render(
        <InventoryTableV2
          vehicles={[vehicleHeld]}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
          canRequestVehicle={false}
        />,
      );

      const requestBtn = screen.getByRole('button', { name: /Request transfer for STK777/i });
      expect(requestBtn).toBeDisabled();
    });

    it('renders empty table message when vehicle list is empty', () => {
      render(
        <InventoryTableV2
          vehicles={[]}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />,
      );

      expect(screen.getByText('No vehicles to display')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // 2. Service Board V2 Unit Tests
  // ===========================================================================
  describe('ServicePageV2 Component', () => {
    it('renders multi-column readiness Kanban board with 3 columns', () => {
      render(
        <MemoryRouter>
          <ServicePageV2 />
        </MemoryRouter>,
      );

      expect(screen.getByRole('heading', { name: /Needs Service/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /In Service/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Ready for Delivery/i })).toBeInTheDocument();
    });

    it('renders 1-click quick action "Start Service" on waiting cards', () => {
      render(
        <MemoryRouter>
          <ServicePageV2 />
        </MemoryRouter>,
      );

      const startBtn = screen.getByRole('button', { name: /Start service for STK101/i });
      expect(startBtn).toBeInTheDocument();
      expect(startBtn).toHaveTextContent('Start Service');
    });

    it('renders 1-click quick action "Mark Ready" on in-service cards', () => {
      render(
        <MemoryRouter>
          <ServicePageV2 />
        </MemoryRouter>,
      );

      const readyBtn = screen.getByRole('button', { name: /Mark Ready for STK102/i });
      expect(readyBtn).toBeInTheDocument();
      expect(readyBtn).toHaveTextContent('Mark Ready');
    });

    it('toggles between Kanban Board and List View', () => {
      render(
        <MemoryRouter>
          <ServicePageV2 />
        </MemoryRouter>,
      );

      const listBtn = screen.getByRole('button', { name: /List View/i });
      fireEvent.click(listBtn);

      expect(screen.getByRole('table', { name: /Service vehicles list/i })).toBeInTheDocument();

      const kanbanBtn = screen.getByRole('button', { name: /Kanban Board/i });
      fireEvent.click(kanbanBtn);

      expect(screen.getByRole('heading', { name: /Needs Service/i })).toBeInTheDocument();
    });

    it('filters cards by search query', () => {
      render(
        <MemoryRouter>
          <ServicePageV2 />
        </MemoryRouter>,
      );

      const searchInput = screen.getByRole('searchbox', { name: /Filter service vehicles/i });
      fireEvent.change(searchInput, { target: { value: 'Bronco' } });

      expect(screen.getByText('2024 Ford Bronco Badlands')).toBeInTheDocument();
      expect(screen.queryByText('2024 Ford F-150 XLT')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // 3. Transfers Movement View V2 Unit Tests
  // ===========================================================================
  describe('TransfersPageV2 Component', () => {
    it('renders movement tracking cockpit header with scope and queue toggles', () => {
      render(
        <MemoryRouter>
          <TransfersPageV2 />
        </MemoryRouter>,
      );

      expect(screen.getByRole('heading', { name: /Vehicle Movement Cockpit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /My Store \(Howell\)/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Active Moves/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Needs Action/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Completed/i })).toBeInTheDocument();
    });

    it('renders movement queue cards with route (Origin -> Destination)', () => {
      render(
        <MemoryRouter>
          <TransfersPageV2 />
        </MemoryRouter>,
      );

      // Route Howell -> Fowlerville
      const routes = screen.getAllByText('Howell');
      expect(routes.length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Fowlerville').length).toBeGreaterThanOrEqual(1);
    });

    it('renders custodian attribution on queue cards', () => {
      render(
        <MemoryRouter>
          <TransfersPageV2 />
        </MemoryRouter>,
      );

      expect(screen.getByText(/Custodian: Sarah Jenkins/i)).toBeInTheDocument();
      expect(screen.getByText(/Custodian: Dave Clark/i)).toBeInTheDocument();
    });

    it('highlights overdue movement with warning alert', () => {
      render(
        <MemoryRouter>
          <TransfersPageV2 />
        </MemoryRouter>,
      );

      const overdueAlert = screen.getByRole('alert');
      expect(overdueAlert).toBeInTheDocument();
      expect(overdueAlert).toHaveTextContent(/Action Overdue/i);
    });

    it('renders inline action progression buttons directly on queue cards', () => {
      render(
        <MemoryRouter>
          <TransfersPageV2 />
        </MemoryRouter>,
      );

      // Simple action for mockTransfer1 is 'confirm-pickup' -> "Mark vehicle collected"
      const pickupBtn = screen.getByRole('button', { name: /Mark vehicle collected for STK101/i });
      expect(pickupBtn).toBeInTheDocument();

      // Simple action for mockTransfer2 is 'confirm-return' -> "Confirm back home"
      const returnBtn = screen.getByRole('button', { name: /Confirm back home for STK102/i });
      expect(returnBtn).toBeInTheDocument();

      // Track details button
      expect(screen.getByRole('button', { name: /Track movement for STK101/i })).toBeInTheDocument();
    });

    it('selects transfer when clicking Track or card', () => {
      render(
        <MemoryRouter>
          <TransfersPageV2 />
        </MemoryRouter>,
      );

      const trackBtn = screen.getByRole('button', { name: /Track movement for STK101/i });
      fireEvent.click(trackBtn);

      // Detail pane updates
      expect(document.getElementById('transfer-detail-workspace')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // 4. Countdown Timer Logic Unit Tests
  // ===========================================================================
  describe('calculateCountdown helper', () => {
    it('returns "No deadline" when dueAt is undefined or null', () => {
      const res = calculateCountdown(null);
      expect(res.label).toBe('No deadline');
      expect(res.isOverdue).toBe(false);
      expect(res.isDueSoon).toBe(false);
    });

    it('returns "Action Overdue" when SLA is breached or overdue even without timestamp', () => {
      const res = calculateCountdown(null, 'overdue');
      expect(res.label).toBe('Action Overdue');
      expect(res.isOverdue).toBe(true);
    });

    it('calculates overdue time when target date is in the past', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const res = calculateCountdown(twoHoursAgo);
      expect(res.isOverdue).toBe(true);
      expect(res.label).toMatch(/Overdue by 2h/i);
    });

    it('marks due soon when target date is within 4 hours', () => {
      const threeHoursFuture = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const res = calculateCountdown(threeHoursFuture);
      expect(res.isOverdue).toBe(false);
      expect(res.isDueSoon).toBe(true);
      expect(res.label).toMatch(/Due in 3h/i);
    });

    it('calculates days and hours for future deadlines over 24h', () => {
      const twoDaysFuture = new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString();
      const res = calculateCountdown(twoDaysFuture);
      expect(res.isOverdue).toBe(false);
      expect(res.isDueSoon).toBe(false);
      expect(res.label).toMatch(/Due in 2d/i);
    });
  });
});
