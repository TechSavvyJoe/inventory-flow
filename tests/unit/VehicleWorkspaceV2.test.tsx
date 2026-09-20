import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VehicleWorkspaceV2 } from '../../src/features/inventory/VehicleWorkspaceV2';
import { InventoryExperienceV2 } from '../../src/features/inventory/InventoryExperienceV2';
import type { InventoryStore, InventoryDecisionMetrics } from '../../src/features/inventory/types';
import { createMockVehicle, setupClipboardMock } from './testHelpers';

describe('VehicleWorkspaceV2 Unit Tests', () => {
  const mockStore: InventoryStore = { id: 'howell', name: 'Howell' };
  const mockMetrics: InventoryDecisionMetrics = {
    publicUnits: 1,
    currentHolds: 0,
    awayFromHome: 0,
    returnOverdue: 0,
  };

  beforeEach(() => {
    setupClipboardMock();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('3-Column Cockpit Layout & Nesting', () => {
    it('renders dialog container with accessible aria attributes and id', () => {
      const vehicle = createMockVehicle();
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('id', 'inventory-vehicle-workspace');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-label', expect.stringContaining(vehicle.year.toString()));
    });

    it('renders cockpit grid with left, mid, and right column structures', () => {
      const vehicle = createMockVehicle();
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      expect(document.querySelector('.vdp-dash-col-left')).toBeInTheDocument();
      expect(document.querySelector('.vdp-dash-col-mid')).toBeInTheDocument();
      expect(document.querySelector('.vdp-dash-col-right')).toBeInTheDocument();
    });

    it('renders copyable Stock # and VIN in persistent header rail', () => {
      const vehicle = createMockVehicle({ stockNumber: 'STK12345', vin: '1FTFW1E86HFA99999' });
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      expect(screen.getByText('STK12345')).toBeInTheDocument();
      expect(screen.getByText('1FTFW1E86HFA99999')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy stock number: STK12345/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy VIN: 1FTFW1E86HFA99999/i })).toBeInTheDocument();
    });
  });

  describe('Column 1: Gallery, Specs & Financials', () => {
    it('renders photo count badge and switches preview image on thumbnail click', () => {
      const vehicle = createMockVehicle({
        imageUrl: 'https://example.com/img1.jpg',
        imageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
        photoCount: 2,
      });
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      const countBadge = document.querySelector('.vdp-gallery-count');
      expect(countBadge).toHaveTextContent(/1 \/ 2/);

      expect(document.querySelector('.vdp-gallery-main img')).toHaveAttribute('src', 'https://example.com/img1.jpg');

      const thumbnailsContainer = document.querySelector('.inventory-workspace-gallery__thumbnails');
      expect(thumbnailsContainer).toBeInTheDocument();
      expect(thumbnailsContainer).toHaveClass('vdp-gallery-strip');

      const thumbnails = document.querySelectorAll('.vdp-gallery-strip button');
      expect(thumbnails.length).toBe(2);

      fireEvent.click(thumbnails[1]);
      expect(document.querySelector('.vdp-gallery-main img')).toHaveAttribute('src', 'https://example.com/img2.jpg');
    });

    it('renders gallery thumbnail strip when vehicle has photos', () => {
      const vehicle = createMockVehicle({
        imageUrl: 'https://example.com/img1.jpg',
        imageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
        photoCount: 2,
      });
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      const thumbnailStrip = document.querySelector('.inventory-workspace-gallery__thumbnails');
      expect(thumbnailStrip).toBeInTheDocument();
      expect(thumbnailStrip).toHaveClass('vdp-gallery-strip');
      expect(thumbnailStrip?.querySelectorAll('button')).toHaveLength(2);
    });

    it('renders graceful fallback when zero photos are present', () => {
      const vehicle = createMockVehicle({
        imageUrl: null,
        imageUrls: [],
        photoCount: 0,
      });
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      const placeholder = document.querySelector('.vdp-gallery-placeholder');
      expect(placeholder).toBeInTheDocument();
      expect(placeholder).toHaveTextContent(/No photos uploaded/i);
    });

    it('renders formatted pricing, Base MSRP, and calculated MSRP delta', () => {
      const vehicle = createMockVehicle({
        price: 54995,
        msrp: 62240,
        windowSticker: { basePrice: 51200, dataState: 'current' },
      });
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      expect(screen.getByText('$54,995')).toBeInTheDocument();
      expect(screen.getByText('$51,200')).toBeInTheDocument();
      expect(screen.getByText(/\$7,245 under MSRP/i)).toBeInTheDocument();
    });
  });

  describe('Column 2: Hold, Service & Movement Quick Actions', () => {
    it('displays active hold summary with salesperson and toggleable DealerMail drawer', () => {
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
            customerOrReason: 'Retail deposit pending',
            expectedDeliveryDate: '2026-09-20',
          },
        ],
      });
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      expect(screen.getAllByText(/Sarah Connor/i).length).toBeGreaterThanOrEqual(1);

      const drawerBtn = screen.getByRole('button', { name: /Update Hold/i });
      fireEvent.click(drawerBtn);

      expect(screen.getByRole('button', { name: /Hide Tools/i })).toBeInTheDocument();
    });

    it('handles optimistic service readiness state transitions', () => {
      const vehicle = createMockVehicle({
        serviceReadiness: {
          vin: '1FTFW1E86HFA48871',
          version: 1,
          status: 'needs_service',
          serviceEnteredAt: '2026-08-20T10:00:00Z',
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

      expect(screen.getByText(/Waiting for service/i)).toBeInTheDocument();

      // Click "Start Service"
      const startServiceBtn = screen.getByRole('button', { name: /Start Service/i });
      fireEvent.click(startServiceBtn);

      expect(screen.getByText('In service')).toBeInTheDocument();

      // Click "Mark Ready"
      const markReadyBtn = screen.getByRole('button', { name: /Mark Ready/i });
      fireEvent.click(markReadyBtn);

      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getByText('Ready for delivery')).toBeInTheDocument();
    });

    it('renders current store physical location and tracking link', () => {
      const onTrackMovement = vi.fn();
      const vehicle = createMockVehicle({
        movement: { requestId: 'MOV-1234', state: 'in_transit' },
        location: {
          homeStore: { id: 'howell', name: 'Howell' },
          conflict: false,
          currentStore: 'Fowlerville',
        } as any,
      });
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onTrackMovement={onTrackMovement} onClose={vi.fn()} />);

      expect(screen.getAllByText('Fowlerville').length).toBeGreaterThanOrEqual(1);

      const trackBtn = screen.getByRole('button', { name: /Tracking Link/i });
      fireEvent.click(trackBtn);
      expect(onTrackMovement).toHaveBeenCalledWith(vehicle);
    });
  });

  describe('Column 3: Standout Equipment & 2x2 Document Cards Hub', () => {
    it('renders standout factory equipment with category badges', () => {
      const vehicle = createMockVehicle();
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      const items = document.querySelectorAll('.vdp-equipment-highlight-item');
      expect(items.length).toBeGreaterThan(0);
      expect(document.querySelector('.vdp-equipment-category-badge')).toBeInTheDocument();
    });

    it('renders 2x2 Document Cards Hub with resources', () => {
      const vehicle = createMockVehicle({
        factoryEquipment: {
          dataState: 'current',
          url: 'https://vauto.example.com/equipment/1FTFW1E86HFA48871',
          totalMsrp: 62240,
          packages: [
            { name: 'FX4 Off-Road', code: '55A' },
            { name: 'Tow Tech Bundle', code: '52T' },
          ],
        } as any,
      });
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      const docCards = document.querySelector('.vdp-document-cards-hub');
      expect(docCards).toBeInTheDocument();

      const cardsContainer = docCards?.querySelector('.vehicle-resources--cards');
      expect(cardsContainer).toBeInTheDocument();

      const resourceCards = cardsContainer?.querySelectorAll('.vehicle-resource-card');
      expect(resourceCards).toHaveLength(4);

      // Verify all 4 resource cards (Window Sticker, AutoCheck, vAuto, OASIS)
      const windowStickerCard = cardsContainer?.querySelector('[data-resource="window-sticker"]');
      const autoCheckCard = cardsContainer?.querySelector('[data-resource="autocheck"]');
      const vAutoCard = cardsContainer?.querySelector('[data-resource="vauto"]');
      const oasisCard = cardsContainer?.querySelector('[data-resource="oasis"]');

      expect(windowStickerCard).toBeInTheDocument();
      expect(autoCheckCard).toBeInTheDocument();
      expect(vAutoCard).toBeInTheDocument();
      expect(oasisCard).toBeInTheDocument();

      // Verify resource content and labels
      expect(windowStickerCard).toHaveTextContent(/Window sticker/i);
      expect(autoCheckCard?.querySelector('[aria-label*="AutoCheck"]')).toBeInTheDocument();
      expect(vAutoCard?.querySelector('[aria-label*="vAuto"]')).toBeInTheDocument();
      expect(oasisCard).toHaveTextContent(/OASIS/i);
    });
  });

  describe('Persistent Action Dock & Modal Interactions', () => {
    it('opens TakeHomeSheet dialog from action dock and allows dismissal', () => {
      const vehicle = createMockVehicle();
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />);

      const takeHomeBtn = screen.getByRole('button', { name: /Take-home page/i });
      fireEvent.click(takeHomeBtn);

      expect(screen.getAllByRole('dialog').length).toBe(2);

      const closeDialogBtn = screen.getByRole('button', { name: /^Close$/i });
      fireEvent.click(closeDialogBtn);

      expect(screen.getAllByRole('dialog').length).toBe(1);
    });

    it('dismisses workspace via backdrop click and Escape key', () => {
      const onClose = vi.fn();
      const vehicle = createMockVehicle();
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={onClose} />);

      // Backdrop click
      const backdrop = document.querySelector('.vdp-focus-backdrop');
      if (backdrop) {
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);
      }

      // Escape key
      const dialog = screen.getByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('InventoryExperienceV2 Integration', () => {
    it('connects VehicleWorkspaceV2 when selectedVehicleId is provided', () => {
      const vehicle = createMockVehicle({ id: 'V-100', stockNumber: 'STK-V100' });
      const onCloseSelection = vi.fn();

      render(
        <InventoryExperienceV2
          homeStore={mockStore}
          vehicles={[vehicle]}
          metrics={mockMetrics}
          selectedVehicleId="V-100"
          onSelectedVehicleChange={onCloseSelection}
        />
      );

      // Should render VehicleWorkspaceV2 with V-100
      expect(screen.getByRole('dialog', { name: /vehicle workspace/i })).toBeInTheDocument();
      expect(screen.getAllByText('STK-V100').length).toBeGreaterThanOrEqual(1);

      // Clicking close button calls onSelectedVehicleChange(null)
      const closeBtn = screen.getByRole('button', { name: /Close vehicle details/i });
      fireEvent.click(closeBtn);
      expect(onCloseSelection).toHaveBeenCalledWith(null);
    });
  });
});
