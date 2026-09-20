import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { execSync } from 'node:child_process';
import { VehicleWorkspaceV2 } from '../../src/features/inventory/VehicleWorkspaceV2';
import { InventoryTableV2 } from '../../src/features/inventory/InventoryTableV2';
import { ServicePageV2 } from '../../src/features/service/ServicePageV2';
import { TransfersPageV2, calculateCountdown } from '../../src/features/transfers/TransfersPageV2';
import type { InventoryStore, InventoryVehicle } from '../../src/features/inventory/types';
import type { BootstrapData, VehicleRecord, TransferRecord } from '../../src/types';
import { createMockVehicle, setupClipboardMock } from './testHelpers';

// ---------------------------------------------------------------------------
// Mock Data and Setup for ServicePageV2 and TransfersPageV2
// ---------------------------------------------------------------------------
const {
  mockVehicle1,
  mockVehicle2,
  mockVehicle3,
  mockTransferPast,
  mockTransferFuture,
  mockTransferNullDue,
  mockBootstrap,
  mockAppData,
  mockApiService,
} = vi.hoisted(() => {
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

  const tPast: TransferRecord = {
    id: 'TR-PAST-01',
    workflowMode: 'simple',
    vin: '1FTFW1E86HFA11111',
    stockNumber: 'STK101',
    vehicleName: '2024 Ford F-150 XLT',
    homeStore: 'Howell',
    requestingStore: 'Fowlerville',
    currentLocation: 'Howell',
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
    requestedAt: '2026-09-10T10:00:00Z',
    custodian: 'Dave Clark',
    transportAssignee: 'Ray Bradley',
    nextAction: 'Return vehicle back to Howell home store',
    nextActionOwner: 'Dave Clark',
    dueAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48 hours ago (overdue)
    returnRequired: true,
    returnDueAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    locationConfidence: 'verified',
    events: [],
    allowedActions: ['confirm-return', 'schedule-return'],
  };

  const tFuture: TransferRecord = {
    id: 'TR-FUTURE-02',
    workflowMode: 'simple',
    vin: '1FTFW1E86HFA22222',
    stockNumber: 'STK102',
    vehicleName: '2023 Ford Explorer Limited',
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
    nextAction: 'Confirm pickup and release vehicle',
    nextActionOwner: 'Sarah Jenkins',
    dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
    returnRequired: true,
    returnDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    locationConfidence: 'verified',
    events: [],
    allowedActions: ['confirm-pickup', 'schedule-return'],
  };

  const tNullDue: TransferRecord = {
    id: 'TR-NULL-03',
    workflowMode: 'simple',
    vin: '1FTFW1E86HFA33333',
    stockNumber: 'STK103',
    vehicleName: '2024 Ford Bronco Badlands',
    homeStore: 'Howell',
    requestingStore: 'Fowlerville',
    currentLocation: 'Howell',
    destination: 'Fowlerville',
    requestStatus: 'draft',
    movementStatus: 'not-requested',
    dealStatus: 'no-outcome',
    deliveryStatus: 'not-confirmed',
    dealerMailHoldState: 'not-observed',
    publicListingState: 'listed',
    cdkStatus: 'open',
    priority: 'normal',
    requestedBy: 'Jim Smith',
    requestedAt: '2026-09-17T09:00:00Z',
    custodian: 'Unassigned',
    transportAssignee: 'Unassigned',
    nextAction: 'Submit transfer request for review',
    nextActionOwner: 'Jim Smith',
    dueAt: null as unknown as undefined, // Null dueAt boundary
    returnRequired: false,
    returnDueAt: null as unknown as undefined,
    locationConfidence: 'verified',
    events: [],
    allowedActions: ['approve'],
  };

  const b = {
    vehicles: [v1, v2, v3],
    transfers: [tPast, tFuture, tNullDue],
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
    refresh: vi.fn().mockResolvedValue(undefined),
    submitTransfer: vi.fn().mockResolvedValue(undefined),
  };

  const apiService = {
    getServiceReadiness: vi.fn(),
    updateServiceReadiness: vi.fn(),
    getTransfer: vi.fn(),
  };

  return {
    mockVehicle1: v1,
    mockVehicle2: v2,
    mockVehicle3: v3,
    mockTransferPast: tPast,
    mockTransferFuture: tFuture,
    mockTransferNullDue: tNullDue,
    mockBootstrap: b,
    mockAppData: appData,
    mockApiService: apiService,
  };
});

vi.mock('../../src/app/AppDataContext', () => ({
  useAppData: () => mockAppData,
}));

vi.mock('../../src/lib/api', () => ({
  getServiceReadiness: (...args: any[]) => mockApiService.getServiceReadiness(...args),
  updateServiceReadiness: (...args: any[]) => mockApiService.updateServiceReadiness(...args),
  getTransfer: (...args: any[]) => mockApiService.getTransfer(...args),
}));

describe('Milestone 4 Phase 2: Empirical Adversarial Stress Testing', () => {
  const mockStore: InventoryStore = { id: 'howell', name: 'Howell' };

  beforeEach(() => {
    setupClipboardMock();
    mockApiService.getServiceReadiness.mockResolvedValue({
      vin: '1FTFW1E86HFA11111',
      status: 'needs_service',
      version: 1,
      notes: 'Initial inspection notes',
    });
    mockApiService.updateServiceReadiness.mockResolvedValue({
      success: true,
      vehicle: mockVehicle1,
    });
    mockApiService.getTransfer.mockResolvedValue(mockTransferPast);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Rapid State Transitions & Concurrent Quick Action Clicks
  // =========================================================================
  describe('Rapid State Transitions & Concurrent Quick Action Clicks', () => {
    it('handles rapid sequential clicks: "Start Service" then immediate "Mark Ready" without crash', () => {
      const vehicle = createMockVehicle({
        serviceReadiness: {
          vin: '1FTFW1E86HFA48871',
          version: 1,
          status: 'needs_service',
          serviceEnteredAt: null,
          completedAt: null,
          updatedAt: null,
          updatedBy: null,
          updatedByRole: null,
          updatedAtStore: null,
          store: 'Howell',
          canManage: true,
        },
      });

      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      // Verify initial state is "Needs service · Waiting for service"
      expect(screen.getByText(/Waiting for service/i)).toBeInTheDocument();

      // Step 1: Click "Start Service"
      const startServiceBtn = screen.getByRole('button', { name: /Start Service/i });
      fireEvent.click(startServiceBtn);

      // Verify intermediate optimistic state is "In service"
      expect(screen.getByText('In service')).toBeInTheDocument();

      // Step 2: Immediately click "Mark Ready" in rapid succession
      const markReadyBtn = screen.getByRole('button', { name: /Mark Ready/i });
      fireEvent.click(markReadyBtn);

      // Verify final optimistic state is "Ready" & "Ready for delivery"
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getByText('Ready for delivery')).toBeInTheDocument();

      // Confirm no errors or lingering action buttons
      expect(screen.queryByRole('button', { name: /Start Service/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Mark Ready/i })).not.toBeInTheDocument();
    });

    it('handles rapid toggling of DealerMail drawer via "Update Hold" and dock actions', () => {
      const vehicle = createMockVehicle({
        dealerMail: {
          dataState: 'current',
          hasActiveHold: true,
          canViewEvidence: true,
          canManageHold: true,
        },
        holdEvidence: [
          {
            id: 'hold-1',
            position: 'primary',
            salesperson: 'Sarah Connor',
            customerOrReason: 'Retail hold',
          },
        ],
      });

      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      const updateHoldCardBtn = screen.getByRole('button', { name: /Update Hold/i });

      // Rapidly toggle the drawer 6 times consecutively
      for (let i = 0; i < 6; i++) {
        const toggleBtn = screen.getByRole('button', { name: /Update Hold|Hide Tools/i });
        fireEvent.click(toggleBtn);
      }

      // Drawer should be closed after even number of toggles
      expect(screen.getByRole('button', { name: /Update Hold/i })).toBeInTheDocument();
      expect(screen.queryByText(/Launch in DealerMail/i)).not.toBeInTheDocument();

      // Click once more to open drawer and verify it mounts cleanly
      fireEvent.click(screen.getByRole('button', { name: /Update Hold/i }));
      expect(screen.getByRole('button', { name: /Hide Tools/i })).toBeInTheDocument();
    });

    it('ServicePageV2: concurrent quick action clicks respect in-flight busy guards', async () => {
      let resolveApi: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveApi = resolve;
      });

      // Mock updateServiceReadiness to stay pending until resolved
      mockApiService.updateServiceReadiness.mockReturnValue(delayedPromise);

      render(
        <MemoryRouter>
          <ServicePageV2 />
        </MemoryRouter>,
      );

      // Locate "Start Service" for STK101 (waiting vehicle)
      const startBtn = screen.getByRole('button', { name: /Start service for STK101/i });
      expect(startBtn).toBeEnabled();

      // Click 1: initiates request
      fireEvent.click(startBtn);

      // Upon optimistic advancement to In Service, the card moves to column 2
      // where the action button transitions to "Mark Ready" in disabled/busy state ("Marking…")
      const readyBtn = screen.getByRole('button', { name: /Mark Ready for STK101/i });
      expect(readyBtn).toBeDisabled();
      expect(readyBtn).toHaveTextContent(/Marking…/i);

      // Rapid click 2 while busy: disabled button prevents concurrent/duplicate API trigger
      fireEvent.click(readyBtn);

      // Await the async microtask that invokes updateServiceReadiness
      await waitFor(() => {
        expect(mockApiService.updateServiceReadiness).toHaveBeenCalledTimes(1);
      });

      // Resolve the API call to complete clean cycle
      await act(async () => {
        resolveApi!({ success: true, vehicle: mockVehicle1 });
      });
    });

    it('InventoryTableV2: handles high-frequency concurrent clicks across multiple rows without crosstalk', () => {
      const vA = createMockVehicle({ id: 'V-A', stockNumber: 'STK-A', vin: '1FTFW1E86HFA00001' });
      const vB = createMockVehicle({ id: 'V-B', stockNumber: 'STK-B', vin: '1FTFW1E86HFA00002' });
      const vC = createMockVehicle({ id: 'V-C', stockNumber: 'STK-C', vin: '1FTFW1E86HFA00003' });

      const onSelect = vi.fn();
      const onView = vi.fn();
      const onMove = vi.fn();
      const onRequest = vi.fn();

      render(
        <InventoryTableV2
          vehicles={[vA, vB, vC]}
          selectedVehicleId={null}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={onSelect}
          onViewVehicle={onView}
          onTrackMovement={onMove}
          onRequestVehicle={onRequest}
          canRequestVehicle={true}
        />,
      );

      // Rapidly fire clicks across different rows and actions
      const viewA = screen.getByRole('button', { name: /View details for STK-A/i });
      const moveB = screen.getByRole('button', { name: /Move vehicle STK-B/i });
      const reqC = screen.getByRole('button', { name: /Request transfer for STK-C/i });

      fireEvent.click(viewA);
      fireEvent.click(moveB);
      fireEvent.click(reqC);

      expect(onView).toHaveBeenCalledTimes(1);
      expect(onView).toHaveBeenCalledWith(vA);

      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove).toHaveBeenCalledWith(vB);

      expect(onRequest).toHaveBeenCalledTimes(1);
      expect(onRequest).toHaveBeenCalledWith(vC);
    });
  });

  // =========================================================================
  // 2. Boundary Inputs & Extreme Edge Cases
  // =========================================================================
  describe('Boundary Inputs & Extreme Edge Cases', () => {
    it('renders vehicles with zero photos gracefully in VehicleWorkspaceV2 and InventoryTableV2', () => {
      const zeroPhotoVehicle = createMockVehicle({
        id: 'V-ZERO-PHOTO',
        imageUrl: null,
        imageUrls: [],
        photoCount: 0,
      });

      // 1. In VehicleWorkspaceV2
      const { unmount } = render(
        <VehicleWorkspaceV2 vehicle={zeroPhotoVehicle} homeStore={mockStore} onClose={vi.fn()} />,
      );

      const placeholder = document.querySelector('.vdp-gallery-placeholder');
      expect(placeholder).toBeInTheDocument();
      expect(placeholder).toHaveTextContent(/No photos uploaded/i);
      expect(placeholder).toHaveTextContent(/No photo URLs were supplied/i);
      expect(document.querySelector('.vdp-gallery-strip')).not.toBeInTheDocument();
      // When zero photos are uploaded, count badge is not displayed
      expect(document.querySelector('.vdp-gallery-count')).toBeNull();

      unmount();

      // 2. In InventoryTableV2
      render(
        <InventoryTableV2
          vehicles={[zeroPhotoVehicle]}
          selectedVehicleId={null}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />,
      );

      // Row thumbnail should show the CarFront fallback icon without a broken img tag
      const thumb = document.querySelector('.inv-v2-vehicle-thumb');
      expect(thumb).toBeInTheDocument();
      expect(thumb?.querySelector('img')).toBeNull();
      expect(thumb?.querySelector('svg')).toBeInTheDocument();
    });

    it('renders vehicles with 100+ character titles without layout overflow or truncation errors', () => {
      const extremeTitle =
        '2024 Ford Super Duty F-450 DRW Platinum Crew Cab 4x4 Long Bed Dual Rear Wheel High Output Power Stroke Turbo Diesel Limited Addition Ultimate';
      expect(extremeTitle.length).toBeGreaterThan(120);

      const longTitleVehicle = createMockVehicle({
        id: 'V-EXTREME-TITLE',
        year: 2024,
        make: 'Ford',
        model: 'Super Duty F-450 DRW Platinum',
        trim: 'Crew Cab 4x4 Long Bed Dual Rear Wheel High Output Power Stroke Turbo Diesel Limited Addition Ultimate',
      });

      // In VehicleWorkspaceV2
      const { unmount } = render(
        <VehicleWorkspaceV2 vehicle={longTitleVehicle} homeStore={mockStore} onClose={vi.fn()} />,
      );

      const titleHeading = document.querySelector('#inventory-workspace-title');
      expect(titleHeading).toBeInTheDocument();
      expect(titleHeading?.textContent?.length).toBeGreaterThanOrEqual(50);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-label', expect.stringContaining('2024 Ford'));

      unmount();

      // In InventoryTableV2
      render(
        <InventoryTableV2
          vehicles={[longTitleVehicle]}
          selectedVehicleId={null}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />,
      );

      const titleBtn = document.querySelector('.inv-v2-title-btn');
      expect(titleBtn).toBeInTheDocument();
      expect(titleBtn?.textContent).toContain('2024 Ford');
    });

    it('handles vehicles with completely missing equipment and hold metadata without throwing', () => {
      const emptyMetaVehicle = createMockVehicle({
        factoryEquipment: undefined,
        windowSticker: undefined,
        fordOasis: undefined,
        dealerMail: {
          dataState: 'unverified' as unknown as any,
          hasActiveHold: null,
          canViewEvidence: false,
          canManageHold: false,
        },
        holdEvidence: undefined,
        serviceReadiness: undefined,
        movement: undefined,
        location: {
          homeStore: { id: 'howell', name: 'Howell' },
          sourceReportedStore: { id: 'howell', name: 'Howell' },
          conflict: false,
        },
        msrp: null,
        price: 0,
        mileage: null,
      });

      render(<VehicleWorkspaceV2 vehicle={emptyMetaVehicle} homeStore={mockStore} onClose={vi.fn()} />);

      // Equipment fallback
      expect(screen.getByText(/No equipment highlights captured/i)).toBeInTheDocument();

      // Hold status fallback
      expect(screen.getByText(/Hold status unverified/i)).toBeInTheDocument();

      // Financials fallback for null msrp
      expect(screen.getByText(/Weight fee lookup · Base MSRP/i)).toBeInTheDocument();
      expect(screen.getByText(/\$0/i)).toBeInTheDocument();

      // Location fallback
      expect(screen.getAllByText('Howell').length).toBeGreaterThanOrEqual(1);
    });

    it('calculateCountdown boundary oracle: handles null, undefined, invalid, past, and future dueAt dates', () => {
      const now = Date.now();

      // Case 1: dueAt is null or undefined
      expect(calculateCountdown(null)).toEqual({
        label: 'No deadline',
        isOverdue: false,
        isDueSoon: false,
      });
      expect(calculateCountdown(undefined)).toEqual({
        label: 'No deadline',
        isOverdue: false,
        isDueSoon: false,
      });

      // Case 2: dueAt is an invalid/unparseable string
      expect(calculateCountdown('invalid-date-string')).toEqual({
        label: 'No deadline',
        isOverdue: false,
        isDueSoon: false,
      });

      // Case 3: dueAt is null or invalid, but SLA is flagged overdue or breached
      expect(calculateCountdown(null, 'breached')).toEqual({
        label: 'Action Overdue',
        isOverdue: true,
        isDueSoon: false,
      });
      expect(calculateCountdown('invalid-date', 'overdue')).toEqual({
        label: 'Action Overdue',
        isOverdue: true,
        isDueSoon: false,
      });
      expect(calculateCountdown(null, undefined, true)).toEqual({
        label: 'Action Overdue',
        isOverdue: true,
        isDueSoon: false,
      });

      // Case 4: Past dueAt (overdue by 3 days)
      const past3Days = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
      const resPast3d = calculateCountdown(past3Days);
      expect(resPast3d.isOverdue).toBe(true);
      expect(resPast3d.label).toMatch(/Overdue by 3d/i);

      // Case 5: Past dueAt (overdue by 45 minutes)
      const past45m = new Date(now - 45 * 60 * 1000).toISOString();
      const resPast45m = calculateCountdown(past45m);
      expect(resPast45m.isOverdue).toBe(true);
      expect(resPast45m.label).toMatch(/Overdue by 45m/i);

      // Case 6: Future dueAt due soon (in ~2 hours, buffer with 10s for exact hour calculation)
      const future2h = new Date(now + 2 * 60 * 60 * 1000 + 10000).toISOString();
      const resFuture2h = calculateCountdown(future2h);
      expect(resFuture2h.isOverdue).toBe(false);
      expect(resFuture2h.isDueSoon).toBe(true);
      expect(resFuture2h.label).toMatch(/Due in 2h/i);

      // Case 7: Future dueAt due soon via SLA ('due-soon') even if 10h out
      const future10h = new Date(now + 10 * 60 * 60 * 1000).toISOString();
      const resFutureSla = calculateCountdown(future10h, 'due-soon');
      expect(resFutureSla.isOverdue).toBe(false);
      expect(resFutureSla.isDueSoon).toBe(true);

      // Case 8: Distant future dueAt (in 7 days)
      const future7d = new Date(now + 7 * 24 * 60 * 60 * 1000 + 10000).toISOString();
      const resFuture7d = calculateCountdown(future7d);
      expect(resFuture7d.isOverdue).toBe(false);
      expect(resFuture7d.isDueSoon).toBe(false);
      expect(resFuture7d.label).toMatch(/Due in 7d/i);
    });

    it('TransfersPageV2 renders queue with mixed past, future, and null dueAt transfers correctly', () => {
      render(
        <MemoryRouter>
          <TransfersPageV2 />
        </MemoryRouter>,
      );

      // Past transfer TR-PAST-01 should display overdue warning alert
      expect(screen.getByText(/Overdue by 2d/i)).toBeInTheDocument();

      // Future transfer TR-FUTURE-02 should display countdown
      expect(screen.getByText(/Due in (1h 59m|2h)/i)).toBeInTheDocument();

      // Null dueAt transfer TR-NULL-03 should display "No deadline"
      expect(screen.getByText(/No deadline/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 3. Escape Key Modal Dismiss, Focus Restoration & Backdrop Click Outside
  // =========================================================================
  describe('Escape Key Modal Dismiss, Focus Restoration & Backdrop Click Outside', () => {
    it('dismisses workspace modal on backdrop click outside', () => {
      const onClose = vi.fn();
      const vehicle = createMockVehicle();

      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={onClose} />);

      const backdrop = document.querySelector('.vdp-focus-backdrop');
      expect(backdrop).toBeInTheDocument();

      fireEvent.click(backdrop!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('dismisses workspace modal on Escape key press', () => {
      const onClose = vi.fn();
      const vehicle = createMockVehicle();

      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={onClose} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('restores focus to opener button upon closing workspace modal', () => {
      // Create and mount an opener button in the document
      const openerBtn = document.createElement('button');
      openerBtn.id = 'test-vdp-opener-btn';
      openerBtn.textContent = 'Open VDP Details';
      document.body.appendChild(openerBtn);
      openerBtn.focus();
      expect(document.activeElement).toBe(openerBtn);

      const returnFocusRef = { current: openerBtn };
      const vehicle = createMockVehicle();

      // Render VehicleWorkspaceV2 with returnFocusRef pointing to opener
      const { unmount } = render(
        <VehicleWorkspaceV2
          vehicle={vehicle}
          homeStore={mockStore}
          onClose={vi.fn()}
          returnFocusRef={returnFocusRef}
        />,
      );

      // Unmount simulating closing the dialog
      unmount();

      // Focus should be restored to the opener button
      expect(document.activeElement).toBe(openerBtn);

      openerBtn.remove();
    });

    it('nested modal isolation: Escape closes TakeHomeSheet dialog without closing VehicleWorkspaceV2', () => {
      const onCloseWorkspace = vi.fn();
      const vehicle = createMockVehicle();

      render(
        <VehicleWorkspaceV2
          vehicle={vehicle}
          homeStore={mockStore}
          onClose={onCloseWorkspace}
        />,
      );

      // Open TakeHomeSheet dialog from action dock
      const takeHomeDockBtn = screen.getByRole('button', { name: /Take-Home Sheet/i });
      fireEvent.click(takeHomeDockBtn);

      // Both dialogs should now be in the DOM
      const dialogs = screen.getAllByRole('dialog');
      expect(dialogs.length).toBe(2);

      // The top dialog is the TakeHomeSheet
      const takeHomeDialog = dialogs[dialogs.length - 1];
      expect(takeHomeDialog).toHaveAttribute('aria-labelledby', 'takehome-title');
      expect(screen.getByText(/Take-home page · W5863Q/i)).toBeInTheDocument();

      // Press Escape: Should close TakeHomeSheet, NOT the underlying workspace
      fireEvent.keyDown(document, { key: 'Escape' });

      // Workspace onClose should NOT have been called
      expect(onCloseWorkspace).not.toHaveBeenCalled();

      // Now only 1 dialog (Workspace) remains in the DOM
      expect(screen.getAllByRole('dialog').length).toBe(1);
    });
  });

  // =========================================================================
  // 4. Guardrail G1: Baseline V1 File Zero Diff Verification
  // =========================================================================
  describe('Guardrail G1: Baseline V1 Code Preservation', () => {
    it('verifies git status on baseline V1 files has 0 diff', () => {
      const baselineV1Files = [
        'src/features/inventory/VehicleWorkspace.tsx',
        'src/features/inventory/InventoryExperience.tsx',
        'src/features/inventory/InventoryPage.tsx',
        'src/features/service/ServicePage.tsx',
        'src/features/transfers/TransfersPage.tsx',
      ];

      // Check git status --porcelain on all baseline V1 files
      const statusOutput = execSync(
        `git status --porcelain ${baselineV1Files.join(' ')}`,
        { encoding: 'utf-8' },
      ).trim();

      expect(statusOutput).toBe('');

      // Check git diff HEAD -- on all baseline V1 files
      const diffOutput = execSync(
        `git diff HEAD -- ${baselineV1Files.join(' ')}`,
        { encoding: 'utf-8' },
      ).trim();

      expect(diffOutput).toBe('');
    });
  });
});
