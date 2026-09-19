import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      expect(row).toHaveTextContent(layout === 'desktop' ? 'Held · Alex Morgan' : 'Held');
      expect(row).toHaveTextContent('In transit outbound');
    });
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

    expect(screen.getByText('Held · Alex Morgan')).toBeInTheDocument();
    expect(screen.getByText('In transit outbound')).toBeInTheDocument();
    expect(screen.getByText('MSRP $52,995')).toBeInTheDocument();
    expect(screen.getByText('MSRP $52,995')).toHaveAttribute('title', '$6,000 under MSRP');
    expect(screen.getAllByText('Equipment Group 302A').length).toBeGreaterThan(0);
    expect(screen.getByText('2.7L EcoBoost V6 · 4x4')).toHaveAttribute('title', 'SuperCrew pickup · 10-speed automatic · Gasoline');
    expect(screen.getByText(/Oxford White \/ Black interior/i)).toBeInTheDocument();
    expect(screen.getByText('2.7L EcoBoost V6 · 4x4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/i })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Open vehicle details for 2024 Ford F-150 XLT/i }).closest('tr') as HTMLTableRowElement;
    expect(row).toHaveClass('inv-desk-row');
    expect(row).toHaveTextContent('Held · Alex Morgan');
    expect(row).toHaveTextContent('Fowlerville');
    expect(row).toHaveTextContent('In transit outbound');
    expect(document.querySelector('.inventory-grid-shell--desk')).toBeInTheDocument();
    expect(document.querySelector('.inv-desk-table')).toBeInTheDocument();
    // Each vehicle has one comparison row plus a shallow full-width resource strip.
    expect(document.querySelectorAll('tbody tr.inv-desk-row')).toHaveLength(1);
    expect(row.nextElementSibling).toHaveClass('inv-desk-resource-row');
    expect(row).toHaveTextContent('H240512');
    expect(row).toHaveTextContent('1FTFW1E84RKF12345');
    expect(within(row).getByRole('button', { name: 'Copy stock number: H240512' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy VIN: 1FTFW1E84RKF12345' })).toBeInTheDocument();
    const vehicleCell = row.querySelector('td[data-column="vehicle"]') as HTMLElement;
    expect(vehicleCell.querySelector('.inv-desk-vehicle__title strong')).toHaveTextContent('2024 Ford F-150');
    expect(vehicleCell.querySelector('.inv-desk-vehicle__title strong')).toHaveAttribute('title', '2024 Ford F-150 XLT');
    expect(row.querySelectorAll('.inv-desk-certified')).toHaveLength(1);
    expect(row.querySelector('td[data-column="price"]')).toHaveTextContent('$46,995');
    const metricsCell = row.querySelector('td[data-column="price"]') as HTMLElement;
    expect(metricsCell).toHaveTextContent('8,642 mi');
    expect(metricsCell).toHaveTextContent('21 days listed');
    const equipmentCell = row.querySelector('td[data-column="configuration"]') as HTMLElement;
    expect(equipmentCell).toHaveTextContent('Equipment Group 302A');
    expect(equipmentCell).toHaveTextContent('+2 more');
    expect(equipmentCell.querySelector('button')).toHaveAttribute('title', expect.stringContaining('XLT Sport Appearance Package'));
    expect(equipmentCell.querySelector('button')).toHaveAttribute('title', expect.stringContaining('Trailer Tow Package (53A)'));
    expect(row.querySelector('.inv-desk-status__detail')).toHaveTextContent('Customer appointment');
    expect(row.querySelector(':scope > td[data-column="actions"] .inv-desk-actions')).toBeInTheDocument();
    const activity = within(row).getByRole('button', { name: /View change history for 2024 Ford F-150 XLT: Price changed/i });
    expect(activity).toHaveTextContent('Price changed');
    expect(activity).toHaveAttribute('title', 'Price changed today');
    expect(activity).not.toHaveTextContent(/AutoCheck|owner|Personal/i);
    expect(Array.from(document.querySelectorAll('thead th')).map((header) =>
      header.querySelector('.inventory-sort-header > span:first-child')?.textContent?.trim() ?? header.textContent?.trim(),
    )).toEqual([
      'Vehicle', 'Price & mileage', 'Configuration', 'Operations', 'Actions',
    ]);
    expect(Array.from(row.querySelectorAll<HTMLElement>('td[data-column]')).map((cell) => cell.dataset.column)).toEqual([
      'vehicle', 'price', 'configuration', 'status', 'actions',
    ]);
    expect(row.querySelectorAll('td')).toHaveLength(5);
    // Actual source resources are immediately visible, not inside a row menu.
    expect(resource('autocheck', row.nextElementSibling!)).toHaveAttribute('title', expect.stringContaining('Score 92'));
    expect(resource('window-sticker', row.nextElementSibling!)).toHaveAttribute('title', expect.stringContaining('Equipment Group 302A'));
    expect(within(row).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
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
    const autoCheck = resource('autocheck');
    expect(autoCheck).toHaveAttribute('title', expect.stringContaining('AutoCheck'));
    expect(autoCheck).toHaveAttribute('title', expect.stringContaining('Score 92'));
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

  it('keeps each row bound to its vehicle and mirrors selected state without leaking private evidence', () => {
    const first = heldMovingVehicle();
    const second = { ...heldMovingVehicle(), id: '1FTFW1E84RKF12346', vin: '1FTFW1E84RKF12346', stockNumber: 'H240513' };
    second.dealerMail = { ...second.dealerMail, canViewEvidence: false, canManageHold: false };
    second.holdEvidence = [{ id: 'private-2', position: 'primary', salesperson: 'Private Salesperson', customerOrReason: 'Private Reason' }];
    render(<InventoryTable vehicles={[first, second]} selectedVehicleId={second.id}
      sorts={[{ key: 'vehicle', direction: 'asc' }]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);

    const rows = document.querySelectorAll<HTMLTableRowElement>('tbody tr.inv-desk-row');
    expect(rows).toHaveLength(2);
    expect(document.querySelectorAll('tbody tr.inv-desk-resource-row')).toHaveLength(2);
    for (const [index, row] of Array.from(rows).entries()) {
      const vehicle = [first, second][index];
      expect(row).toHaveAttribute('data-stock-number', vehicle.stockNumber);
      expect(row).toHaveTextContent(vehicle.stockNumber);
      expect(row).toHaveTextContent(vehicle.vin);
      expect(within(row).getByRole('button', { name: `Copy VIN: ${vehicle.vin}` })).toBeInTheDocument();
      expect(row.querySelectorAll('td')).toHaveLength(5);
      expect(row.classList.contains('is-selected')).toBe(index === 1);
    }
    expect(screen.queryByText('Private Salesperson')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Reason')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review DealerMail handoff for stock H240513/i })).not.toBeInTheDocument();
  });

  it('keeps mobile scan facts, hold, priority resources, Records and movement as sibling targets', () => {
    const vehicle = heldMovingVehicle();
    const onSelectVehicle = vi.fn();
    const onOpenSourceRecord = vi.fn();
    const onTrackMovement = vi.fn();
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={onSelectVehicle} onOpenSourceRecord={onOpenSourceRecord} onTrackMovement={onTrackMovement}/>);
    const card = screen.getByRole('article');
    const detailTarget = within(card).getByRole('button', { name: /^Open details for 2024 Ford F-150 XLT/ });
    expect(card.parentElement).toHaveClass('if-srp-mobile-list');
    for (const fact of ['2024 Ford F-150 XLT', 'H240512', '$46,995', '8,642 mi']) expect(detailTarget).toHaveTextContent(fact);
    expect(detailTarget).not.toHaveTextContent(vehicle.vin);
    expect(detailTarget).toHaveAccessibleName(expect.stringContaining(vehicle.vin));
    expect(card).toHaveTextContent('Held');
    expect(card).toHaveTextContent('Fowlerville');
    expect(card).toHaveTextContent('In transit outbound');
    expect(detailTarget.querySelector('button')).toBeNull();
    fireEvent.click(detailTarget);
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle);
    const hold = within(card).getByRole('button', { name: /Open DealerMail hold tools/ });
    expect(hold).toHaveAttribute('title', expect.stringContaining('Held · Alex Morgan'));
    fireEvent.click(hold);
    expect(onOpenSourceRecord).toHaveBeenCalledExactlyOnceWith(vehicle, 'dealermail');
    const records = within(card).getByRole('button', { name: /Open vehicle records/ });
    fireEvent.click(records);
    expect(onSelectVehicle).toHaveBeenLastCalledWith(vehicle, 'data');
    expect(records).toHaveFocus();
    const beforeResources = onSelectVehicle.mock.calls.length;
    for (const id of ['window-sticker', 'autocheck']) {
      const link = resource(id, card);
      expect(link.tagName).toBe('A');
      expect(link.closest('button')).toBeNull();
      expect(link).toHaveAttribute('target', '_blank');
      fireEvent.click(link);
    }
    expect(onSelectVehicle).toHaveBeenCalledTimes(beforeResources);
    fireEvent.click(within(card).getByRole('button', { name: /Track movement for/ }));
    expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(vehicle);
    expect(within(card).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /View all .* equipment items/ })).not.toBeInTheDocument();
  });

  it('keeps row resources compact while moving long equipment into Records', () => {
    const vehicle = heldMovingVehicle();
    vehicle.features = ['Floor mats', 'Rear defrost'];
    vehicle.windowSticker = { ...vehicle.windowSticker!, equipmentGroup: null, options: [], pricingCurrency: 'CAD' };
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, dataState: 'stale', ownerCount: 2 };
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} />);
    expect(resource('autocheck')).toHaveAttribute('title', expect.stringContaining('2 owners'));
    expect(resource('autocheck').getAttribute('title')).not.toContain('Saved report');
    expect(resource('window-sticker')).toHaveAttribute('title', expect.stringContaining('CAD'));
    expect(resource('window-sticker').getAttribute('title')).not.toContain('USD');
    expect(screen.getByRole('button', { name: /Open vehicle records/ })).toBeInTheDocument();
    expect(screen.queryByText('Floor mats')).not.toBeInTheDocument();
  });

  it('keeps vAuto equipment distinct from a sticker and retains current location', () => {
    const vehicle = heldMovingVehicle();
    vehicle.windowSticker = undefined;
    vehicle.autoCheckReport = undefined;
    vehicle.movement = undefined;
    vehicle.changeSummary = undefined;
    const onSelectVehicle = vi.fn();
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={onSelectVehicle} />);
    expect(resource('vauto').getAttribute('title')).toBeTruthy();
    expect(document.querySelector('[data-resource="window-sticker"]')).toBeNull();
    expect(document.querySelector('[data-resource="autocheck"]')).toBeNull();
    const hold = screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/ });
    expect(hold).toHaveTextContent('Fowlerville');
    fireEvent.click(hold);
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'hold');
    expect(hold).toHaveFocus();
    expect(screen.getByRole('article')).not.toHaveTextContent('No recent change');
  });

  it('keeps Records accessible and history visible without claiming missing reports', () => {
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
    expect(within(card).queryByText('Floor mats')).not.toBeInTheDocument();
    for (const id of ['window-sticker', 'autocheck', 'vauto']) expect(card.querySelector(`[data-resource="${id}"]`)).toBeNull();
    expect(card.querySelector('.inventory-mobile-update')).not.toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /Open vehicle records/ }));
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'data');
    expect(card).toHaveTextContent('Hold status unverified');
    expect(card).not.toHaveTextContent('No current hold');
  });

  it('rejects unsafe document URLs while clearly separating captured data fallback', () => {
    const vehicle = heldMovingVehicle();
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, url: 'https://untrusted.example/autocheck.aspx' };
    vehicle.windowSticker = { ...vehicle.windowSticker!, url: 'javascript:alert(1)' };
    vehicle.factoryEquipment = { ...vehicle.factoryEquipment!, url: 'https://untrusted.example/equipment.pdf' };
    const onSelectVehicle = vi.fn();
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={onSelectVehicle} />);
    expect(screen.getByRole('article')).toHaveAttribute('data-has-document-evidence', 'false');
    for (const id of ['autocheck', 'window-sticker', 'vauto']) {
      expect(resource(id).tagName).toBe('BUTTON');
      expect(resource(id)).not.toHaveAttribute('href');
      expect(resource(id)).toHaveAccessibleName(/View .* data/);
    }
    fireEvent.click(resource('autocheck'));
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle, 'data');
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
    const vehicle = heldMovingVehicle();
    vehicle.movement = { ...vehicle.movement!, overdue: true };
    render(<InventoryMobileList vehicles={[vehicle]} onSelectVehicle={vi.fn()} onTrackMovement={vi.fn()} />);
    expect(document.querySelector('.inventory-mobile-update--warning')).toHaveTextContent('Move needs attention');
    expect(screen.getByRole('button', { name: /Track movement for/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Waiting for service\. Open service status/ })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('data-hold-state', 'held');
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
    expect(card).not.toHaveTextContent('Held · Alex Morgan');
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

    const autoCheck = resource('autocheck');
    const sticker = resource('window-sticker');
    const equipmentProfile = resource('vauto');
    const listing = screen.getByRole('link', { name: /Open listing for 2024 Ford F-150 XLT/i });
    expect(autoCheck).toHaveAttribute('href', 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token');
    expect(sticker).toHaveAttribute('href', 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U');
    expect(equipmentProfile).toHaveAttribute('href', 'https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg');
    expect(listing).toHaveAttribute('href', 'https://www.bobmaxeyfordhowell.com/used/Ford/2024-Ford-F-150-vehicle-token.htm');
    expect(autoCheck).toHaveAttribute('rel', expect.stringContaining('noopener'));

    fireEvent.click(listing);
    fireEvent.click(autoCheck);
    fireEvent.click(sticker);
    fireEvent.click(equipmentProfile);
    expect(onSelectVehicle).not.toHaveBeenCalled();
  });

  it('exposes rich sortable categories with explicit direction and multi-sort priority', () => {
    const onSortChange = vi.fn();
    render(<InventoryTable vehicles={[heldMovingVehicle()]} sorts={[{ key: 'price', direction: 'asc' }, { key: 'mileage', direction: 'desc' }]} onSortChange={onSortChange} onSelectVehicle={vi.fn()} />);
    const priceSort = screen.getByRole('button', { name: /Price, ascending, primary sort\. Activate to sort descending/i });
    expect(priceSort).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByRole('columnheader', { name: 'Price & mileage' })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(priceSort);
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'price', direction: 'desc' }]);
    fireEvent.click(screen.getByRole('button', { name: 'More Price & mileage sort options' }));
    const mileageSort = screen.getByRole('button', { name: /Mileage, descending, sort priority 2/i });
    expect(mileageSort).toHaveTextContent('#2');
    fireEvent.click(mileageSort, { shiftKey: true });
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'price', direction: 'asc' }, { key: 'mileage', direction: 'asc' }]);
    for (const header of ['Vehicle', 'Price & mileage', 'Configuration', 'Operations', 'Actions']) expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    for (const [menu, categories] of [
      ['More Vehicle sort options', ['Make / model', 'Year', 'Source update', 'AutoCheck score', 'Vehicle documents']],
      ['More Price & mileage sort options', ['MSRP', 'Days', 'Inventory date']],
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

  it('exposes details, records, hold, service, move, and listing directly with no More menu', () => {
    const vehicle = heldMovingVehicle();
    const onSelectVehicle = vi.fn();
    const onOpenSourceRecord = vi.fn();
    const onOpenListing = vi.fn();
    const onRequestVehicle = vi.fn();
    const onTrackMovement = vi.fn();
    const props = { vehicles: [vehicle], sorts: [] as const, onSortChange: vi.fn(), onSelectVehicle, canRequestVehicle: true, onRequestVehicle, onTrackMovement, onOpenListing, onOpenSourceRecord };
    const { rerender } = render(<InventoryTable {...props} sorts={[]} />);
    const actions = screen.getByRole('group', { name: 'Actions for 2024 Ford F-150 XLT' });
    expect(within(actions).getAllByRole('button').map(button => button.getAttribute('title'))).toEqual(['Open vehicle', 'Open vehicle records', 'Open hold and movement details', 'Track movement', 'Open listing']);
    fireEvent.click(within(actions).getByRole('button', { name: /Open vehicle details/ }));
    expect(onSelectVehicle).toHaveBeenCalledExactlyOnceWith(vehicle);
    fireEvent.click(within(actions).getByRole('button', { name: /Open vehicle records/ }));
    expect(onSelectVehicle).toHaveBeenLastCalledWith(vehicle, 'data');
    fireEvent.click(within(actions).getByRole('button', { name: /Open hold and movement details/ }));
    expect(onSelectVehicle).toHaveBeenLastCalledWith(vehicle, 'hold');
    expect(within(actions).getByRole('link', { name: /Open service status/ })).toHaveAttribute('href', `/service?vin=${vehicle.vin}`);
    fireEvent.click(within(actions).getByRole('button', { name: /Track movement/ }));
    expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(vehicle);
    fireEvent.click(within(actions).getByRole('button', { name: /Open listing/ }));
    expect(onOpenListing).toHaveBeenCalledExactlyOnceWith(vehicle);
    expect(onSelectVehicle).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: /Review DealerMail handoff/ }));
    expect(onOpenSourceRecord).toHaveBeenCalledExactlyOnceWith(vehicle, 'dealermail');
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
    const vehicleHeader = screen.getByRole('columnheader', { name: 'Vehicle' });
    const priceHeader = screen.getByRole('columnheader', { name: 'Price & mileage' });
    expect(vehicleHeader).toHaveAttribute('aria-sort', 'descending');
    expect(vehicleHeader).toHaveAttribute('aria-description', 'Sorted by Stock, descending');
    expect(priceHeader).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(within(vehicleHeader).getByRole('button', { name: /^Sort by Vehicle ascending/i }));
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'vehicle', direction: 'asc' }]);
    fireEvent.click(within(priceHeader).getByRole('button', { name: /^Sort by Price ascending/i }));
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'price', direction: 'asc' }]);
    fireEvent.click(within(vehicleHeader).getByRole('button', { name: 'More Vehicle sort options' }));
    expect(within(vehicleHeader).getByRole('button', { name: /Stock, descending, primary sort/i })).toHaveAttribute('data-sort-direction', 'desc');
  });

  it('keeps Ford-only dealer tools off non-Ford inventory rows', () => {
    const nonFordVehicle = {
      ...heldMovingVehicle(),
      id: '1GCUDEED9RZ144878',
      vin: '1GCUDEED9RZ144878',
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

  it('keeps sorting keyboard-safe and all row resources focusable without a disclosure', () => {
    render(<InventoryTable vehicles={[heldMovingVehicle()]} sorts={[{ key: 'vehicle', direction: 'asc' }]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()}/>);
    const trigger = screen.getByRole('button', { name: 'More Price & mileage sort options' });
    const panelId = trigger.getAttribute('aria-controls')!;
    expect(document.getElementById(panelId)).toHaveAttribute('hidden');
    fireEvent.click(trigger);
    screen.getByRole('button', { name: /Sort by MSRP ascending/ }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
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
    expect(screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/i })).toHaveTextContent('Held');
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
