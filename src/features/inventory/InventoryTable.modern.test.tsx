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
    expect(screen.getAllByText(/SuperCrew pickup · 2.7L EcoBoost V6/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Open hold details for 2024 Ford F-150 XLT/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Hold: Held · Alex Morgan.*Current location: Fowlerville.*Movement: In transit outbound/i })).toBeInTheDocument();
    expect(document.querySelector('.inventory-table--compact-v3')).toBeInTheDocument();
    expect(document.querySelector('.inventory-equipment-cell')?.children).toHaveLength(3);
    expect(screen.getByLabelText('Vehicle documents')).toHaveTextContent('AutoCheckSticker');
  });

  it('makes the complete mobile evidence row one clear detail target', () => {
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
    expect(within(card).getAllByRole('button')).toHaveLength(1);
    expect(detailTarget).toHaveTextContent('2024 Ford F-150 XLT');
    expect(detailTarget).toHaveTextContent('SuperCrew pickup · 4x4 · 2.7L EcoBoost V6');
    expect(detailTarget).toHaveTextContent('H240512');
    expect(detailTarget).toHaveTextContent('1FTFW1E84RKF12345');
    expect(detailTarget).toHaveTextContent('$46,995');
    expect(detailTarget).toHaveTextContent('8,642 mi');
    expect(detailTarget).toHaveTextContent('Held · Alex Morgan');
    expect(detailTarget).toHaveTextContent('Fowlerville');
    expect(detailTarget).toHaveTextContent('AutoCheck');
    expect(detailTarget).toHaveTextContent('Sticker');
    expect(detailTarget).toHaveTextContent('In transit outbound');

    fireEvent.click(detailTarget);
    expect(onSelectVehicle).toHaveBeenCalledWith(expect.objectContaining({ vin: '1FTFW1E84RKF12345' }));
    expect(onSelectVehicle).toHaveBeenCalledTimes(1);
    expect(onOpenSourceRecord).not.toHaveBeenCalled();
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
    const equipmentProfile = screen.getByRole('link', { name: /Open vAuto informational equipment profile for 2024 Ford F-150 XLT/i });
    const listing = screen.getByRole('link', { name: /Open website listing for 2024 Ford F-150 XLT/i });
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
    const mileageSort = screen.getByRole('button', {
      name: /Mileage, descending, sort priority 2\. Activate to sort ascending/i,
    });
    expect(priceSort).toHaveAttribute('data-sort-direction', 'asc');
    expect(priceSort).toHaveTextContent('Asc');
    expect(mileageSort).toHaveTextContent('Desc');
    expect(mileageSort).toHaveTextContent('#2');

    fireEvent.click(priceSort);
    expect(onSortChange).toHaveBeenLastCalledWith([{ key: 'price', direction: 'desc' }]);

    fireEvent.click(
      screen.getByRole('button', { name: /Sort by Stock ascending/i }),
      { shiftKey: true },
    );
    expect(onSortChange).toHaveBeenLastCalledWith([
      { key: 'price', direction: 'asc' },
      { key: 'mileage', direction: 'desc' },
      { key: 'stock', direction: 'asc' },
    ]);

    for (const category of ['Make / model', 'Year', 'Days', 'Hold', 'Home store', 'Source update']) {
      expect(screen.getByRole('button', { name: new RegExp(`^Sort by ${category}(?: ascending| descending|\\.)`, 'i') })).toBeInTheDocument();
    }

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
    expect(within(actionGroup).getByText('Details')).toBeInTheDocument();
    expect(within(actionGroup).getByText('DealerMail')).toBeInTheDocument();
    expect(within(actionGroup).getByText('More')).toBeInTheDocument();
    expect(actionGroup.querySelectorAll('.inventory-row-action-label')).toHaveLength(3);
    expect(
      Array.from(actionGroup.querySelectorAll('.inventory-row-action-label'))
        .map((element) => element.textContent),
    ).toEqual(['Details', 'DealerMail', 'More']);
    fireEvent.click(openDetails);
    expect(onSelectVehicle).toHaveBeenCalledWith(vehicle);
    const row = screen.getByRole('row', { name: /^Open details for 2024 Ford F-150 XLT/i });
    fireEvent.click(row);
    expect(onSelectVehicle).toHaveBeenCalledWith(vehicle);

    fireEvent.click(screen.getByRole('button', { name: /Open interactive DealerMail and copy stock H240512; verify VIN/i }));
    expect(onOpenSourceRecord).toHaveBeenCalledWith(vehicle, 'dealermail');
    fireEvent.click(within(actionGroup).getByRole('button', { name: /Open DealerMail for stock H240512/i }));
    expect(onOpenSourceRecord).toHaveBeenLastCalledWith(vehicle, 'dealermail');

    const moreActions = screen.getByText('More actions').closest('summary');
    expect(moreActions).toHaveAttribute('aria-label', 'More actions for 2024 Ford F-150 XLT');
    fireEvent.click(moreActions!);
    expect(screen.getByRole('link', { name: /Open Ford invoice lookup/i })).toHaveAttribute('href', expect.stringContaining(vehicle.vin));
    expect(screen.getByRole('link', { name: /Open Ford OASIS/i })).toHaveAttribute('href', expect.stringContaining(vehicle.vin));
    fireEvent.click(screen.getByRole('button', { name: 'Website listing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Request vehicle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Track movement' }));
    expect(onOpenListing).toHaveBeenCalledWith(vehicle);
    expect(onRequestVehicle).toHaveBeenCalledWith(vehicle);
    expect(onTrackMovement).toHaveBeenCalledWith(vehicle);
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

    fireEvent.click(screen.getByText('More actions').closest('summary')!);
    expect(screen.queryByRole('link', { name: /Ford invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Ford OASIS/i })).not.toBeInTheDocument();
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

  it('opens the whole row with pointer or keyboard without hijacking the hold action', () => {
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
    const row = screen.getByRole('row', { name: /stock H240512/i });
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelectVehicle).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('button', { name: /Open interactive DealerMail and copy stock H240512/i }));
    expect(onOpenSourceRecord).toHaveBeenCalledWith(vehicle, 'dealermail');
    expect(onSelectVehicle).toHaveBeenCalledTimes(3);

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
