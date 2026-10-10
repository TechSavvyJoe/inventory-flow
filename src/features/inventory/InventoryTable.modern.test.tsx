// @ts-expect-error Synthetic fixture is an intentionally untyped Node ESM module.
import { buildSyntheticRelease } from "../../../fixtures/synthetic-release.mjs";
import { equipmentFinderItems } from "./vehicle-equipment";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryMobileList, InventoryTable, VehiclePhoto, vehicleOperationalStatus } from './InventoryTable';
import type { InventoryVehicle } from './types';
import type { ServiceReadinessStatus } from '../../types';
import { dealerMailInteractiveVehicleUrl } from './vehicle-document-utils';

afterEach(cleanup);

function resource(id: string, container: ParentNode = document.body): HTMLElement {
  const control = container.querySelector<HTMLElement>(`[data-resource="${id}"]`);
  expect(control, `Visible resource ${id}`).not.toBeNull();
  return control!;
}

function heldMovingVehicle(): InventoryVehicle {
  return {
    id: '1FTFW1E84RKF12345',
    vin: '1FTFW1E84RKF12345',
    stockNumber: 'H240512',
    year: 2024,
    make: 'Ford',
    model: 'F-150',
    trim: 'XLT',
    price: 46995,
    msrp: 52995,
    mileage: 8642,
    daysListed: 21,
    bodyStyle: 'SuperCrew pickup',
    drivetrain: '4x4',
    engine: '2.7L EcoBoost V6',
    transmission: '10-speed automatic',
    exteriorColor: 'Oxford White',
    interiorColor: 'Black',
    fuelType: 'Gasoline',
    certified: true,
    changeSummary: 'Price changed today',
    publicListing: {
      dataState: 'current',
      isListed: true,
      listingUrl: 'https://www.bobmaxeyfordhowell.com/used/Ford/2024-Ford-F-150-vehicle-token.htm',
    },
    dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
    dealerMail: {
      dataState: 'current',
      hasActiveHold: true,
      position: 'primary',
      activeRecordCount: 1,
      canManageHold: true,
      canViewEvidence: true,
    },
    holdEvidence: [{ id: 'hold-1', position: 'primary', salesperson: 'Alex Morgan', customerOrReason: 'Customer appointment' }],
    location: {
      homeStore: { id: 'howell', name: 'Howell' },
      appConfirmedStore: { id: 'fowlerville', name: 'Fowlerville' },
      appConfirmedLocation: 'Fowlerville',
    },
    movement: {
      state: 'In transit outbound',
      requestId: 'move-1',
      nextAction: 'Confirm arrival',
    },
    autoCheckReport: {
      dataState: 'current',
      url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token',
      score: 92,
      ownerCount: 1,
      usage: 'Personal',
    },
    windowSticker: {
      dataState: 'current',
      url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U',
      equipmentGroup: 'Equipment Group 302A',
      totalMsrp: 52995,
      options: ['XLT Sport Appearance Package'],
    },
    factoryEquipment: {
      dataState: 'current',
      isOriginalWindowSticker: false,
      url: 'https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg',
      totalMsrp: 52995,
      packages: [{ name: 'Trailer Tow Package', code: '53A' }],
    },
  };
}

describe('modern inventory result access', () => {
  it('aligns complete source evidence beneath its decision column and keeps actions with pricing', () => {
    const vehicle = heldMovingVehicle();
    const onSelectVehicle = vi.fn();
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={onSelectVehicle} />);
    expect(screen.getAllByRole('columnheader').map(header => header.getAttribute('aria-label'))).toEqual(['Vehicle & pricing', 'Configuration', 'History', 'Operations']);
    const history = screen.getByRole('region', { name: 'History source evidence for 2024 Ford F-150 XLT' });
    const equipment = screen.getByRole('region', { name: 'Factory equipment source evidence for 2024 Ford F-150 XLT' });
    const oasis = screen.getByRole('region', { name: 'OASIS source evidence for 2024 Ford F-150 XLT' });
    expect(history.closest('td')).toHaveAttribute('data-column', 'history');
    expect(equipment.closest('td')).toHaveAttribute('data-column', 'configuration');
    expect(oasis.closest('td')).toHaveAttribute('data-column', 'status');
    const actions = screen.getByRole('group', { name: 'Actions for 2024 Ford F-150 XLT' });
    expect(actions.closest('td')).toHaveAttribute('colspan', '4');
    expect(actions.closest('tr')).toHaveClass('inv-desk-footer');
    expect(history.closest('tr')).toHaveClass('inv-desk-row');
    const tiers = actions.closest('tbody')!.children;
    expect(tiers).toHaveLength(2);
    expect(tiers[0].querySelectorAll('td')).toHaveLength(4);
    expect(tiers[0].querySelector('[rowspan],[colspan]')).toBeNull();
    expect(tiers[1].querySelectorAll('td')).toHaveLength(1);
    expect(tiers[1].firstElementChild).toHaveAttribute('colspan', '4');
    expect(actions.closest('tbody')).toBe(history.closest('tbody'));
    const external = within(history).getByRole('link', { name: 'Open AutoCheck report in a new tab' });
    fireEvent.click(external);
    expect(onSelectVehicle).not.toHaveBeenCalled();
  });

  describe.each(['desktop', 'mobile'] as const)('%s inventory action geography', layout => {
    function renderRow(vehicle: InventoryVehicle, onSelectVehicle = vi.fn(), onRequestVehicle = vi.fn()) {
      const props = { vehicles: [vehicle], onSelectVehicle, canRequestVehicle: () => true, onRequestVehicle };
      if (layout === 'desktop') render(<InventoryTable {...props} sorts={[]} onSortChange={vi.fn()} />);
      else render(<InventoryMobileList {...props} />);
      return { onSelectVehicle, onRequestVehicle };
    }

    it('copies exact stock, VIN, mileage and explicit base MSRP from identity without selecting the row', async () => {
      const vehicle = heldMovingVehicle();
      vehicle.windowSticker = { ...vehicle.windowSticker!, basePrice: 48750 };
      const writeText = vi.fn().mockResolvedValue(undefined);
      const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      try {
        const { onSelectVehicle } = renderRow(vehicle);
        for (const [label, raw] of [['stock number', vehicle.stockNumber], ['VIN', vehicle.vin], ['mileage', '8642'], ['window sticker base MSRP', '48750']]) {
          const copy = screen.getByRole('button', { name: `Copy ${label}: ${raw}` });
          if (layout === 'desktop') expect(copy.closest('td')).toHaveAttribute('data-column', 'vehicle');
          else expect(copy.closest('button.inventory-mobile-row__open')).toBeNull();
          await userEvent.click(copy);
          expect(writeText).toHaveBeenLastCalledWith(raw);
        }
        expect(writeText).toHaveBeenCalledTimes(4);
        expect(onSelectVehicle).not.toHaveBeenCalled();
      } finally {
        if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
        else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      }
    });

    it('groups Records, Request, Save and Listing in a stable order with separate destinations', () => {
      const vehicle = heldMovingVehicle();
      vehicle.movement = undefined;
      const { onSelectVehicle, onRequestVehicle } = renderRow(vehicle);
      const actions = screen.getByRole('group', { name: 'Actions for 2024 Ford F-150 XLT' });
      const buttons = within(actions).getAllByRole('button');
      expect(buttons).toHaveLength(3);
      expect(buttons[0]).toHaveAccessibleName('Open vehicle records for 2024 Ford F-150 XLT');
      const request = within(actions).getByRole('button', { name: 'Request vehicle 2024 Ford F-150 XLT' });
      const save = within(actions).getByRole('button', { name: 'Save H240512 to shortlist' });
      expect(buttons[layout === 'desktop' ? 2 : 1]).toBe(request);
      expect(buttons[layout === 'desktop' ? 1 : 2]).toBe(save);
      const listing = within(actions).getByRole('link', { name: 'Open listing for 2024 Ford F-150 XLT in a new tab' });
      expect(listing).toHaveAttribute('href', vehicle.publicListing.listingUrl);
      expect(listing).toHaveAttribute('target', '_blank');
      expect(save.compareDocumentPosition(listing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      if (layout === 'desktop') expect(listing.compareDocumentPosition(request) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(request);
      expect(onRequestVehicle).toHaveBeenCalledExactlyOnceWith(vehicle);
      fireEvent.click(buttons[0]);
      expect(screen.getByRole('dialog', { name: '2024 Ford F-150 XLT records' })).toBeVisible();
      expect(onSelectVehicle).not.toHaveBeenCalled();
    });

    it('keeps an unavailable Listing control in the full action group without navigation', () => {
      const vehicle = heldMovingVehicle();
      vehicle.publicListing = { ...vehicle.publicListing, listingUrl: undefined };
      const onSelectVehicle = vi.fn();
      const onOpenListing = vi.fn();
      const props = { vehicles: [vehicle], onSelectVehicle, onOpenListing };
      if (layout === 'desktop') render(<InventoryTable {...props} sorts={[]} onSortChange={vi.fn()} />);
      else render(<InventoryMobileList {...props} />);
      const actions = screen.getByRole('group', { name: 'Actions for 2024 Ford F-150 XLT' });
      const unavailable = within(actions).getByRole('button', { name: 'Listing unavailable for 2024 Ford F-150 XLT' });
      expect(unavailable).toBeDisabled();
      expect(unavailable).toHaveTextContent('Listing');
      expect(unavailable).toHaveAttribute('title', 'No captured public listing link');
      expect(within(actions).queryByRole('link', { name: /Open listing/ })).not.toBeInTheDocument();
      fireEvent.click(unavailable);
      expect(onOpenListing).not.toHaveBeenCalled();
      expect(onSelectVehicle).not.toHaveBeenCalled();
    });

    it('keeps the same named row actions when movement permission is absent', () => {
      const vehicle = heldMovingVehicle();
      vehicle.movement = undefined;
      const onSelectVehicle = vi.fn();
      const onRequestVehicle = vi.fn();
      const props = { vehicles: [vehicle], onSelectVehicle, canRequestVehicle: () => false, onRequestVehicle };
      if (layout === 'desktop') render(<InventoryTable {...props} sorts={[]} onSortChange={vi.fn()} />);
      else render(<InventoryMobileList {...props} />);
      const actions = screen.getByRole('group', { name: 'Actions for 2024 Ford F-150 XLT' });
      expect(within(actions).queryByRole('button', { name: /Request vehicle|Track movement/ })).not.toBeInTheDocument();
      expect(within(actions).getByRole('button', { name: 'Save H240512 to shortlist' })).toBeVisible();
      expect(within(actions).getByRole('link', { name: 'Open listing for 2024 Ford F-150 XLT in a new tab' })).toBeVisible();
      fireEvent.click(within(actions).getByRole('button', { name: 'Open vehicle records for 2024 Ford F-150 XLT' }));
      expect(screen.getByRole('dialog', { name: '2024 Ford F-150 XLT records' })).toBeVisible();
      expect(onSelectVehicle).not.toHaveBeenCalled();
      expect(onRequestVehicle).not.toHaveBeenCalled();
    });

    it('preserves independent tracking and explicit move actions when both apply', () => {
      const vehicle = heldMovingVehicle();
      const onSelectVehicle = vi.fn();
      const onTrackMovement = vi.fn();
      const onMoveVehicle = vi.fn();
      const props = { vehicles: [vehicle], onSelectVehicle, onTrackMovement, onMoveVehicle, moveActionFor: () => ({ intent: 'direct' as const, label: 'Move vehicle', shortLabel: 'Move' }) };
      if (layout === 'desktop') render(<InventoryTable {...props} sorts={[]} onSortChange={vi.fn()} />);
      else render(<InventoryMobileList {...props} />);
      const actions = screen.getByRole('group', { name: 'Actions for 2024 Ford F-150 XLT' });
      fireEvent.click(within(actions).getByRole('button', { name: 'Track movement for 2024 Ford F-150 XLT' }));
      expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(vehicle);
      expect(onMoveVehicle).not.toHaveBeenCalled();
      fireEvent.click(within(actions).getByRole('button', { name: 'Move vehicle 2024 Ford F-150 XLT' }));
      expect(onMoveVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'direct');
      expect(onSelectVehicle).not.toHaveBeenCalled();
    });

    it('names external AutoCheck reports and captured vehicle-detail destinations explicitly', () => {
      const vehicle = heldMovingVehicle();
      const { onSelectVehicle } = renderRow(vehicle);
      const external = screen.getByRole('link', { name: 'Open AutoCheck report in a new tab' });
      expect(external).toHaveTextContent('Open AutoCheck report');
      expect(external).toHaveAttribute('href', vehicle.autoCheckReport!.url);
      expect(external).toHaveAttribute('target', '_blank');
      cleanup();
      vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, url: undefined, accessMethod: 'vauto' };
      renderRow(vehicle, onSelectVehicle);
      const captured = screen.getByRole('button', { name: 'View captured AutoCheck records in vehicle details' });
      expect(captured).toHaveTextContent('View captured AutoCheck');
      fireEvent.click(captured);
      expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'data');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
  describe.each(['desktop', 'mobile'] as const)('%s independent manual and imported hold facts', layout => {
    function renderManual(imported: 'active' | 'none' | 'stale', canViewEvidence = true) {
      const vehicle = heldMovingVehicle();
      vehicle.manualHold = { vin: vehicle.vin, state: 'active', version: 1, expectedDeliveryDate: '2026-10-09', updatedAt: null, ownerStore: 'Howell', canManage: true, enabled: true };
      vehicle.dealerMail = { ...vehicle.dealerMail, dataState: imported === 'stale' ? 'stale' : 'current', hasActiveHold: imported === 'stale' ? null : imported === 'active', lastKnownActiveHold: imported === 'stale', activeRecordCount: imported === 'none' ? 0 : 3, canViewEvidence };
      vehicle.holdEvidence = [{ id: 'synthetic-imported-hold', position: 'primary', salesperson: 'Synthetic source owner', heldBy: 'Synthetic source holder', expectedDeliveryDate: '2026-10-02' }];
      if (layout === 'desktop') render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
      else render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);
      const manualFact = layout === 'desktop' ? screen.getByRole('group', { name: 'Inventory Flow hold' }) : screen.getByRole('button', { name: /Open hold details/ });
      const importedFact = screen.getByLabelText('Reported hold evidence');
      return { manualFact, importedFact: importedFact };
    }
    it.each(['active', 'none', 'stale'] as const)('qualifies %s imported facts separately from the manual expected date', imported => {
      const { manualFact, importedFact } = renderManual(imported);
      expect(manualFact).toHaveTextContent('Held');
      expect(manualFact).toHaveTextContent('Expected 10/09/2026');
      expect(manualFact).not.toHaveTextContent('10/02/2026');
      expect(manualFact).not.toHaveTextContent('Synthetic source holder');
      expect(importedFact).toHaveTextContent('DealerMail');
      expect(importedFact).toHaveTextContent(imported === 'none' ? 'No current hold' : imported === 'stale' ? 'Last verified hold' : 'Hold · Synthetic source owner');
      expect(importedFact).not.toHaveTextContent('10/09/2026');
      if (imported !== 'none') {
        expect(importedFact).toHaveTextContent('Expected 10/02/2026 · 2 backups · Held by Synthetic source holder');
      } else expect(importedFact).not.toHaveTextContent('Expected');
    });
    it('keeps private imported owner and date evidence redacted beside a visible manual hold', () => {
      const { importedFact } = renderManual('active', false);
      expect(importedFact).not.toHaveTextContent('Synthetic source owner');
      expect(importedFact).not.toHaveTextContent('Synthetic source holder');
      expect(importedFact).not.toHaveTextContent('10/02/2026');
      expect(importedFact).toHaveTextContent('2 backups');
    });
  });
  describe.each(['desktop', 'mobile'] as const)('%s recorded inventory decision', layout => {
    it.each([false, true])('shows Keep unless the independent records conflict (%s)', conflict => {
      const vehicle = heldMovingVehicle();
      vehicle.appDisposition = { vin: vehicle.vin, code: 'keep', version: 1, effectiveDate: null, destinationStore: null, updatedAt: null, updatedByRole: 'manager', store: 'Howell', ownerStore: 'Howell', canManage: true };
      vehicle.inventoryDecision = { status: 'unconfirmed', comparison: conflict ? 'conflict' : 'source_only', reasons: conflict ? ['keep_vs_imported_delivery'] : [], manualHold: null, importedHold: false, label: conflict ? 'Review conflicting records' : 'Confirm availability' };
      const onSelectVehicle = vi.fn();
      if (layout === 'desktop') render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={onSelectVehicle} />);
      else render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={onSelectVehicle} />);
      const control = screen.getByRole('button', { name: /Review inventory decision/ });
      expect(control).toHaveTextContent(conflict ? 'Records disagree' : 'Keep');
      expect(control).not.toHaveTextContent('Confirm availability');
      fireEvent.click(control);
      expect(onSelectVehicle).toHaveBeenCalledWith(vehicle, 'hold');
    });
  });
  describe.each(['desktop', 'mobile'] as const)('%s service readiness', (layout) => {
    it.each([
      ['unknown', 'Waiting for service'],
      ['needs_service', 'Waiting for service'],
      ['in_service', 'In service'],
      ['serviced', 'Ready'],
    ] as const)('shows %s in the row independently of hold and movement', (status, label) => {
      const vehicle = heldMovingVehicle();
      vehicle.serviceReadiness = { vin: vehicle.vin, status: status as ServiceReadinessStatus, version: 2, serviceEnteredAt: '2026-09-13', completedAt: status === 'serviced' ? '2026-09-14' : null, updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: 'Howell', canManage: false };
      if (layout === 'desktop') render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
      else render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);
      const row = layout === 'desktop' ? document.querySelector('tr.inv-desk-row') as HTMLElement : screen.getByRole('article');
      const link = within(row).getByRole('link', { name: `${label}. Open service status for VIN ${vehicle.vin}` });
      expect(link).toBeVisible();
      expect(link).toHaveAttribute('href', `/service?vin=${vehicle.vin}`);
      expect(link).toHaveTextContent(label);
      expect(link.closest('button')).toBeNull();
      expect(row).toHaveTextContent('Hold · Alex Morgan');
      expect(row).toHaveTextContent('In transit outbound');
    });

    it('shows the readiness source and dates in the inventory row', () => {
      const vehicle = heldMovingVehicle();
      vehicle.serviceReadiness = {
        vin: vehicle.vin, status: 'serviced', readinessBasis: 'ford_service_history_inspection', version: 0,
        serviceEnteredAt: '2026-08-14', completedAt: '2026-09-11', updatedAt: null, updatedBy: null,
        updatedByRole: null, updatedAtStore: null, store: 'Howell', canManage: false,
        readinessEvidence: {
          source: 'ford_service_history', inspectionDate: '2026-09-11', inServiceDate: '2026-08-14', readyDate: '2026-09-11', types: ['Certified Blue Oval inspection'],
        },
      };
      if (layout === 'desktop') render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
      else render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);
      const row = layout === 'desktop' ? document.querySelector('tr.inv-desk-row') as HTMLElement : screen.getByRole('article');
      expect(within(row).getByRole('link', { name: `Ready. Open service status for VIN ${vehicle.vin}` }))
        .toHaveTextContent(layout === 'desktop' ? 'ReadyStarted 08/14/2026Ready 09/11/2026' : 'Ready09/11/2026');
      expect(within(row).getByRole('link', { name: `Ready. Open service status for VIN ${vehicle.vin}` })).toHaveAttribute('title', expect.stringContaining('Started 08/14/2026; Ready 09/11/2026'));
    });
  });

  it('orders Operations as Location, Hold with its expected date and backups, Move, then Service', () => {
    const vehicle = heldMovingVehicle();
    vehicle.dealerMail = { ...vehicle.dealerMail, activeRecordCount: 3 };
    vehicle.holdEvidence = [{ id: 'hold-1', position: 'primary', salesperson: 'Alex Morgan', customerOrReason: 'Customer appointment', expectedDeliveryDate: '2026-10-02' }];
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    const operations = screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/ }).closest('dl')!;
    const text = operations.textContent ?? '';
    const order = ['Fowlerville', 'Hold · Alex Morgan', 'Expected 10/02/2026 · 2 backups', 'In transit outbound', 'Waiting for service']
      .map((fact) => text.indexOf(fact));
    order.forEach((position) => expect(position).toBeGreaterThanOrEqual(0));
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(operations).not.toHaveTextContent('Held by');
    // Everyone may read hold details, so the hover detail keeps the reason.
    expect(within(operations).getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/ })).toHaveAttribute('title', 'Customer appointment');
  });

  it('labels each Operations fact in the fixed order Location, Hold, Move, Service', () => {
    render(<InventoryTable vehicles={[heldMovingVehicle()]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    const operations = screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/ }).closest('dl')!;
    expect(within(operations).getAllByRole('term').map((term) => term.textContent)).toEqual(['Location', 'Hold', 'Move', 'Service']);
    const definitions = within(operations).getAllByRole('definition');
    expect(definitions[0]).toHaveTextContent('Fowlerville');
    expect(within(definitions[1]).getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/ })).toHaveTextContent('Hold · Alex Morgan');
    expect(definitions[2]).toHaveTextContent('In transit outbound');
    expect(within(definitions[3]).getByRole('link', { name: /^Waiting for service\. Open service status/ })).toBeVisible();
  });

  it("says 'Held by' only for DealerMail's own heldBy evidence", () => {
    const vehicle = heldMovingVehicle();
    vehicle.holdEvidence = [{ id: 'hold-1', position: 'primary', salesperson: 'Alex Morgan', heldBy: 'Jamie Howell', customerOrReason: 'Customer appointment' }];
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    const operations = screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/ }).closest('dl')!;
    expect(operations).toHaveTextContent('Hold · Alex Morgan');
    expect(operations.querySelector('.inv-desk-status__detail')).toHaveTextContent('Held by Jamie Howell');
    expect(operations).not.toHaveTextContent('Held by Alex Morgan');
  });

  it('keeps existing inventory without service metadata waiting until manager confirmation', () => {
    render(<InventoryTable vehicles={[heldMovingVehicle()]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    expect(screen.getByRole('link', { name: /^Waiting for service\. Open service status/ })).toBeVisible();
    expect(screen.queryByText(/completed|2026-09-14/i)).not.toBeInTheDocument();
  });

  it('shows hold and movement as independent desktop signals', () => {
    render(
      <InventoryTable
        vehicles={[heldMovingVehicle()]}
        sorts={[{ key: 'vehicle', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={vi.fn()}
      />,
    );

    expect(screen.getByText('Hold · Alex Morgan')).toBeInTheDocument();
    expect(screen.getByText('In transit outbound')).toBeInTheDocument();
    const sticker = within(document.querySelector('.vehicle-resource-scan[data-resource-kind="window-sticker"]') as HTMLElement);
    expect(sticker.queryByText('MSRP')).not.toBeInTheDocument();
    expect(sticker.getByText('Highlight')).toBeVisible();
    expect(sticker.getByText('XLT Sport Appearance Package')).toBeVisible();
    expect(screen.getAllByText('Equipment Group 302A').length).toBeGreaterThan(0);
    expect(screen.getByText('2.7L EcoBoost V6 · 4x4')).toHaveAttribute('title', 'SuperCrew pickup · 10-speed automatic · Gasoline');
    expect(screen.getByText('10-speed auto · Gasoline')).toBeVisible();
    expect(screen.getByText('10-speed auto · Gasoline')).toHaveAttribute('title', '10-speed automatic · Gasoline');
    expect(screen.getByText('Oxford White')).toBeVisible();
    expect(screen.getByText('Black')).toBeVisible();
    expect(screen.getByText('2.7L EcoBoost V6 · 4x4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/i })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Open vehicle details for 2024 Ford F-150 XLT/i }).closest('tr') as HTMLTableRowElement;
    expect(row).toHaveClass('inv-desk-row');
    expect(row).toHaveTextContent('Hold · Alex Morgan');
    expect(row).toHaveTextContent('Fowlerville');
    expect(row).toHaveTextContent('In transit outbound');
    expect(document.querySelector('.inventory-grid-shell--desk')).toBeInTheDocument();
    expect(document.querySelector('.inv-desk-table')).toBeInTheDocument();
    // Primary decisions and complete supporting evidence share the four native column headers.
    expect(document.querySelectorAll('tbody tr.inv-desk-row')).toHaveLength(1);
    const footer = row.nextElementSibling as HTMLTableRowElement;
    expect(footer).toHaveClass('inv-desk-footer');
    expect(footer.querySelectorAll('td')).toHaveLength(1);
    expect(footer.firstElementChild).toHaveAttribute('colspan', '4');
    expect(row.querySelector('[rowspan],[colspan]')).toBeNull();
    expect(document.querySelector('.inv-desk-resource-row')).toBeNull();
    expect(row).toHaveTextContent('H240512');
    expect(row).toHaveTextContent('1FTFW1E84RKF12345');
    expect(within(row).getByRole('button', { name: 'Copy stock number: H240512' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy VIN: 1FTFW1E84RKF12345' })).toBeInTheDocument();
    const vehicleCell = row.querySelector('td[data-column="vehicle"]') as HTMLElement;
    expect(vehicleCell.querySelector('.inv-desk-vehicle__title strong')).toHaveTextContent('2024 Ford F-150');
    expect(vehicleCell.querySelector('.inv-desk-vehicle__title')).toHaveAttribute('title', '2024 Ford F-150 XLT');
    expect(row.querySelectorAll('.vehicle-certified-badge')).toHaveLength(1);
    expect(row.querySelector('.inv-desk-price')).toHaveTextContent('$46,995');
    const metricsCell = row.querySelector('.inv-desk-price') as HTMLElement;
    const supportingIdentity = vehicleCell;
    expect(supportingIdentity).toHaveTextContent('8,642 mi');
    expect(within(supportingIdentity).getByRole('button', { name: 'Copy mileage: 8642' })).toBeInTheDocument();
    expect(metricsCell).not.toHaveTextContent('8,642 mi');
    expect(metricsCell).toHaveTextContent('21 days listed');
    const equipmentCell = row.querySelector('td[data-column="configuration"]') as HTMLElement;
    expect(equipmentCell).toHaveTextContent('Equipment Group 302A');
    expect(equipmentCell.querySelectorAll('.inv-desk-equipment__item')).toHaveLength(3);
    expect(equipmentCell).toHaveTextContent('XLT Sport Appearance Package');
    expect(equipmentCell).toHaveTextContent('Trailer Tow Package');
    expect(equipmentCell.querySelector('button')).toHaveAttribute('title', expect.stringContaining('XLT Sport Appearance Package'));
    expect(equipmentCell.querySelector('button')).toHaveAttribute('title', expect.stringContaining('Trailer Tow Package (53A)'));
    expect(row.querySelector('.inv-desk-status__detail')).toHaveTextContent('Customer appointment');
    expect(within(row.closest('tbody')!).getByRole('group', { name: 'Actions for 2024 Ford F-150 XLT' })).toBeInTheDocument();
    const activity = within(row).getByRole('button', { name: /View change history for 2024 Ford F-150 XLT: Price changed/i });
    expect(activity).toHaveTextContent('Price changed');
    expect(activity).toHaveAttribute('title', 'Price changed today');
    expect(activity).not.toHaveTextContent(/AutoCheck|owner|Personal/i);
    expect(Array.from(document.querySelectorAll('thead th')).map((header) =>
      header.querySelector('.inventory-sort-header > span:first-child')?.textContent?.trim() ?? header.textContent?.trim(),
    )).toEqual([
      'Vehicle & pricing', 'Configuration', 'History', 'Operations',
    ]);
    expect(Array.from(row.querySelectorAll<HTMLElement>('td[data-column]')).map((cell) => cell.dataset.column)).toEqual([
      'vehicle', 'configuration', 'history', 'status',
    ]);
    expect(row.querySelectorAll('td')).toHaveLength(4);
    // Source signals stay visible while complete records remain collapsed.
    expect(within(row.querySelector('td[data-column="history"]') as HTMLElement).getByText('Score')).toBeVisible();
    expect(within(row.querySelector('td[data-column="history"]') as HTMLElement).getByText('92')).toBeVisible();
    expect(row.querySelector('[data-resource="window-sticker"]')).toBeNull();
    expect(within(row).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
  });

  it('uses original sticker pricing and a copyable explicit base without treating listed MSRP as document evidence', async () => {
    const vehicle = heldMovingVehicle();
    vehicle.msrp = 52995;
    vehicle.windowSticker = { ...vehicle.windowSticker!, totalMsrp: 55600, basePrice: 48750, pricingCurrency: 'CAD' };
    vehicle.mpgCity = 18;
    vehicle.mpgHighway = 24;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);

    const row = screen.getByRole('button', { name: 'Copy VIN: 1FTFW1E84RKF12345' }).closest('tr')!;
    const identity = within(row).getByRole('cell', { name: /ExteriorOxford WhiteInteriorBlack/ });
    const primary = row;
    const price = primary.querySelector('.inv-desk-price') as HTMLElement;
    const configuration = within(primary).getByRole('cell', { name: /18 city \/ 24 hwy MPG/ });
    const operations = within(primary).getByRole('cell', { name: /Location Fowlerville.*Hold/ });

    const command = screen.getByRole('button', { name: 'Open vehicle details for 2024 Ford F-150 XLT' }).closest('tr')!;
    expect(within(command).getByText('2024 Ford F-150')).toBeVisible();
    expect(within(command).getByText('XLT · SuperCrew pickup')).toBeVisible();
    expect(identity).toHaveTextContent('VIN1FTFW1E84RKF12345');
    expect(within(price).getByText('Original MSRP')).toHaveAttribute('title', 'Window sticker');
    expect(price).toHaveTextContent(/Original MSRP\s*CAD 55,600/);
    expect(within(identity).getByText('Base MSRP')).toHaveAttribute('title', 'Window sticker');
    expect(identity).toHaveTextContent(/Base MSRP\s*CAD 48,750/);
    expect(price).not.toHaveTextContent('Base MSRP');
    expect(price).not.toHaveTextContent('$52,995');
    expect(price).not.toHaveTextContent(/Listed MSRP|Under MSRP|Inventory|Captured/);
    await userEvent.click(within(identity).getByRole('button', { name: 'Copy window sticker base MSRP: 48750' }));
    expect(writeText).toHaveBeenCalledWith('48750');
    expect(configuration).toHaveTextContent('18 city / 24 hwy MPG');
    expect(operations).not.toHaveTextContent(/MSRP|Listing captured|MPG/);
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });

  it('labels an explicit vAuto base fallback without borrowing sticker currency', () => {
    const vehicle = heldMovingVehicle();
    vehicle.windowSticker = { ...vehicle.windowSticker!, basePrice: null, pricingCurrency: 'CAD' };
    vehicle.factoryEquipment = { ...vehicle.factoryEquipment!, basePrice: 47125.5 };
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    const price = screen.getByRole('button', { name: 'Copy vAuto base MSRP: 47125.5' }).closest('td')!;
    const base = within(price).getByText('vAuto base MSRP').parentElement!;
    expect(within(base).getByText('vAuto base MSRP')).toHaveAttribute('title', 'vAuto equipment');
    expect(base).toHaveTextContent(/vAuto base MSRP\s*47,125.5/);
    expect(base).not.toHaveTextContent(/CAD|USD|\$/);
    expect(within(base).getByRole('button', { name: 'Copy vAuto base MSRP: 47125.5' })).toBeVisible();
  });

  it('does not invent base MSRP from listed MSRP, original total, options, or destination', () => {
    const vehicle = heldMovingVehicle();
    vehicle.msrp = 52995;
    vehicle.windowSticker = { ...vehicle.windowSticker!, basePrice: null, totalMsrp: 55600, totalOptions: 4100, destinationCharge: 1995, pricingCurrency: 'USD' };
    vehicle.factoryEquipment = { ...vehicle.factoryEquipment!, basePrice: null, totalMsrp: 55600, totalOptions: 4100, destinationCharge: 1995 };
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    const price = screen.getByRole('cell', { name: /Original MSRP/ });
    expect(within(price).getByText('Original MSRP')).toHaveAttribute('title', 'Window sticker');
    expect(price).toHaveTextContent(/Original MSRP\s*\$55,600/);
    expect(within(price).queryByText('Base MSRP')).not.toBeInTheDocument();
    expect(within(price).queryByRole('button', { name: /base MSRP/i })).not.toBeInTheDocument();
    expect(price).not.toHaveTextContent(/52,995|4,100|1,995/);
  });

  it('keeps the full VIN visible in the compact mobile comparison row', () => {
    const vehicle = heldMovingVehicle();
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);
    const facts = screen.getByRole('group', { name: 'Copy identifiers for 2024 Ford F-150 XLT' });
    expect(within(facts).getByText('VIN')).toBeVisible();
    expect(facts).toHaveTextContent(vehicle.vin);
  });

  it('shows the gallery count on the desktop photo and retries the next full image', () => {
    const vehicle = heldMovingVehicle();
    vehicle.imageUrl = 'https://www.bobmaxeyfordhowell.com/inventoryphotos/example/primary.jpg';
    vehicle.imageUrls = [
      vehicle.imageUrl,
      'https://www.bobmaxeyfordhowell.com/inventoryphotos/example/alternate.jpg',
    ];
    vehicle.photoCount = 18;

    const { rerender } = render(<VehiclePhoto vehicle={vehicle} className="inv-desk-vehicle__img" />);
    let photo = screen.getByRole('img', { name: '2024 Ford F-150 XLT exterior' });
    expect(photo).toHaveAttribute('src', `${vehicle.imageUrl}?width=240`);
    expect(photo).toHaveAttribute('loading', 'eager');
    expect(photo).toHaveAttribute('fetchpriority', 'low');
    fireEvent.error(photo);
    photo = screen.getByRole('img', { name: '2024 Ford F-150 XLT exterior' });
    expect(photo).toHaveAttribute('src', vehicle.imageUrl);
    fireEvent.error(photo);
    photo = screen.getByRole('img', { name: '2024 Ford F-150 XLT exterior' });
    expect(photo).toHaveAttribute('src', `${vehicle.imageUrls[1]}?width=240`);
    fireEvent.error(photo);
    photo = screen.getByRole('img', { name: '2024 Ford F-150 XLT exterior' });
    expect(photo).toHaveAttribute('src', vehicle.imageUrls[1]);
    fireEvent.load(photo);
    expect(photo).toHaveClass('is-loaded');
    rerender(<InventoryTable vehicles={[vehicle]} sorts={[{ key: 'vehicle', direction: 'asc' }]}
      onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    expect(screen.getByLabelText('18 vehicle photos')).toBeInTheDocument();
  });

  it('uses the VDP gallery order when the legacy primary image is stale', () => {
    const vehicle = heldMovingVehicle();
    vehicle.imageUrl = 'https://www.bobmaxeyfordhowell.com/inventoryphotos/example/legacy-primary.jpg';
    vehicle.imageUrls = ['https://www.bobmaxeyfordhowell.com/inventoryphotos/example/current-gallery.jpg'];

    render(<VehiclePhoto vehicle={vehicle} className="inv-desk-vehicle__img" />);
    expect(screen.getByRole('img', { name: '2024 Ford F-150 XLT exterior' })).toHaveAttribute('src', `${vehicle.imageUrls[0]}?width=240`);
  });

  it('clears the loading placeholder when a cached browser image is already complete', async () => {
    const vehicle = heldMovingVehicle();
    vehicle.imageUrl = 'https://www.bobmaxeyfordhowell.com/inventoryphotos/example/cached.jpg';
    vehicle.imageUrls = [vehicle.imageUrl];

    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const naturalWidth = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(240);
    const naturalHeight = vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(180);
    try {
      render(<VehiclePhoto vehicle={vehicle} className="inv-desk-vehicle__img" />);
      const photo = screen.getByRole('img', { name: '2024 Ford F-150 XLT exterior' });
      await waitFor(() => expect(photo).toHaveClass('is-loaded'));
      expect(document.querySelector('.inventory-vehicle-visual__placeholder--loading')).not.toBeInTheDocument();
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
      naturalHeight.mockRestore();
    }
  });

  it('keeps vehicle-history facts out of activity and omits an empty change control', () => {
    const vehicle = heldMovingVehicle();
    vehicle.changeSummary = undefined;
    vehicle.movement = undefined;
    render(
      <InventoryTable
        vehicles={[vehicle]}
        sorts={[{ key: 'recentActivity', direction: 'desc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={vi.fn()}
      />,
    );

    expect(document.querySelector('.inv-desk-change')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View change history/i })).not.toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'History source evidence for 2024 Ford F-150 XLT' });
    expect(history).toHaveTextContent('AutoCheck');
    expect(history.closest('tr')).toHaveClass('inv-desk-row');
    const historySignals = within(history);
    expect(historySignals.getByText('Score')).toBeVisible();
    expect(historySignals.getByText('92')).toBeVisible();
  });

  it('reads a snake_case ledger movement state as words in the status pill', () => {
    const vehicle = heldMovingVehicle();
    vehicle.movement = { state: 'at_home', requestId: 'move-2', nextAction: 'No action needed' };
    render(<InventoryTable vehicles={[vehicle]} sorts={[{ key: 'vehicle', direction: 'asc' }]}
      onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    const statusCell = document.querySelector('td[data-column="status"]') as HTMLElement;
    expect(statusCell).toHaveTextContent('At home');
    expect(statusCell).not.toHaveTextContent('at_home');
    expect(within(statusCell).getByText('At home')).toHaveAttribute('title', 'No action needed');
  });

  it('marks only a specific change in the row and leaves a generic update to the timeline', () => {
    const vehicle = heldMovingVehicle();
    vehicle.changeSummary = 'Inventory updated';
    render(<InventoryTable vehicles={[vehicle]} sorts={[{ key: 'vehicle', direction: 'asc' }]}
      onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /View change history/i })).not.toBeInTheDocument();
    expect(document.querySelector('.inv-desk-change')).not.toBeInTheDocument();
  });

  it.each(['TESTDATAHWELL0001', 'TESTDATAHWELL0002'])('matches the full equipment count for synthetic %s', vin => {
    const record = buildSyntheticRelease({ includeDemoChanges: true }).vehicles.find((row: { vin: string }) => row.vin === vin);
    const vehicle = { ...heldMovingVehicle(), ...record.resourceRecord, windowSticker: record.publicRecord.windowSticker,
      features: record.publicRecord.features.split(' | ') } as InventoryVehicle;
    const equipment = equipmentFinderItems(vehicle);
    expect(equipment).toHaveLength(19);
    render(<InventoryTable vehicles={[vehicle]} sorts={[{ key: 'vehicle', direction: 'asc' }]}
      onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /View all 19 equipment items/ });
    expect(trigger).toHaveTextContent('+16 more');
    expect(equipment.some(item => item.searchText.includes('demo-1'))).toBe(true);
  });

  it('keeps conflicting captured package codes and prices distinct in the equipment count', () => {
    const vehicle = heldMovingVehicle();
    vehicle.features = [];
    vehicle.windowSticker = { dataState: 'current', options: ['Tow package (ABC1) $100', 'Tow package (ABC2) $100', 'Tow package (ABC1) $200'] };
    vehicle.factoryEquipment = undefined;
    const items = equipmentFinderItems(vehicle);
    expect(items).toHaveLength(3);
    expect(items.map(item => [item.display.code, item.display.price])).toEqual([
      ['ABC1', '$100'], ['ABC1', '$200'], ['ABC2', '$100'],
    ]);
  });

  it('routes equipment, changes and hold controls to their matching details without also opening Overview', () => {
    const vehicle = heldMovingVehicle();
    const onSelectVehicle = vi.fn();
    render(<InventoryTable vehicles={[vehicle]} sorts={[{ key: 'vehicle', direction: 'asc' }]}
      onSortChange={vi.fn()} onSelectVehicle={onSelectVehicle} />);

    fireEvent.click(screen.getByRole('button', { name: /View all \d+ equipment items for 2024 Ford F-150 XLT/i }));
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'equipment');
    expect(screen.getByRole('button', { name: /View all \d+ equipment items for 2024 Ford F-150 XLT/i })).toHaveFocus();
    onSelectVehicle.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /View change history for 2024 Ford F-150 XLT/i }));
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'timeline');
    expect(screen.getByRole('button', { name: /View change history for 2024 Ford F-150 XLT/i })).toHaveFocus();
    onSelectVehicle.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/i }));
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'hold');
  });

  it.each(['desktop', 'mobile'] as const)('opens %s records beside the vehicle, browses without changing the list, and restores its launcher', async (layout) => {
    const user = userEvent.setup();
    const first = heldMovingVehicle();
    first.fordOasis = { dataState: 'current', warrantyStartDate: '2024-03-14', openFieldServiceActions: [], warrantyCoverages: [], extendedCoverageExpirations: [] };
    const second = { ...first, id: 'synthetic-second', vin: 'TESTDATASECOND001', stockNumber: 'SYNTH-002', autoCheckReport: { ...first.autoCheckReport!, score: 78 } };
    const onSelectVehicle = vi.fn();
    const { container } = render(layout === 'desktop'
      ? <InventoryTable vehicles={[first, second]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={onSelectVehicle} />
      : <InventoryMobileList vehicles={[first, second]} onSelectVehicle={onSelectVehicle} />);
    const launcher = screen.getAllByRole('button', { name: /Open vehicle records/ })[0];
    // jsdom has no layout; expose the connected launcher's visibility to focus cleanup.
    vi.spyOn(launcher, 'getClientRects').mockReturnValue([{ width: 44, height: 44 }] as unknown as DOMRectList);
    const listNodes = Array.from(container.querySelectorAll(layout === 'desktop' ? '.inv-desk-row' : '.if-srp-mobile-row'));
    expect(screen.queryByRole('button', { name: 'Show AutoCheck records' })).not.toBeInTheDocument();
    launcher.focus();
    await user.keyboard('{Enter}');
    const panel = screen.getByRole('dialog', { name: '2024 Ford F-150 XLT records' });
    expect(within(panel).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true');
    for (const kind of ['window-sticker', 'autocheck', 'oasis']) expect(panel.querySelector(`[data-resource-kind="${kind}"] .vehicle-resource-summary__body`)).toBeVisible();
    await user.click(within(panel).getByRole('button', { name: 'Expand history details' }));
    expect(within(panel).getByRole('term', { name: 'Score' }).parentElement).toHaveTextContent('92');
    await user.click(within(panel).getByRole('button', { name: 'Next vehicle' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toBe(panel);
    expect(panel).toHaveTextContent('SYNTH-002');
    expect(within(panel).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(panel).getByRole('button', { name: 'Expand history details' }));
    expect(within(panel).getByRole('term', { name: 'Score' }).parentElement).toHaveTextContent('78');
    expect(within(panel).getByRole('link', { name: /Open AutoCheck history for VIN TESTDATASECOND001/ })).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Next vehicle' })).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: 'Previous vehicle' }));
    expect(panel).toHaveTextContent(first.stockNumber);
    expect(Array.from(container.querySelectorAll(layout === 'desktop' ? '.inv-desk-row' : '.if-srp-mobile-row'))).toEqual(listNodes);
    expect(container.querySelector('.inv-desk-resource-row, .inventory-mobile-records')).toBeNull();
    expect(onSelectVehicle).not.toHaveBeenCalled();
    within(panel).getByRole('button', { name: 'Close records' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(launcher).toHaveFocus());
    await user.click(launcher);
    const backdrop = document.querySelector<HTMLElement>('.inventory-records-backdrop');
    expect(backdrop).toBeInTheDocument();
    await user.click(backdrop!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes newly committed desktop Records on Escape before any animation frame and restores its launcher', () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    try {
      render(<InventoryTable vehicles={[heldMovingVehicle()]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
      const launcher = screen.getByRole('button', { name: /Open vehicle records/ });
      vi.spyOn(launcher, 'getClientRects').mockReturnValue([{ width: 44, height: 44 }] as unknown as DOMRectList);
      fireEvent.click(launcher);
      expect(screen.getByRole('dialog', { name: /records$/i })).toBeVisible();

      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

      expect(screen.queryByRole('dialog', { name: /records$/i })).not.toBeInTheDocument();
      expect(launcher).toHaveAttribute('aria-expanded', 'false');
      expect(launcher).toHaveFocus();
    } finally {
      cleanup();
      frame.mockRestore();
    }
  });

  it('leaves inventory focus and Escape in control after leaving the nonmodal Records inspector', () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    try {
      render(<InventoryTable vehicles={[heldMovingVehicle()]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Open vehicle records/ }));
      const dialog = screen.getByRole('dialog', { name: /records$/i });
      const sort = screen.getByRole('button', { name: 'More Vehicle & pricing sort options' });
      sort.focus();
      expect(fireEvent.keyDown(sort, { key: 'Escape' })).toBe(true);
      expect(dialog).toBeVisible();
      expect(sort).toHaveFocus();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close records' }));
      expect(screen.queryByRole('dialog', { name: /records$/i })).not.toBeInTheDocument();
      expect(sort).toHaveFocus();
    } finally {
      cleanup();
      frame.mockRestore();
    }
  });

  it('retains desktop Records keyboard ownership after StrictMode rehearses its effects', () => {
    const callbacks: FrameRequestCallback[] = [];
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callbacks.push(callback);
      return callbacks.length;
    });
    try {
      render(<StrictMode><InventoryTable vehicles={[heldMovingVehicle()]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} /></StrictMode>);
      const launcher = screen.getByRole('button', { name: /Open vehicle records/ });
      vi.spyOn(launcher, 'getClientRects').mockReturnValue([{ width: 44, height: 44 }] as unknown as DOMRectList);
      fireEvent.click(launcher);
      const close = within(screen.getByRole('dialog', { name: /records$/i })).getByRole('button', { name: 'Close records' });
      expect(close).toHaveFocus();

      act(() => callbacks.splice(0).forEach(callback => callback(0)));

      expect(close).toHaveFocus();
      // A portal descendant must not swallow the inspector's dismissal key.
      close.addEventListener('keydown', event => event.stopPropagation(), { once: true });
      fireEvent.keyDown(close, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: /records$/i })).not.toBeInTheDocument();
      expect(launcher).toHaveFocus();
    } finally {
      cleanup();
      frame.mockRestore();
    }
  });

  it('keeps each row bound to its vehicle and mirrors selected state without leaking private evidence', () => {
    const first = heldMovingVehicle();
    const second = { ...heldMovingVehicle(), id: '1FTFW1E84RKF12346', vin: '1FTFW1E84RKF12346', stockNumber: 'H240513' };
    second.dealerMail = { ...second.dealerMail, canViewEvidence: false, canManageHold: false };
    second.holdEvidence = [{ id: 'private-2', position: 'primary', salesperson: 'Private Salesperson', customerOrReason: 'Private Reason' }];
    render(<InventoryTable vehicles={[first, second]} selectedVehicleId={second.id}
      sorts={[{ key: 'vehicle', direction: 'asc' }]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);

    const rows = document.querySelectorAll<HTMLTableRowElement>('tbody tr.inv-desk-row');
    expect(rows).toHaveLength(2);
    expect(document.querySelectorAll('tbody tr.inv-desk-scan-row')).toHaveLength(0);
    expect(document.querySelectorAll('tbody tr.inv-desk-resource-row')).toHaveLength(0);
    for (const [index, row] of Array.from(rows).entries()) {
      const vehicle = [first, second][index];
      expect(row).toHaveAttribute('data-stock-number', vehicle.stockNumber);
      expect(row).toHaveTextContent(vehicle.stockNumber);
      expect(row.nextElementSibling).toHaveClass('inv-desk-footer');
      expect(row).toHaveTextContent(vehicle.vin);
      expect(within(row).getByRole('button', { name: `Copy VIN: ${vehicle.vin}` })).toBeInTheDocument();
      expect(row.querySelectorAll('td')).toHaveLength(4);
      expect(row.classList.contains('is-selected')).toBe(index === 1);
    }
    expect(screen.queryByText('Private Salesperson')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Reason')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review DealerMail handoff for stock H240513/i })).not.toBeInTheDocument();
  });

  it('puts mobile identity, copy targets and operational status before core actions, with calculator and providers afterward', () => {
    const vehicle = heldMovingVehicle();
    vehicle.windowSticker = { ...vehicle.windowSticker!, basePrice: 48750 };
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} onTrackMovement={vi.fn()} />);
    const card = screen.getByRole('article');
    const identity = within(card).getByRole('button', { name: /^Open details for/ });
    const identifiers = within(card).getByRole('group', { name: 'Copy identifiers for 2024 Ford F-150 XLT' });
    const signals = within(card).getByLabelText('Operational vehicle signals');
    const actions = within(card).getByRole('group', { name: 'Actions for 2024 Ford F-150 XLT' });
    const calculator = within(card).getByLabelText('Registration calculator values');
    const reports = within(card).getByLabelText('Vehicle report shortcuts');
    for (const [first, next] of [[identity, identifiers], [identifiers, calculator], [calculator, signals], [signals, actions], [actions, reports]]) {
      expect(first.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(identifiers).toHaveTextContent(vehicle.vin);
    expect(within(identifiers).getByRole('button', { name: `Copy VIN: ${vehicle.vin}` })).toBeEnabled();
    expect(within(actions).getByRole('button', { name: /Track movement for/ })).toBeEnabled();
    expect(within(reports).getByRole('link', { name: 'Open AutoCheck report in a new tab' })).toHaveAttribute('href', vehicle.autoCheckReport!.url);
  });

  it('keeps mobile scan facts, hold, priority resources, Records and movement as sibling targets', async () => {
    const vehicle = heldMovingVehicle();
    const onSelectVehicle = vi.fn();
    const onOpenSourceRecord = vi.fn();
    const onTrackMovement = vi.fn();
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={onSelectVehicle} onOpenSourceRecord={onOpenSourceRecord} onTrackMovement={onTrackMovement}/>);
    const card = screen.getByRole('article');
    const detailTarget = within(card).getByRole('button', { name: /^Open details for 2024 Ford F-150 XLT/ });
    expect(card.parentElement).toHaveClass('if-srp-mobile-list');
    for (const fact of ['2024 Ford F-150 XLT', '$46,995', '8,642 mi']) expect(detailTarget).toHaveTextContent(fact);
    expect(detailTarget).toHaveAccessibleName(expect.stringContaining('Open details'));
    expect(card).toHaveTextContent('H240512');
    expect(detailTarget).not.toHaveTextContent(vehicle.vin);
    expect(detailTarget).toHaveAccessibleName(expect.stringContaining(vehicle.vin));
    expect(card).toHaveTextContent('Hold · Alex Morgan');
    expect(card).toHaveTextContent('Fowlerville');
    expect(card).toHaveTextContent('In transit outbound');
    expect(detailTarget.querySelector('button')).toBeNull();
    fireEvent.click(detailTarget);
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle);
    const hold = within(card).getByRole('button', { name: /Open DealerMail hold tools/ });
    expect(hold).toHaveAttribute('title', expect.stringContaining('Hold · Alex Morgan'));
    expect(hold).toHaveAttribute('title', expect.stringContaining('Customer appointment'));
    fireEvent.click(hold);
    expect(onOpenSourceRecord).toHaveBeenCalledExactlyOnceWith(vehicle, 'dealermail');
    const records = within(card).getByRole('button', { name: /Open vehicle records/ });
    fireEvent.click(records);
    expect(records).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: '2024 Ford F-150 XLT records' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Full vehicle' }));
    await waitFor(() => expect(onSelectVehicle).toHaveBeenLastCalledWith(vehicle, 'data'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(card.querySelector('.vehicle-resources--scan')).toBeNull();
    fireEvent.click(records);
    fireEvent.click(screen.getByRole('button', { name: 'Close records' }));
    expect(card.querySelector('.vehicle-resource-summary')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: /Track movement for/ }));
    expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(vehicle);
    expect(within(card).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    // Highlights share the large identity launcher, avoiding another full touch row.
    const identity = within(card).getByRole('button', { name: /Open details for/ });
    expect(identity).toHaveTextContent('Equipment Group 302A');
    fireEvent.click(identity);
    expect(onSelectVehicle).toHaveBeenLastCalledWith(vehicle);
  });

  it('keeps row resources compact while moving long equipment into Records', () => {
    const vehicle = heldMovingVehicle();
    vehicle.features = ['Floor mats', 'Rear defrost'];
    vehicle.windowSticker = { ...vehicle.windowSticker!, equipmentGroup: null, options: [], pricingCurrency: 'CAD' };
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, dataState: 'stale', ownerCount: 2 };
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);
    expect(document.querySelector('.vehicle-resources--scan')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open vehicle records/ }));
    const signals = screen.getByRole('dialog');
    expect(signals).toHaveTextContent('2 owners');
    expect(signals).toHaveTextContent('Saved report · refresh at source');
    expect(within(signals).getByText('MSRP')).toBeVisible();
    expect(within(signals as HTMLElement).getByText('CAD 52,995')).toBeVisible();
    expect(screen.getByRole('button', { name: /Open vehicle records/ })).toBeInTheDocument();
    expect(within(screen.getByRole('article')).getByRole('button', { name: /Open details for/ })).toHaveTextContent('Trailer Tow Package');
  });

  it('keeps the full mobile equipment record in the panel and resets source selection for the next vehicle', () => {
    const first = heldMovingVehicle();
    const second = { ...heldMovingVehicle(), id: 'SYNTHETICSECOND', vin: 'SYNTHETICSECOND', stockNumber: 'TEST-02' };
    first.windowSticker = { ...first.windowSticker!, options: Array.from({ length: 14 }, (_, index) => `Captured option ${index + 1}`) };
    const onSelectVehicle = vi.fn();
    const originalUrl = window.location.href;
    render(<InventoryMobileList vehicles={[first, second]} onSelectVehicle={onSelectVehicle}/>);
    fireEvent.click(screen.getAllByRole('button', { name: /Open vehicle records/ })[0]);
    const panel = screen.getByRole('dialog');
    expect(screen.queryByText('Captured option 14')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Expand equipment details' }));
    expect(screen.getByText('Captured option 14')).toBeVisible();
    expect(onSelectVehicle).not.toHaveBeenCalled();
    expect(window.location.href).toBe(originalUrl);
    fireEvent.click(within(panel).getByRole('button', { name: 'Next vehicle' }));
    expect(panel).toHaveTextContent('TEST-02');
    expect(screen.queryByText('Captured option 14')).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps vAuto equipment distinct from a sticker and retains current location', () => {
    const vehicle = heldMovingVehicle();
    vehicle.windowSticker = undefined;
    vehicle.autoCheckReport = undefined;
    vehicle.movement = undefined;
    vehicle.changeSummary = undefined;
    const onSelectVehicle = vi.fn();
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={onSelectVehicle} />);
    expect(screen.getByRole('button', { name: /Open details for/ })).toHaveTextContent('Trailer Tow Package');
    expect(screen.getByRole('button', { name: /Open vehicle records/ })).toBeVisible();
    expect(document.querySelector('[data-resource="window-sticker"]')).toBeNull();
    expect(document.querySelector('[data-resource="autocheck"]')).toBeNull();
    const hold = screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/ });
    expect(hold).toHaveTextContent('Fowlerville');
    fireEvent.click(hold);
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'hold');
    expect(hold).toHaveFocus();
    expect(screen.getByRole('article')).not.toHaveTextContent('No recent change');
  });

  it('keeps Records accessible and history visible without claiming missing reports', async () => {
    const vehicle = heldMovingVehicle();
    vehicle.windowSticker = undefined;
    vehicle.factoryEquipment = undefined;
    vehicle.autoCheckReport = undefined;
    vehicle.features = ['Floor mats'];
    vehicle.movement = undefined;
    vehicle.dealerMail = { ...vehicle.dealerMail, canManageHold: false, dataState: 'stale', hasActiveHold: null };
    const onSelectVehicle = vi.fn();
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={onSelectVehicle} />);
    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('data-has-document-evidence', 'false');
    expect(within(card).getByText('Floor mats')).toBeVisible();
    for (const id of ['window-sticker', 'autocheck', 'vauto']) expect(card.querySelector(`[data-resource="${id}"]`)).toBeNull();
    expect(card.querySelector('.inventory-mobile-update')).not.toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /Open vehicle records/ }));
    expect(onSelectVehicle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Full vehicle' }));
    await waitFor(() => expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'data'));
    expect(card).toHaveTextContent('Hold status unverified');
    expect(card).not.toHaveTextContent('No current hold');
  });

  it('rejects unsafe document URLs while clearly separating captured data fallback', async () => {
    const vehicle = heldMovingVehicle();
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, url: 'https://untrusted.example/autocheck.aspx' };
    vehicle.windowSticker = { ...vehicle.windowSticker!, url: 'javascript:alert(1)' };
    vehicle.factoryEquipment = { ...vehicle.factoryEquipment!, url: 'https://untrusted.example/equipment.pdf' };
    const onSelectVehicle = vi.fn();
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={onSelectVehicle} />);
    expect(screen.getByRole('article')).toHaveAttribute('data-has-document-evidence', 'false');
    expect(document.querySelector('.vehicle-resources--scan')).toBeNull();
    expect(document.querySelector('a[href*="untrusted.example"], a[href^="javascript:"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open vehicle records/ }));
    expect(onSelectVehicle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Full vehicle' }));
    await waitFor(() => expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'data'));
  });

  it('omits generic mobile update filler while retaining meaningful changes and complete vehicle identity', () => {
    const vehicle = { ...heldMovingVehicle(), model: 'Bronco Sport', trim: 'Badlands', movement: undefined, changeSummary: 'Inventory updated' };
    const { rerender } = render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);
    expect(document.querySelector('.inventory-mobile-row__title')).toHaveTextContent('2024 Ford Bronco Sport Badlands');
    expect(document.querySelector('.inventory-mobile-update')).toBeNull();
    expect(document.querySelector('.inventory-mobile-row__specification')).toHaveTextContent('2.7L EcoBoost V6 · 4x4');
    rerender(<InventoryMobileList vehicles={[{ ...vehicle, changeSummary: 'Price changed today' }]} onSelectVehicle={vi.fn()} />);
    expect(document.querySelector('.inventory-mobile-update')).toHaveTextContent('Price changed');
  });

  it('retains an overdue mobile movement warning independently of hold and service status', () => {
    // No viewerStore/nextActionStore published: the shared sla-label vocabulary
    // keeps the conservative, urgent reading (src/lib/sla-label).
    const vehicle = heldMovingVehicle();
    vehicle.movement = { ...vehicle.movement!, dueAt: '2020-01-01T00:00:00.000Z' };
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} onTrackMovement={vi.fn()} />);
    expect(document.querySelector('.inventory-mobile-update--warning')).toHaveTextContent('Overdue');
    expect(screen.getByRole('button', { name: /Track movement for/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Waiting for service\. Open service status/ })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('data-hold-state', 'held');
  });

  it('keeps an overdue mobile move neutral, naming who it waits on, when another store owns the next step', () => {
    // Same shared vocabulary as the vehicle page and Moves (src/lib/sla-label):
    // red is reserved for the viewer's own store.
    const vehicle = heldMovingVehicle();
    vehicle.movement = {
      ...vehicle.movement!,
      dueAt: '2020-01-01T00:00:00.000Z',
      nextActionStore: 'Fowlerville',
      nextActionOwner: 'Fowlerville sales',
    };
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} onTrackMovement={vi.fn()} viewerStore="Howell" />);
    const update = document.querySelector('.inventory-mobile-update');
    expect(update).toHaveTextContent('Overdue · Fowlerville');
    expect(update).toHaveAttribute('title', expect.stringContaining('Overdue · waiting on Fowlerville salesperson'));
    expect(update).not.toHaveClass('inventory-mobile-update--warning');
  });

  it('shows an owner-aware overdue move as urgent in the desktop Operations column when the viewer\'s store owns it', () => {
    const vehicle = heldMovingVehicle();
    vehicle.movement = {
      ...vehicle.movement!,
      dueAt: '2020-01-01T00:00:00.000Z',
      nextActionStore: 'Howell',
      nextActionOwner: 'Howell sales',
    };
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} viewerStore="Howell" />);
    const statusCell = document.querySelector('td[data-column="status"]') as HTMLElement;
    expect(statusCell).toHaveTextContent('Overdue');
    expect(document.querySelector('.inv-desk-move')).toHaveClass('is-warning');
  });

  it('shows an owner-aware overdue move as a plain fact in the desktop Operations column when another store owns it', () => {
    const vehicle = heldMovingVehicle();
    vehicle.movement = {
      ...vehicle.movement!,
      dueAt: '2020-01-01T00:00:00.000Z',
      nextActionStore: 'Fowlerville',
      nextActionOwner: 'Fowlerville sales',
    };
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} viewerStore="Howell" />);
    const statusCell = document.querySelector('td[data-column="status"]') as HTMLElement;
    expect(statusCell).toHaveTextContent('Overdue · Fowlerville');
    expect(document.querySelector('.inv-desk-move')).toHaveAttribute('title', 'Overdue · waiting on Fowlerville salesperson');
    expect(document.querySelector('.inv-desk-move')).not.toHaveClass('is-warning');
  });

  it('keeps the DealerMail loaner alert beside provider hold evidence on desktop', () => {
    const vehicle = heldMovingVehicle();
    vehicle.dealerMail = {
      ...vehicle.dealerMail,
      hasActiveHold: false,
      loaner: { active: true, program: 'Synthetic Service', label: 'Synthetic loaner', serviceDate: '2026-10-10', rawAlert: 'Synthetic current service alert' },
    };
    vehicle.operationalEvidence = { records: [{
      vin: vehicle.vin,
      provider: 'oem',
      sourceLabel: 'Synthetic OEM',
      capturedAt: '2026-10-10T12:00:00Z',
      dataState: 'current',
      readOnly: true,
      complete: true,
      holdState: 'not_observed',
    }] };

    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);

    const statusCell = screen.getByRole('cell', { name: /No hold observed in current reports/ });
    expect(within(statusCell).getByRole('button', { name: /Open hold details/ })).toHaveTextContent('No hold observed in current reports');
    expect(within(statusCell).getByText(/DealerMail loaner\/service:/)).toHaveTextContent('Loaner Synthetic Service · 2026-10-10');
    expect(within(statusCell).getByText(/DealerMail loaner\/service:/)).toHaveTextContent('Synthetic current service alert');
  });

  it('keeps the DealerMail loaner signal on mobile and redacts its alert for transport roles', () => {
    const vehicle = heldMovingVehicle();
    vehicle.dealerMail = {
      ...vehicle.dealerMail,
      hasActiveHold: false,
      canViewEvidence: false,
      loaner: { active: true, program: 'Synthetic Service', label: 'Synthetic loaner', serviceDate: '2026-10-10', rawAlert: 'Synthetic private customer reason' },
    };
    vehicle.operationalEvidence = { records: [{
      vin: vehicle.vin,
      provider: 'oem',
      sourceLabel: 'Synthetic OEM',
      capturedAt: '2026-10-10T12:00:00Z',
      dataState: 'current',
      readOnly: true,
      complete: true,
      holdState: 'not_observed',
    }] };

    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);

    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('No hold observed in current reports');
    expect(screen.getByLabelText('DealerMail loaner and service evidence')).toHaveTextContent('Loaner Synthetic Service · 2026-10-10');
    expect(card).toHaveTextContent('Current DealerMail loaner/service signal');
    expect(card).not.toHaveTextContent('Synthetic private customer reason');
  });

  it.each([
    ['desktop', 'stale', true], ['desktop', 'stale', false],
    ['desktop', 'unavailable', true], ['desktop', 'unavailable', false],
    ['mobile', 'stale', true], ['mobile', 'stale', false],
    ['mobile', 'unavailable', true], ['mobile', 'unavailable', false],
  ] as const)('qualifies retained loaner evidence on %s with %s source state and private access %s', (layout, dataState, canViewEvidence) => {
    const vehicle = heldMovingVehicle();
    vehicle.dealerMail = {
      ...vehicle.dealerMail, dataState, canViewEvidence, hasActiveHold: false,
      loaner: { active: true, program: 'Synthetic Service', label: 'Synthetic loaner', serviceDate: '2026-10-10', rawAlert: 'Synthetic private retained alert' },
    };
    vehicle.operationalEvidence = { records: [{
      vin: vehicle.vin, provider: 'oem', sourceLabel: 'Synthetic OEM', capturedAt: '2026-10-10T12:00:00Z',
      dataState: 'current', readOnly: true, complete: true, holdState: 'not_observed',
    }] };
    render(layout === 'desktop'
      ? <InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />
      : <InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);
    const signal = layout === 'desktop'
      ? screen.getByText(/DealerMail loaner\/service:/)
      : screen.getByLabelText('DealerMail loaner and service evidence');
    expect(signal).toHaveTextContent('Saved Loaner Synthetic Service · 2026-10-10');
    expect(signal).toHaveTextContent('current status unverified');
    expect(signal).not.toHaveTextContent('Current');
    if (canViewEvidence) expect(signal).toHaveTextContent('Synthetic private retained alert');
    else expect(signal).not.toHaveTextContent('Synthetic private retained alert');
    expect(screen.getAllByText('No hold observed in current reports')).toHaveLength(1);
  });

  it.each([true, false])('marks a retained hold signal of %s as unverified when its source is stale', (previousHold) => {
    const vehicle = heldMovingVehicle();
    vehicle.dealerMail = { ...vehicle.dealerMail, dataState: 'stale', hasActiveHold: previousHold };
    const status = vehicleOperationalStatus(vehicle);
    expect(status.label).toBe('Hold status unverified');
    expect(status.tone).toBe('unknown');
    expect(status.detail).toContain('confirm current status with the store');
    if (previousHold) expect(status.detail).toContain('Previous hold · Alex Morgan retained');
    else expect(status.detail).toContain('Latest hold data unavailable');

    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);
    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('Hold status unverified');
    expect(card).not.toHaveTextContent('Hold · Alex Morgan');
    expect(card).not.toHaveTextContent('No current hold');
  });

  it('does not disclose a previous hold owner when evidence access is restricted', () => {
    const vehicle = heldMovingVehicle();
    vehicle.dealerMail = { ...vehicle.dealerMail, dataState: 'incomplete', canViewEvidence: false };
    const status = vehicleOperationalStatus(vehicle);
    expect(status.label).toBe('Hold status unverified');
    expect(status.detail).toBe('Previous hold retained; confirm current status with the store');
    expect(status.detail).not.toContain('Alex Morgan');
  });

  it('opens VIN-specific documents without selecting the inventory row', () => {
    const onSelectVehicle = vi.fn();
    render(
      <InventoryTable
        vehicles={[heldMovingVehicle()]}
        sorts={[{ key: 'vehicle', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={onSelectVehicle}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open vehicle records/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand history details' }));
    const autoCheck = resource('autocheck');
    expect(autoCheck).toBeVisible();
    fireEvent.click(autoCheck);
    fireEvent.click(screen.getByRole('button', { name: 'Expand equipment details' }));
    const sticker = resource('window-sticker');
    expect(sticker).toBeVisible();
    expect(document.querySelector('[data-resource="vauto"]')).toBeNull();
    const listing = screen.getByRole('link', { name: /Open listing for 2024 Ford F-150 XLT/i });
    expect(autoCheck).toHaveAttribute('href', 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token');
    expect(sticker).toHaveAttribute('href', 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U');
    expect(listing).toHaveAttribute('href', 'https://www.bobmaxeyfordhowell.com/used/Ford/2024-Ford-F-150-vehicle-token.htm');
    expect(autoCheck).toHaveAttribute('rel', expect.stringContaining('noopener'));

    fireEvent.click(listing);
    fireEvent.click(sticker);
    expect(onSelectVehicle).not.toHaveBeenCalled();
  });

  it('exposes rich sortable categories with explicit direction and multi-sort priority', () => {
    const onSortChange = vi.fn();
    render(<InventoryTable vehicles={[heldMovingVehicle()]} sorts={[{ key: 'price', direction: 'asc' }, { key: 'mileage', direction: 'desc' }]} onSortChange={onSortChange} onSelectVehicle={vi.fn()} />);
    const priceSort = screen.getByRole('button', { name: /Price, ascending, primary sort\. Activate to sort descending/i });
    expect(priceSort).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByRole('columnheader', { name: 'Vehicle & pricing' })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(priceSort);
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'price', direction: 'desc' }]);
    fireEvent.click(screen.getByRole('button', { name: 'More Vehicle & pricing sort options' }));
    const mileageSort = screen.getByRole('button', { name: /Mileage, descending, sort priority 2/i });
    expect(mileageSort).toHaveTextContent('#2');
    fireEvent.click(mileageSort, { shiftKey: true });
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'price', direction: 'asc' }, { key: 'mileage', direction: 'asc' }]);
    for (const header of ['Vehicle & pricing', 'Configuration', 'History', 'Operations']) expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    for (const [menu, categories] of [
      ['More Vehicle & pricing sort options', ['Make / model', 'Year', 'Original MSRP', 'Days', 'Inventory date']],
      ['More History sort options', ['Source update', 'Vehicle documents']],
      ['More Operations sort options', ['Home store', 'Movement', 'Last movement', 'Hold salesperson']],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: menu }));
      for (const category of categories) expect(screen.getByRole('button', { name: new RegExp('^Sort by ' + category + ' ascending', 'i') })).toBeInTheDocument();
    }
    expect(new Set(Array.from(document.querySelectorAll<HTMLElement>('[data-sort-key]')).map(element => element.dataset.sortKey))).toEqual(new Set([
      'vehicle', 'year', 'makeModel', 'trim', 'bodyStyle', 'exteriorColor', 'engine', 'transmission', 'fuelType', 'stock', 'vin', 'homeStore', 'price', 'msrp',
      'mileage', 'daysListed', 'inventoryDate', 'holdStatus', 'websiteStatus', 'movementStatus', 'recentActivity', 'photoCount', 'autoCheckScore',
      'documentAvailability', 'salesperson', 'certified', 'currentLocation', 'lastMovement',
    ]));
  });

  it('exposes details, records, move, save, and listing directly with no More menu; hold and service open from their Operations signals', async () => {
    const vehicle = heldMovingVehicle();
    const onSelectVehicle = vi.fn();
    const onOpenSourceRecord = vi.fn();
    const onOpenListing = vi.fn();
    const onRequestVehicle = vi.fn();
    const onTrackMovement = vi.fn();
    const props = { vehicles: [vehicle], sorts: [] as const, onSortChange: vi.fn(), onSelectVehicle, canRequestVehicle: () => true, onRequestVehicle, onTrackMovement, onOpenListing, onOpenSourceRecord };
    const { rerender } = render(<InventoryTable {...props} sorts={[]} />);
    const row = screen.getByRole('button', { name: /Open vehicle details/ }).closest('tr')!;
    const actions = within(row.closest('tbody')!);
    expect(actions.getByRole('button', { name: /Open vehicle details/ })).toHaveTextContent('2024 Ford F-150');
    expect(actions.getByRole('button', { name: /Open vehicle records/ })).toHaveAttribute('title', 'Open vehicle records');
    expect(actions.getByRole('button', { name: /Track movement/ })).toHaveAttribute('title', 'Track movement');
    expect(actions.getByRole('button', { name: /Save .* to shortlist/ })).toHaveAttribute('title', 'Save to shortlist');
    expect(actions.getByRole('button', { name: /Open listing/ })).toHaveAttribute('title', 'Open listing');
    // The Operations column already carries the clickable hold signal and the
    // service link, so the action group does not duplicate them.
    expect(actions.queryByRole('button', { name: /Open hold and movement details/ })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Actions for 2024 Ford F-150 XLT' })).queryByRole('link', { name: /Open service status/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Open service status for VIN/ })).toHaveAttribute('href', `/service?vin=${vehicle.vin}`);
    fireEvent.click(actions.getByRole('button', { name: /Open vehicle details/ }));
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle);
    fireEvent.click(actions.getByRole('button', { name: /Open vehicle records/ }));
    expect(onSelectVehicle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Full vehicle' }));
    await waitFor(() => expect(onSelectVehicle).toHaveBeenLastCalledWith(vehicle, 'data'));
    fireEvent.click(actions.getByRole('button', { name: /Track movement/ }));
    expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(vehicle);
    fireEvent.click(actions.getByRole('button', { name: /Open listing/ }));
    expect(onOpenListing).toHaveBeenCalledExactlyOnceWith(vehicle);
    expect(onSelectVehicle).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: /Review DealerMail handoff/ }));
    expect(onOpenSourceRecord).toHaveBeenCalledExactlyOnceWith(vehicle, 'dealermail');
    fireEvent.click(screen.getByRole('button', { name: /Open vehicle records/ }));
    expect(resource('invoice')).toHaveAttribute('href', expect.stringContaining(vehicle.vin));
    expect(resource('oasis')).toHaveAttribute('href', expect.stringContaining(vehicle.vin));
    expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    const notMoving = { ...vehicle, movement: undefined };
    rerender(<InventoryTable {...props} sorts={[]} vehicles={[notMoving]} />);
    fireEvent.click(screen.getByRole('button', { name: /Request vehicle/ }));
    expect(onRequestVehicle).toHaveBeenCalledExactlyOnceWith(notMoving);
  });

  it('uses the role-aware direct-move action on a stationary manager-owned row', () => {
    const unit = { ...heldMovingVehicle(), movement: undefined };
    const onMoveVehicle = vi.fn();
    render(
      <InventoryTable
        vehicles={[unit]}
        sorts={[]}
        onSortChange={vi.fn()}
        onSelectVehicle={vi.fn()}
        moveActionFor={() => ({ intent: 'direct', label: 'Move to another store', shortLabel: 'Move' })}
        onMoveVehicle={onMoveVehicle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Move to another store/ }));
    expect(onMoveVehicle).toHaveBeenCalledExactlyOnceWith(unit, 'direct');
  });

  it('keeps Track and Move again visible together for an authorized active direct move', () => {
    const unit = heldMovingVehicle();
    const onTrackMovement = vi.fn();
    const onMoveVehicle = vi.fn();
    render(
      <InventoryTable
        vehicles={[unit]}
        sorts={[]}
        onSortChange={vi.fn()}
        onSelectVehicle={vi.fn()}
        moveActionFor={() => ({ intent: 'direct', label: 'Move again', shortLabel: 'Move again' })}
        onMoveVehicle={onMoveVehicle}
        onTrackMovement={onTrackMovement}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Track movement/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Move again/ }));
    expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(unit);
    expect(onMoveVehicle).toHaveBeenCalledExactlyOnceWith(unit, 'direct');
  });

  it('keeps visible header actions on their named fields when a secondary category is the active sort', () => {
    const onSortChange = vi.fn();
    render(<InventoryTable vehicles={[heldMovingVehicle()]} sorts={[{ key: 'stock', direction: 'desc' }, { key: 'mileage', direction: 'desc' }]} onSortChange={onSortChange} onSelectVehicle={vi.fn()} />);
    const vehicleHeader = screen.getByRole('columnheader', { name: 'Vehicle & pricing' });
    const priceHeader = screen.getByRole('columnheader', { name: 'Vehicle & pricing' });
    expect(vehicleHeader).toHaveAttribute('aria-sort', 'descending');
    expect(vehicleHeader).toHaveAttribute('aria-description', 'Sorted by Stock, descending');
    expect(within(priceHeader).getByRole('button', { name: /^Sort by Price ascending/i })).toHaveAttribute('data-sort-direction', 'none');
    fireEvent.click(within(vehicleHeader).getByRole('button', { name: /^Sort by Vehicle ascending/i }));
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'vehicle', direction: 'asc' }]);
    fireEvent.click(within(priceHeader).getByRole('button', { name: /^Sort by Price ascending/i }));
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'price', direction: 'asc' }]);
    fireEvent.click(within(vehicleHeader).getByRole('button', { name: 'More Vehicle & pricing sort options' }));
    expect(within(vehicleHeader).getByRole('button', { name: /Stock, descending, primary sort/i })).toHaveAttribute('data-sort-direction', 'desc');
  });

  it('reads the OASIS source action in US miles when its description prints kilometres', () => {
    const vehicle = heldMovingVehicle();
    vehicle.fordOasis = {
      dataState: 'current',
      capturedAt: '2026-09-11T14:00:00Z',
      openActionsCaptured: true,
      openFieldServiceActions: [{ code: '24S12', description: 'Inspect rear axle before 100,000 km' }],
      warrantyCoverages: [],
      extendedCoverageExpirations: [],
    };
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);
    const oasis = screen.getByRole('region', { name: 'OASIS source evidence for 2024 Ford F-150 XLT' });
    expect(within(oasis).getByText('24S12 · Inspect rear axle before 62,137 mi (100,000 km in the source)')).toBeVisible();
    expect(within(oasis).getByRole('link', { name: 'Open OASIS report in a new tab' })).toBeVisible();
  });

  it('keeps Ford-only dealer tools off non-Ford inventory rows', () => {
    const nonFordVehicle = {
      ...heldMovingVehicle(),
      id: 'TESTDATASYN000008',
      vin: 'TESTDATASYN000008',
      make: 'Chevrolet',
      model: 'Silverado 1500',
    };
    render(
      <InventoryTable
        vehicles={[nonFordVehicle]}
        sorts={[{ key: 'makeModel', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={vi.fn()}
      />,
    );

    expect(document.querySelector('[data-resource="invoice"]')).toBeNull();
    expect(document.querySelector('[data-resource="oasis"]')).toBeNull();
  });

  it('keeps sorting keyboard-safe and revealed row resources focusable', () => {
    render(<InventoryTable vehicles={[heldMovingVehicle()]} sorts={[{ key: 'vehicle', direction: 'asc' }]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()}/>);
    const trigger = screen.getByRole('button', { name: 'More Vehicle & pricing sort options' });
    const panelId = trigger.getAttribute('aria-controls')!;
    expect(document.getElementById(panelId)).toHaveAttribute('hidden');
    fireEvent.click(trigger);
    screen.getByRole('button', { name: /Sort by Original MSRP ascending/ }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /Open vehicle records/ }));
    resource('invoice').focus();
    expect(resource('invoice')).toHaveFocus();
    expect(resource('invoice').closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
  });

  it('keeps request vehicle hidden when the permission callback denies it', () => {
    const viewOnlyVehicle = heldMovingVehicle();
    viewOnlyVehicle.dealerMail = { ...viewOnlyVehicle.dealerMail, canManageHold: false };
    render(
      <InventoryTable
        vehicles={[viewOnlyVehicle]}
        sorts={[{ key: 'makeModel', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={vi.fn()}
        canRequestVehicle={() => false}
        onRequestVehicle={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/i })).toHaveTextContent('Hold · Alex Morgan');
  });

  it('opens the whole row by pointer and keeps a native keyboard-safe View details control', () => {
    const vehicle = heldMovingVehicle();
    const onSelectVehicle = vi.fn();
    const onOpenSourceRecord = vi.fn();
    render(
      <InventoryTable
        vehicles={[vehicle]}
        sorts={[{ key: 'makeModel', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={onSelectVehicle}
        onOpenSourceRecord={onOpenSourceRecord}
      />,
    );
    const details = screen.getByRole('button', { name: /Open vehicle details for 2024 Ford F-150 XLT/i });
    const row = details.closest('tr')!;
    expect(row).not.toHaveAttribute('tabindex');
    fireEvent.click(row);
    fireEvent.click(details);
    expect(onSelectVehicle).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /Review DealerMail handoff for stock H240512/i }));
    expect(onOpenSourceRecord).toHaveBeenCalledWith(vehicle, 'dealermail');
    expect(onSelectVehicle).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /Open vehicle records/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand history details' }));
    fireEvent.click(resource('autocheck'));
    expect(onOpenSourceRecord).toHaveBeenCalledTimes(1);
    expect(onSelectVehicle).toHaveBeenCalledTimes(2);
  });

  it('uses DealerMail full inventory screen instead of broken hold fragments', () => {
    const expectedUrl =
      'https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp?selectedStore=26,25,27,95';
    expect(dealerMailInteractiveVehicleUrl('H13578P')).toBe(expectedUrl);
    expect(dealerMailInteractiveVehicleUrl('T0538U')).toBe(expectedUrl);
    expect(dealerMailInteractiveVehicleUrl(' H-13578P ')).toBe(expectedUrl);
    expect(dealerMailInteractiveVehicleUrl('')).toBeNull();
    expect(dealerMailInteractiveVehicleUrl('H13578P')).not.toContain('USED_hold_edit');
    expect(dealerMailInteractiveVehicleUrl('H13578P')).not.toContain('byItem');
  });
});


describe('captured inventory comparison facts', () => {
  it.each(['desktop', 'mobile'] as const)('preserves sticker currency and partial fuel economy on %s', layout => {
    const vehicle = heldMovingVehicle();
    vehicle.windowSticker = { ...vehicle.windowSticker!, pricingCurrency: 'CAD' };
    vehicle.mpgCity = null;
    vehicle.mpgHighway = 25;
    render(layout === 'desktop'
      ? <InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()}/>
      : <InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()}/>);
    // Desktop keeps original document pricing beside the asking price; the
    // branded source strip remains the provenance-rich record below it.
    if (layout === 'desktop') expect(within(screen.getByRole('cell', { name: /Original MSRP/ })).getByText(/CAD 52,995/)).toBeVisible();
    else expect(within(screen.getByLabelText('Captured factory pricing')).getByText(/CAD 52,995/)).toBeVisible();
    expect(screen.getByText('25 hwy MPG')).toBeVisible();
    expect(screen.queryByText(/0 city/)).not.toBeInTheDocument();
  });

  it('does not invent a sticker price or fuel economy for missing values', () => {
    const vehicle = heldMovingVehicle();
    vehicle.windowSticker = undefined;
    vehicle.msrp = null;
    vehicle.mpgCity = null;
    vehicle.mpgHighway = null;
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()}/>);
    const row = screen.getByRole('button', { name: /Open vehicle details for 2024 Ford F-150/ }).closest('tr')!;
    expect(within(row).queryByText('Sticker MSRP')).not.toBeInTheDocument();
    expect(within(row).queryByText('Original MSRP')).not.toBeInTheDocument();
    expect(within(row).queryByText('Base MSRP')).not.toBeInTheDocument();
    expect(within(row).queryByText('Listed MSRP')).not.toBeInTheDocument();
    expect(within(row).queryByText(/MPG/)).not.toBeInTheDocument();
  });
});
