import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleWorkspace } from './VehicleWorkspace';
import type { InventoryVehicle } from './types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function vehicle(): InventoryVehicle {
  return {
    id: 'TESTDATASYN000002',
    vin: 'TESTDATASYN000002',
    stockNumber: 'W5863Q',
    year: 2017,
    make: 'Ford',
    model: 'F-150',
    trim: 'Lariat',
    price: 20988,
    msrp: 50560,
    mileage: 123328,
    daysListed: 2,
    inventoryDate: '2026-08-29',
    bodyType: 'SuperCrew 4x4',
    drivetrain: '4WD',
    engine: '3.5L V6 EcoBoost',
    transmission: '10-Speed Automatic',
    fuelType: 'Gasoline',
    exteriorColor: 'Black',
    interiorColor: 'Black Leather',
    photoCount: 6,
    publicListing: {
      dataState: 'current',
      isListed: false,
      websiteStatus: 'Not live on website',
      updatedAt: '2026-08-29T23:50:00-04:00',
    },
    dealerOn: {
      dataState: 'stale',
      inStock: true,
      inTransit: false,
      inProduction: false,
      updatedAt: '2026-08-29T23:50:00-04:00',
    },
    dealerMail: {
      dataState: 'current',
      hasActiveHold: true,
      position: 'primary',
      activeRecordCount: 1,
      canViewEvidence: true,
      canManageHold: true,
      updatedAt: '2026-08-29T23:50:00-04:00',
    },
    holdEvidence: [{
      id: 'hold-1',
      position: 'primary',
      salesperson: 'Jamie Howell',
      customerOrReason: 'Customer appointment',
      cdkState: 'STATUS: S',
    }],
    location: {
      homeStore: { id: 'fowlerville', name: 'Fowlerville' },
      sourceReportedStore: { id: 'fowlerville', name: 'Fowlerville' },
    },
    changeSummary: 'Price decreased from $21,988 to $20,988',
    timeline: [{
      id: 'price-change',
      occurredAt: '2026-08-29T21:15:00-04:00',
      title: 'Price changed',
      detail: 'Price decreased from $21,988 to $20,988',
      source: 'public',
    }],
  };
}

describe('focused vehicle workspace', () => {
  it('does not turn a literal fee or total MSRP into the base-MSRP lookup when base is missing', async () => {
    const unit = vehicle();
    unit.windowSticker = {dataState:'current',totalMsrp:50560,pricingCurrency:'USD',options:['WEIGHT FEE — $123.45']};
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const facts=screen.getByRole('region',{name:'Frequently used vehicle facts'});
    const lookup=within(facts).getByText('Weight fee lookup · Base MSRP',{selector:'dt'}).parentElement!;
    expect(lookup).toHaveTextContent('—');
    expect(lookup).not.toHaveTextContent(/123\.45|50,560|USD|\$/);
    expect(within(facts).queryByText('Weight fee',{selector:'dt'})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab',{name:'Records'}));
    expect(document.querySelector('.vdp-records-summary')).toHaveTextContent('Weight fee lookup · Base MSRP—');
    expect(screen.getByRole('list',{name:'Factory options'})).toHaveTextContent('WEIGHT FEE — $123.45');
  });

  it('retains an original sticker base with unknown currency without borrowing another source currency', () => {
    const unit=vehicle();
    unit.windowSticker={dataState:'current',basePrice:42500.5};
    unit.factoryEquipment={dataState:'current',isOriginalWindowSticker:false,basePrice:39999};
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const facts=screen.getByRole('region',{name:'Frequently used vehicle facts'});
    const lookup=within(facts).getByText('Weight fee lookup · Base MSRP',{selector:'dt'}).parentElement!;
    expect(lookup).toHaveTextContent('42,500.5');
    expect(lookup).not.toHaveTextContent('Sticker · confirm currency');
    expect(lookup).not.toHaveTextContent(/USD|CAD|\$|39,999/);
    expect(unit.windowSticker.basePrice).toBe(42500.5);
  });

  it('keeps reference pricing currency separate from a partial original sticker', async () => {
    const unit = vehicle();
    unit.windowSticker = { dataState: 'current', pricingCurrency: 'CAD' };
    unit.factoryEquipment = { dataState: 'current', isOriginalWindowSticker: false, basePrice: 31234.5, totalMsrp: 35432, sections: [{ name: 'Fees', items: [{ label: 'Weight fee', price: 123.45 }] }] };
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const facts = screen.getByRole('region', { name: 'Frequently used vehicle facts' });
    expect(facts).toHaveTextContent('Weight fee lookup · Base MSRP31,234.5');
    expect(facts).not.toHaveTextContent('vAuto reference · confirm on sticker');
    expect(within(facts).queryByText('Weight fee', {selector:'dt'})).not.toBeInTheDocument();
    expect(facts).not.toHaveTextContent('123.45');
    expect(facts).not.toHaveTextContent(/CAD|USD|\$/);
    await userEvent.click(screen.getByRole('tab', { name: 'Records' }));
    const profile = document.querySelector('[data-document-kind="vauto-factory-equipment"]')!;
    expect(within(profile as HTMLElement).queryByText('35,432')).not.toBeInTheDocument();
    expect(within(profile as HTMLElement).queryByText('Source details')).not.toBeInTheDocument();
    expect(profile).toHaveTextContent('Weight fee');
    expect(profile).not.toHaveTextContent('currency not captured');
    expect(profile).not.toHaveTextContent(/CAD|USD|\$/);
  });

  it('uses actual sticker base currency and clearly attributes estimated in-service dates', async () => {
    const unit = vehicle();
    unit.windowSticker = { dataState: 'current', basePrice: 45000, pricingCurrency: 'CAD' };
    unit.factoryEquipment = { dataState: 'current', isOriginalWindowSticker: false, basePrice: 31234 };
    unit.autoCheckReport = { dataState: 'current', estimatedInServiceDate: '2023-05-12' };
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const facts = screen.getByRole('region', { name: 'Frequently used vehicle facts' });
    expect(facts).toHaveTextContent('Weight fee lookup · Base MSRPCAD 45,000');
    expect(facts).not.toHaveTextContent('31,234');
    expect(within(facts).getAllByText('Weight fee lookup · Base MSRP')).toHaveLength(1);
    expect(facts).toHaveTextContent('In-service · AutoCheck estimateMay 12, 2023');
    await userEvent.click(screen.getByRole('tab', { name: 'Records' }));
    expect(document.querySelector('.vdp-records-summary')).toHaveTextContent('In-service · AutoCheck estimateMay 12, 2023');
    expect(document.querySelector('.vdp-records-summary')).toHaveTextContent('Weight fee lookup · Base MSRPCAD 45,000');
  });

  it('prefers captured OASIS in-service date over AutoCheck estimates', () => {
    const unit = vehicle();
    unit.fordOasis = { dataState: 'current', warrantyStartDate: '2023-05-13', openFieldServiceActions: [], warrantyCoverages: [], extendedCoverageExpirations: [] };
    unit.autoCheckReport = { dataState: 'current', estimatedInServiceDate: '2023-05-12' };
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const facts = screen.getByRole('region', { name: 'Frequently used vehicle facts' });
    expect(facts).toHaveTextContent('Warranty in-service · OASISMay 13, 2023');
    expect(facts).not.toHaveTextContent('estimate');
  });

  it('keeps one vehicle identity, exact copy controls and persistent close controls', () => {
    render(<main><VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={vi.fn()} /></main>);
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: '2017 Ford F-150 Lariat' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Copy stock number: W5863Q' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy VIN: TESTDATASYN000002' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to inventory' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close vehicle details' })).toBeVisible();
    expect(document.querySelector('.inventory-workspace-backdrop')).toHaveAttribute('aria-hidden', 'true');
    const scroll = document.querySelector('.vdp-focus-scroll')!;
    expect(scroll.contains(screen.getByRole('tablist'))).toBe(false);
    expect(scroll.contains(screen.getByRole('heading', { name: '2017 Ford F-150 Lariat' }))).toBe(false);
    expect(scroll.contains(screen.getByRole('toolbar', { name: 'Vehicle actions' }))).toBe(false);
  });

  it('exposes exact source links in recognizable cards and keeps utility actions separate', () => {
    const unit = vehicle();
    unit.publicListing.listingUrl = 'https://www.bobmaxeyfordhowell.com/vehicle-details?stock=W5863Q';
    unit.autoCheckReport = { dataState: 'current', url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token' };
    unit.windowSticker = { dataState: 'current', url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U' };
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const sources = screen.getByRole('region', { name: 'Documents and vehicle records' });
    expect(within(sources).getByRole('link', { name: /Open AutoCheck history for VIN/ })).toHaveAttribute('href', unit.autoCheckReport.url);
    expect(within(sources).getByRole('link', { name: /Open sticker for VIN/ })).toHaveAttribute('href', unit.windowSticker.url);
    expect(within(sources).getByRole('link', { name: /Open OASIS for VIN/ })).toHaveAttribute('rel', 'noopener noreferrer');
    const toolbar = screen.getByRole('toolbar', { name: 'Vehicle actions' });
    expect(within(toolbar).getByRole('link', { name: 'Listing' })).toBeVisible();
    expect(within(toolbar).getByRole('link', { name: 'Invoice' })).toBeVisible();
    expect(within(toolbar).getByRole('button', { name: 'Take-home page' })).toBeVisible();
    expect(screen.queryByText('More resources')).not.toBeInTheDocument();
  });

  it('shows decisive facts and operational context immediately', () => {
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={vi.fn()} />);
    const specs = screen.getByRole('region', { name: 'Vehicle specifications' });
    for (const value of ['3.5L V6 EcoBoost', 'SuperCrew 4x4', '10-Speed Automatic', '4WD', '123,328 mi']) expect(specs).toHaveTextContent(value);
    expect(screen.getByText('$20,988')).toBeVisible();
    const operations = screen.getByRole('region', { name: 'Vehicle operational summary' });
    expect(operations).toHaveTextContent('Held · Jamie Howell');
    expect(operations).toHaveTextContent('Jamie Howell');
    expect(operations).not.toHaveTextContent(/sold|delivered|CDK/);
  });

  it('provides compact mobile specs and nests backup context under the same hold', () => {
    const unit = vehicle();
    unit.dealerMail.activeRecordCount = 3;
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const mobileSpecs = document.querySelector('.vdp-focus-mobile-specs')!;
    expect(Array.from(mobileSpecs.querySelectorAll('p'), line => line.textContent)).toEqual([
      '123,328 mi · 2 days',
      '3.5L V6 EcoBoost · 4WD',
      'Black / Black Leather',
    ]);
    const operations = screen.getByRole('region', { name: 'Vehicle operational summary' });
    const hold = within(operations).getByText('Hold status').closest('.inventory-workspace-fact')!;
    expect(hold).toHaveTextContent('Held · Jamie Howell');
    expect(hold.querySelector('.vdp-focus-mobile-backup')).toHaveTextContent('2 backup holds');
    for (const label of ['Backup holds', 'Service status']) {
      expect(within(operations).getByText(label).closest('.inventory-workspace-fact')).toHaveClass('vdp-focus-desktop-field');
    }
    expect(screen.getByRole('link', { name: 'Service: Waiting for service' })).toBeVisible();
  });

  it('renders only the selected pane and resets scroll without moving the header or navigation', async () => {
    const user = userEvent.setup();
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={vi.fn()} />);
    const scroller = document.querySelector('.vdp-focus-scroll')!;
    for (const name of ['Equipment', 'Records', 'Holds & moves', 'Activity', 'Overview']) {
      scroller.scrollTop = 450;
      await user.click(screen.getByRole('tab', { name }));
      expect(scroller.scrollTop).toBe(0);
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
      expect(screen.getByRole('tabpanel', { name })).toBeVisible();
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name })).toHaveFocus();
      expect(screen.getByRole('heading', { name: '2017 Ford F-150 Lariat' })).toBeVisible();
    }
    scroller.scrollTop = 400;
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(scroller.scrollTop).toBe(0);
  });

  it('supports arrow, Home, and End keys across the single tablist', async () => {
    const user = userEvent.setup();
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Equipment' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveFocus();
    await user.keyboard('{Home}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveFocus();
  });

  it('resets a different vehicle and explicit entry point to the top of the correct pane', async () => {
    const user = userEvent.setup(); const first = vehicle();
    const { rerender } = render(<VehicleWorkspace vehicle={first} homeStore={first.location.homeStore} onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: 'Records' }));
    const scroll = document.querySelector('.vdp-focus-scroll')!;
    scroll.scrollTop = 500;
    const second = { ...first, id: 'second', vin: 'TESTDATASECOND001', stockNumber: 'DEMO-2' };
    rerender(<VehicleWorkspace vehicle={second} homeStore={second.location.homeStore} onClose={vi.fn()} />);
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toBeVisible();
    expect(scroll.scrollTop).toBe(0);
    scroll.scrollTop = 300;
    rerender(<VehicleWorkspace vehicle={second} initialTab="timeline" homeStore={second.location.homeStore} onClose={vi.fn()} />);
    expect(screen.getByRole('tabpanel', { name: 'Activity' })).toBeVisible();
    expect(scroll.scrollTop).toBe(0);
  });

  it.each([['movement', 'Holds & moves'], ['timeline', 'Activity'], ['data', 'Records']] as const)('opens %s directly with stable navigation focus', async (initialTab, label) => {
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} initialTab={initialTab} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('tab', { name: label })).toHaveFocus());
    expect(screen.getByRole('tabpanel', { name: label })).toBeVisible();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(document.querySelector('.vdp-focus-scroll')!.scrollTop).toBe(0);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-active-target', initialTab);
  });

  it('puts movement actions in the operational summary and enforces request eligibility', async () => {
    const user = userEvent.setup(); const unit = vehicle();
    const onRequestVehicle = vi.fn(); const onTrackMovement = vi.fn();
    const { rerender } = render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} canRequestVehicle onRequestVehicle={onRequestVehicle} onTrackMovement={onTrackMovement} onClose={vi.fn()} />);
    await user.click(within(screen.getByRole('region', { name: 'Vehicle operational summary' })).getByRole('button', { name: 'Request vehicle' }));
    expect(onRequestVehicle).toHaveBeenCalledExactlyOnceWith(unit);
    rerender(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} canRequestVehicle={false} onRequestVehicle={onRequestVehicle} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();
    const moving = { ...unit, movement: { state: 'requested', requestId: 'test-move-1' } };
    rerender(<VehicleWorkspace vehicle={moving} homeStore={unit.location.homeStore} canRequestVehicle onRequestVehicle={onRequestVehicle} onTrackMovement={onTrackMovement} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Track movement' }));
    expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(moving);
  });

  it('shows a manager direct-move label and preserves the selected intent', async () => {
    const user = userEvent.setup();
    const unit = vehicle();
    const onMoveVehicle = vi.fn();
    render(
      <VehicleWorkspace
        vehicle={unit}
        homeStore={unit.location.homeStore}
        moveAction={{ intent: 'direct', label: 'Move to another store', shortLabel: 'Move' }}
        onMoveVehicle={onMoveVehicle}
        onClose={vi.fn()}
      />,
    );
    await user.click(within(screen.getByRole('region', { name: 'Vehicle operational summary' })).getByRole('button', { name: 'Move to another store' }));
    expect(onMoveVehicle).toHaveBeenCalledExactlyOnceWith(unit, 'direct');
  });

  it('preserves Track beside Move again for an authorized active direct move', async () => {
    const user = userEvent.setup();
    const unit = { ...vehicle(), movement: { state: 'arrived', requestId: 'direct-move-1', canDirectReroute: true } };
    const onMoveVehicle = vi.fn();
    const onTrackMovement = vi.fn();
    render(
      <VehicleWorkspace
        vehicle={unit}
        homeStore={unit.location.homeStore}
        moveAction={{ intent: 'direct', label: 'Move again', shortLabel: 'Move again' }}
        onMoveVehicle={onMoveVehicle}
        onTrackMovement={onTrackMovement}
        onClose={vi.fn()}
      />,
    );
    const operations = screen.getByRole('region', { name: 'Vehicle operational summary' });
    await user.click(within(operations).getByRole('button', { name: 'Track movement' }));
    await user.click(within(operations).getByRole('button', { name: 'Move again' }));
    expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(unit);
    expect(onMoveVehicle).toHaveBeenCalledExactlyOnceWith(unit, 'direct');
  });

  it('never renders customer evidence for a restricted role even inside the selected hold pane', () => {
    const unit = vehicle();
    unit.dealerMail = { ...unit.dealerMail, canViewEvidence: false, canManageHold: false };
    unit.holdEvidence![0].customerOrReason = 'PRIVATE CUSTOMER REASON';
    unit.holdEvidence![0].salesperson = 'PRIVATE SALES PERSON';
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} initialTab="hold" onClose={vi.fn()} />);
    expect(screen.queryByText('PRIVATE CUSTOMER REASON')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE SALES PERSON')).not.toBeInTheDocument();
    expect(screen.queryByText('STATUS: S')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hold details are restricted' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'DealerMail tools' })).not.toBeInTheDocument();
  });

  it('renders service confirmation links with an exact VIN and keeps missing status waiting', () => {
    const unit = vehicle();
    unit.serviceReadiness = { vin: unit.vin, status: 'needs_service' } as NonNullable<InventoryVehicle['serviceReadiness']>;
    const { rerender } = render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Start service' })).toHaveAttribute('href', '/service?vin=TESTDATASYN000002&action=in_service');
    expect(screen.getByRole('link', { name: 'Mark Ready' })).toHaveAttribute('href', '/service?vin=TESTDATASYN000002&action=serviced');
    rerender(<VehicleWorkspace vehicle={{ ...unit, serviceReadiness: undefined }} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Mark Ready' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Service: Waiting for service' })).toBeVisible();
  });

  it('keeps every captured equipment item with provenance and a simple show-all button', async () => {
    const user = userEvent.setup(); const unit = vehicle();
    unit.features = ['Blind Spot Information System', 'Lane Keeping Assist', 'Automatic Emergency Braking', 'Rear Cross Traffic Alert', 'Surround View Camera', 'Driver Alert System', 'Traffic Sign Recognition'];
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} initialTab="equipment" onClose={vi.fn()} />);
    const equipment = screen.getByRole('tabpanel', { name: 'Equipment' });
    const last = within(equipment).getByText('Traffic Sign Recognition').closest('li')!;
    expect(last).not.toBeVisible();
    await user.click(within(equipment).getByRole('button', { name: 'Show all 7 items' }));
    expect(last).toBeVisible();
    expect(last).toHaveAttribute('title', 'Source: Published vehicle listing');
    expect(within(equipment).queryAllByRole('button', { name: /copy/i })).toHaveLength(0);
    expect(equipment).not.toHaveTextContent('Equipment Group 502A');
  });

  it('groups available configuration details in one clear vehicle section', async () => {
    const user = userEvent.setup(); const unit = vehicle();
    unit.factoryEquipment = { dataState: 'current', isOriginalWindowSticker: false, vehicleDescription: '2017 Ford F-150 Lariat SuperCrew 4x4', packages: [{ name: 'Safety Package', code: 'PQB' }] };
    const { rerender } = render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} initialTab="equipment" onClose={vi.fn()} />);
    await user.click(screen.getByText('Vehicle configuration', { selector: 'summary span' }));
    expect(screen.getByRole('heading', { name: 'Vehicle configuration' })).toBeVisible();
    rerender(<VehicleWorkspace vehicle={{ ...unit, windowSticker: { dataState: 'current', equipmentGroup: 'Equipment Group 502A' } }} homeStore={unit.location.homeStore} initialTab="equipment" onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Vehicle configuration' })).toBeVisible();
  });

  it('shows unheld alerts without fabricating a primary hold', () => {
    const unit = vehicle(); unit.holdEvidence = [];
    unit.dealerMail = { ...unit.dealerMail, hasActiveHold: false, activeRecordCount: 0, position: null };
    unit.dealerMailEvidence = { dataState: 'current', comments: [], alerts: [{ text: 'Synthetic vehicle alert', author: 'Manager' }], history: [] };
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} initialTab="hold" onClose={vi.fn()} />);
    expect(screen.getByText('Synthetic vehicle alert')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'No active hold' })).toBeVisible();
    expect(screen.queryByText('Primary hold', { exact: true })).not.toBeInTheDocument();
  });

  it('keeps captured hold comments visible inside Holds & moves without a submenu', () => {
    const unit = vehicle(); unit.holdEvidence![0].comments = [{ text: 'Synthetic appointment note' }];
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} initialTab="hold" onClose={vi.fn()} />);
    expect(screen.getByText('Synthetic appointment note')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Saved comments' })).not.toBeInTheDocument();
  });

  it('provides an honest missing-photo fallback and keyboard-controlled real gallery', () => {
    const unit = vehicle();
    const { rerender } = render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    expect(screen.getByText('Photos are not available')).toBeVisible();
    rerender(<VehicleWorkspace vehicle={{ ...unit, imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] }} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const gallery = screen.getByRole('region', { name: 'Photos of 2017 Ford F-150 Lariat' });
    fireEvent.keyDown(gallery, { key: 'ArrowRight' });
    expect(within(gallery).getByRole('img', { name: '2017 Ford F-150 Lariat, photo 2' })).toHaveAttribute('src', 'https://example.com/b.jpg');
  });

  it('never animates anchor jumps while selecting sections', async () => {
    const user = userEvent.setup(); const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView; HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={vi.fn()} />);
      await user.click(screen.getByRole('tab', { name: 'Equipment' }));
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(document.querySelector('.vdp-focus-scroll')!.scrollTop).toBe(0);
    } finally { HTMLElement.prototype.scrollIntoView = original; }
  });

  it('opens the in-app handoff and focuses its action without opening or editing CRM records', async () => {
    const user = userEvent.setup(); const openSpy = vi.spyOn(window, 'open');
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'DealerMail tools' }));
    expect(screen.getByRole('tabpanel', { name: 'Holds & moves' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open DealerMail & copy stock' })).toHaveFocus());
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('gives manual stock guidance when clipboard copying is blocked', async () => {
    const user = userEvent.setup();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ opener: window } as unknown as Window);

    try {
      render(
        <VehicleWorkspace
          vehicle={vehicle()}
          homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
          initialTab="hold"
          onClose={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Open DealerMail & copy stock' }));
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('dealermail.com'),
        '_blank',
        'noopener,noreferrer',
      );
      expect(await screen.findByText(/Stock could not be copied/i)).toHaveTextContent(/Select stock W5863Q above and copy it manually/i);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('never applies a delayed clipboard result to a different vehicle', async () => {
    const user = userEvent.setup();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let finishCopy: (() => void) | undefined;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
          finishCopy = resolve;
        })),
      },
    });
    vi.spyOn(window, 'open').mockReturnValue({ opener: window } as unknown as Window);

    try {
      const first = vehicle();
      const second = vehicle();
      second.id = 'TESTDATASYN000003';
      second.vin = 'TESTDATASYN000003';
      second.stockNumber = 'W5864Q';
      const { rerender } = render(
        <VehicleWorkspace
          vehicle={first}
          homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
          initialTab="hold"
          onClose={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Open DealerMail & copy stock' }));
      rerender(
        <VehicleWorkspace
          vehicle={second}
          homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
          initialTab="hold"
          onClose={vi.fn()}
        />,
      );
      finishCopy?.();
      await waitFor(() => expect(screen.queryByText(/Stock W5863Q copied/i)).not.toBeInTheDocument());
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
