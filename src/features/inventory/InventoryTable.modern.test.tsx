import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryMobileList, InventoryTable } from './InventoryTable';
import type { InventoryVehicle } from './types';
import { dealerMailInteractiveVehicleUrl } from './vehicle-document-utils';

afterEach(cleanup);

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
    expect(screen.getByText('21 days listed')).toBeInTheDocument();
    expect(screen.getByText('Equipment Group 302A')).toBeInTheDocument();
    expect(screen.getByText(/XLT Sport Appearance Package/)).toBeInTheDocument();
    expect(screen.getAllByText(/SuperCrew pickup · 4x4/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Oxford White · 2.7L EcoBoost V6/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/i })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Open vehicle details for 2024 Ford F-150 XLT/i }).closest('tr');
    expect(row).toHaveTextContent('Held · Alex Morgan');
    expect(row).toHaveTextContent('Fowlerville');
    expect(row).toHaveTextContent('In transit outbound');
    expect(document.querySelector('.inventory-table--compact-v3')).toBeInTheDocument();
    expect(document.querySelector('.inventory-grid-shell--production-v10')).toBeInTheDocument();
    expect(document.querySelector('.inventory-table--production-v10')).toBeInTheDocument();
    const equipmentCell = row?.querySelector('td[data-column="equipment-highlights"]') as HTMLElement;
    expect(equipmentCell).toHaveTextContent('Equipment Group 302A');
    expect(equipmentCell).toHaveTextContent('XLT Sport Appearance Package');
    expect(row?.querySelector('.inventory-vehicle-copy .inventory-identity-cell')).not.toBeInTheDocument();
    expect(row?.querySelector('.inventory-identity-cell')).not.toBeInTheDocument();
    const recordRow = row?.nextElementSibling as HTMLElement;
    expect(recordRow).toHaveClass('inventory-record-row');
    expect(recordRow.querySelector('td')).toHaveAttribute('colspan', '4');
    expect(recordRow).toHaveTextContent('H240512');
    expect(recordRow).toHaveTextContent('1FTFW1E84RKF12345');
    expect(row?.querySelector(':scope > td:first-child .inventory-row-actions')).toBeInTheDocument();
    expect(row?.querySelector('.inventory-vehicle-copy .inventory-certified-label')).not.toBeInTheDocument();
    expect(row?.querySelectorAll('.inventory-equipment-cell__certified')).toHaveLength(1);
    const documents = screen.getByLabelText('Vehicle documents');
    expect(documents).toHaveTextContent('AutoCheckScore 92 · 1 owner');
    expect(documents.querySelector('.inventory-document-wordmark--autocheck img')).toHaveAttribute(
      'src',
      'https://www.autocheck.com/reportservice/common/img/autocheck-logo.svg',
    );
    expect(documents).toHaveTextContent('Window stickerEquipment Group 302A · 1 option');
    expect(documents).toHaveTextContent('No photos published');
    const activity = document.querySelector('.inventory-change-summary') as HTMLElement;
    expect(activity).toHaveTextContent('Price changed');
    expect(activity).toHaveTextContent('Price changed today');
    expect(activity).not.toHaveTextContent(/AutoCheck|owner|Personal/i);
    expect(Array.from(document.querySelectorAll('thead th')).map((header) =>
      header.querySelector('.inventory-sort-header > span:first-child')?.textContent?.trim() ?? header.textContent?.trim(),
    )).toEqual([
      'Vehicle', 'Price & mileage', 'Equipment', 'Hold & location',
    ]);
    expect(Array.from(row?.querySelectorAll<HTMLElement>('td[data-column]') ?? []).map((cell) => cell.dataset.column)).toEqual([
      'vehicle-identity', 'financial-age', 'equipment-highlights',
      'availability-movement',
    ]);
    expect(row?.querySelectorAll('td')).toHaveLength(4);
    expect(recordRow.querySelectorAll('td')).toHaveLength(1);
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

    expect(document.querySelector('.inventory-record-band__change')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View change history/i })).not.toBeInTheDocument();
    const documents = screen.getByLabelText('Vehicle documents');
    expect(documents).toHaveTextContent('AutoCheck');
    expect(documents).toHaveTextContent('Score 92 · 1 owner');
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

  it('keeps each record strip aligned to its vehicle and mirrors selected state without leaking private evidence', () => {
    const first = heldMovingVehicle();
    const second = { ...heldMovingVehicle(), id: '1FTFW1E84RKF12346', vin: '1FTFW1E84RKF12346', stockNumber: 'H240513' };
    second.dealerMail = { ...second.dealerMail, canViewEvidence: false, canManageHold: false };
    second.holdEvidence = [{ id: 'private-2', position: 'primary', salesperson: 'Private Salesperson', customerOrReason: 'Private Reason' }];
    render(<InventoryTable vehicles={[first, second]} selectedVehicleId={second.id}
      sorts={[{ key: 'vehicle', direction: 'asc' }]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />);

    const rows = document.querySelectorAll<HTMLTableRowElement>('tbody tr.inventory-main-row');
    expect(rows).toHaveLength(2);
    for (const [index, row] of Array.from(rows).entries()) {
      const vehicle = [first, second][index];
      const recordRow = row.nextElementSibling as HTMLElement;
      expect(row).toHaveAttribute('data-stock-number', vehicle.stockNumber);
      expect(recordRow).toHaveAttribute('data-record-stock', vehicle.stockNumber);
      expect(recordRow).toHaveTextContent(vehicle.vin);
      expect(recordRow.querySelector('td')).toHaveAttribute('colspan', '4');
      expect(row.classList.contains('is-selected')).toBe(index === 1);
      expect(recordRow.classList.contains('is-selected')).toBe(index === 1);
    }
    expect(screen.queryByText('Private Salesperson')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Reason')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review DealerMail handoff for stock H240513/i })).not.toBeInTheDocument();
  });

  it('keeps mobile vehicle details and hold tools as two clear sibling targets', () => {
    const onSelectVehicle = vi.fn();
    const onOpenSourceRecord = vi.fn();
    render(
      <InventoryMobileList
        vehicles={[heldMovingVehicle()]}
        onSelectVehicle={onSelectVehicle}
        onOpenSourceRecord={onOpenSourceRecord}
      />,
    );

    const card = screen.getByRole('article');
    const detailTarget = within(card).getByRole('button', { name: /Open details for 2024 Ford F-150 XLT.*stock H240512.*Hold: Held · Alex Morgan.*Movement: In transit outbound.*AutoCheck report available.*Window sticker available/i });
    const holdTarget = within(card).getByRole('button', { name: /Open DealerMail hold tools for stock H240512/i });
    expect(within(card).getAllByRole('button')).toHaveLength(2);
    expect(detailTarget).toHaveTextContent('2024 Ford F-150 XLT');
    expect(detailTarget).toHaveTextContent('SuperCrew pickup · 4x4 · 2.7L EcoBoost V6');
    expect(detailTarget).toHaveTextContent('H240512');
    expect(detailTarget).toHaveTextContent('1FTFW1E84RKF12345');
    expect(detailTarget).toHaveTextContent('$46,995');
    expect(detailTarget).toHaveTextContent('8,642 mi');
    expect(card).toHaveTextContent('Held · Alex Morgan');
    expect(card).toHaveTextContent('Fowlerville');
    expect(card).toHaveTextContent('AutoCheck');
    expect(card).toHaveTextContent('Sticker');
    expect(card).toHaveTextContent('In transit outbound');
    expect(detailTarget.querySelector('.inventory-mobile-row__title .inventory-certified-label')).not.toBeInTheDocument();
    expect(detailTarget.querySelector('.inventory-mobile-row__valuation .inventory-certified-label')).toBeInTheDocument();
    expect(detailTarget.querySelector(':scope > .inventory-mobile-row__identity')).toHaveTextContent('H240512');
    expect(detailTarget.querySelector(':scope > .inventory-mobile-row__identity')).toHaveTextContent('1FTFW1E84RKF12345');

    fireEvent.click(detailTarget);
    expect(onSelectVehicle).toHaveBeenCalledWith(expect.objectContaining({ vin: '1FTFW1E84RKF12345' }));
    expect(onSelectVehicle).toHaveBeenCalledTimes(1);
    expect(onOpenSourceRecord).not.toHaveBeenCalled();

    fireEvent.click(holdTarget);
    expect(onOpenSourceRecord).toHaveBeenCalledWith(expect.objectContaining({ vin: '1FTFW1E84RKF12345' }), 'dealermail');
    expect(onSelectVehicle).toHaveBeenCalledTimes(1);
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

    const autoCheck = screen.getByRole('link', { name: /Open AutoCheck report for 2024 Ford F-150 XLT/i });
    const sticker = screen.getByRole('link', { name: /Open window sticker for 2024 Ford F-150 XLT/i });
    fireEvent.click(screen.getByRole('button', { name: /More actions for 2024 Ford F-150 XLT/i }));
    const equipmentProfile = screen.getByRole('link', { name: /Open factory equipment profile for 2024 Ford F-150 XLT/i });
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
    render(
      <InventoryTable
        vehicles={[heldMovingVehicle()]}
        sorts={[
          { key: 'price', direction: 'asc' },
          { key: 'mileage', direction: 'desc' },
        ]}
        onSortChange={onSortChange}
        onSelectVehicle={vi.fn()}
      />,
    );

    const priceSort = screen.getByRole('button', {
      name: /Price, ascending, primary sort\. Activate to sort descending/i,
    });
    fireEvent.click(screen.getByRole('button', { name: /More Price & mileage sort options/i }));
    const mileageSort = screen.getByRole('button', {
      name: /Mileage, descending, sort priority 2\. Activate to sort ascending/i,
    });
    expect(priceSort).toHaveAttribute('data-sort-direction', 'asc');
    expect(priceSort).toHaveTextContent('Asc');
    expect(mileageSort).toHaveTextContent('Desc');
    expect(mileageSort).toHaveTextContent('#2');
    for (const header of ['Vehicle', 'Price & mileage', 'Equipment', 'Hold & location']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(header, 'i') })).toBeInTheDocument();
    }

    fireEvent.click(priceSort);
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'price', direction: 'desc' }]);

    fireEvent.click(screen.getByRole('button', { name: /More Vehicle sort options/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /Sort by Stock ascending/i }),
      { shiftKey: true },
    );
    expect(onSortChange).toHaveBeenLastCalledWith([
      { key: 'price', direction: 'asc' },
      { key: 'mileage', direction: 'desc' },
      { key: 'stock', direction: 'asc' },
    ]);

    for (const [menu, categories] of [
      ['More Vehicle sort options', ['Make / model', 'Year', 'Source update', 'AutoCheck score', 'Vehicle documents']],
      ['More Price & mileage sort options', ['Days']],
      ['More Hold & location sort options', ['Home store']],
    ] as const) {
      const trigger = screen.getByRole('button', { name: menu });
      if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
      for (const category of categories) {
        expect(screen.getByRole('button', { name: new RegExp(`^Sort by ${category}(?: ascending| descending|\\.)`, 'i') })).toBeInTheDocument();
      }
    }
    expect(screen.getByRole('button', { name: /^Sort by Hold(?: ascending| descending|\.)/i })).toBeInTheDocument();

    expect(new Set(
      Array.from(document.querySelectorAll<HTMLElement>('[data-sort-key]'))
        .map((element) => element.dataset.sortKey),
    )).toEqual(new Set([
      'vehicle', 'year', 'makeModel', 'trim', 'bodyStyle', 'exteriorColor', 'engine',
      'transmission', 'fuelType', 'stock', 'vin', 'homeStore', 'price', 'msrp',
      'mileage', 'daysListed', 'inventoryDate', 'holdStatus', 'websiteStatus',
      'movementStatus', 'recentActivity', 'photoCount', 'autoCheckScore',
      'documentAvailability', 'salesperson', 'certified', 'currentLocation', 'lastMovement',
    ]));
  });

  it('routes prominent row actions through existing read-only callbacks', () => {
    const vehicle = heldMovingVehicle();
    const onSelectVehicle = vi.fn();
    const onOpenSourceRecord = vi.fn();
    const onOpenListing = vi.fn();
    const onRequestVehicle = vi.fn();
    const onTrackMovement = vi.fn();
    render(
      <InventoryTable
        vehicles={[vehicle]}
        sorts={[{ key: 'recentActivity', direction: 'desc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={onSelectVehicle}
        canRequestVehicle
        onRequestVehicle={onRequestVehicle}
        onTrackMovement={onTrackMovement}
        onOpenListing={onOpenListing}
        onOpenSourceRecord={onOpenSourceRecord}
      />,
    );

    const openDetails = screen.getByRole('button', { name: /Open vehicle details for 2024 Ford F-150 XLT/i });
    const actionGroup = document.querySelector('.inventory-row-actions--compact-v3') as HTMLElement;
    expect(actionGroup).toHaveAttribute('data-has-dealermail', 'true');
    expect(actionGroup).toHaveAttribute('data-has-overflow', 'true');
    expect(actionGroup).toHaveAttribute('data-responsive-labels', 'persistent');
    expect(within(actionGroup).getByText('View details')).toBeInTheDocument();
    expect(within(actionGroup).queryByRole('button', { name: /Open DealerMail for stock H240512/i })).not.toBeInTheDocument();
    expect(within(actionGroup).getByText('More')).toBeInTheDocument();
    expect(actionGroup.querySelectorAll('.inventory-row-action-label')).toHaveLength(2);
    expect(
      Array.from(actionGroup.querySelectorAll('.inventory-row-action-label'))
        .map((element) => element.textContent),
    ).toEqual(['View details', 'More']);
    fireEvent.click(openDetails);
    expect(onSelectVehicle).toHaveBeenCalledWith(vehicle);
    const row = openDetails.closest('tr')!;
    fireEvent.click(row);
    expect(onSelectVehicle).toHaveBeenCalledWith(vehicle);

    fireEvent.click(screen.getByRole('button', { name: /Review DealerMail handoff for stock H240512; verify VIN/i }));
    expect(onOpenSourceRecord).toHaveBeenCalledWith(vehicle, 'dealermail');
    const moreActions = screen.getByRole('button', { name: 'More actions for 2024 Ford F-150 XLT' });
    expect(moreActions).toHaveAttribute('aria-label', 'More actions for 2024 Ford F-150 XLT');
    fireEvent.click(moreActions!);
    const floatingMenu = screen.getByRole('group', { name: 'More actions for 2024 Ford F-150 XLT' });
    expect(floatingMenu).toHaveClass('inventory-row-more__menu--floating-v10');
    expect(floatingMenu.parentElement).toBe(document.body);
    fireEvent.click(within(floatingMenu).getByRole('button', { name: /Open DealerMail for stock H240512/i }));
    expect(onOpenSourceRecord).toHaveBeenLastCalledWith(vehicle, 'dealermail');
    fireEvent.click(moreActions);
    expect(screen.getByRole('link', { name: /Open Ford invoice lookup/i })).toHaveAttribute('href', expect.stringContaining(vehicle.vin));
    expect(screen.getByRole('link', { name: /Open Ford OASIS/i })).toHaveAttribute('href', expect.stringContaining(vehicle.vin));
    fireEvent.click(screen.getByRole('button', { name: 'Open listing' }));
    fireEvent.click(moreActions);
    fireEvent.click(screen.getByRole('button', { name: 'Request vehicle' }));
    fireEvent.click(moreActions);
    fireEvent.click(screen.getByRole('button', { name: 'Track movement' }));
    expect(onOpenListing).toHaveBeenCalledWith(vehicle);
    expect(onRequestVehicle).toHaveBeenCalledWith(vehicle);
    expect(onTrackMovement).toHaveBeenCalledWith(vehicle);
  });

  it('keeps visible header actions on their named fields when a secondary category is the active sort', () => {
    const onSortChange = vi.fn();
    render(<InventoryTable vehicles={[heldMovingVehicle()]}
      sorts={[{ key: 'stock', direction: 'desc' }, { key: 'mileage', direction: 'desc' }]}
      onSortChange={onSortChange} onSelectVehicle={vi.fn()} />);

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

    fireEvent.click(screen.getByRole('button', { name: /More actions for 2024 Chevrolet Silverado 1500 XLT/i }));
    expect(screen.queryByRole('link', { name: /Ford invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Ford OASIS/i })).not.toBeInTheDocument();
  });

  it('makes sort and row action disclosures deterministic for keyboard and pointer users', () => {
    render(
      <InventoryTable
        vehicles={[heldMovingVehicle()]}
        sorts={[{ key: 'vehicle', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={vi.fn()}
      />,
    );

    const sortTrigger = screen.getByRole('button', { name: 'More Price & mileage sort options' });
    const sortPanelId = sortTrigger.getAttribute('aria-controls')!;
    expect(sortTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(sortPanelId)).toHaveAttribute('hidden');
    fireEvent.click(sortTrigger);
    expect(sortTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(sortPanelId)).not.toHaveAttribute('hidden');
    screen.getByRole('button', { name: /Sort by MSRP ascending/i }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sortTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(sortTrigger).toHaveFocus();

    const rowTrigger = screen.getByRole('button', { name: 'More actions for 2024 Ford F-150 XLT' });
    const rowPanelId = rowTrigger.getAttribute('aria-controls')!;
    fireEvent.click(rowTrigger);
    expect(rowTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(rowPanelId)).not.toHaveAttribute('hidden');
    fireEvent.pointerDown(document.body);
    expect(rowTrigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(rowTrigger);
    screen.getByRole('link', { name: /Open Ford invoice lookup/i }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(rowTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(rowTrigger).toHaveFocus();
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

    fireEvent.click(screen.getByRole('button', { name: /More actions for 2024 Ford F-150 XLT/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open DealerMail for stock H240512/i }));
    expect(onOpenSourceRecord).toHaveBeenCalledTimes(2);
    expect(onOpenSourceRecord).toHaveBeenLastCalledWith(vehicle, 'dealermail');
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
