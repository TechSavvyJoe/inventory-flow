import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleWorkspace } from './VehicleWorkspace';
import type { InventoryVehicle } from './types';
import { createMotionPreference } from '../../../tests/unit/motion-test-utils';

const dispositionApi = vi.hoisted(() => ({ getDisposition: vi.fn(), updateDisposition: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api')>()), ...dispositionApi }));

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
  it('expands every Overview document together and resets the shared control for another vehicle', async () => {
    const user = userEvent.setup();
    const unit = vehicle();
    unit.windowSticker = { dataState: 'current', equipmentGroupContents: ['Synthetic included camera'], options: ['Synthetic optional package'] };
    unit.autoCheckReport = { dataState: 'current', score: 91, checks: [{ label: 'Service / Repair', status: 'Records available', detail: '5 service records reported' }] };
    unit.fordOasis = { dataState: 'current', buildDate: '20-JUN-2024', openFieldServiceActions: [], extendedCoverageExpirations: [], warrantyCoverages: [{ type: 'Powertrain', description: 'Synthetic coverage detail' }] };
    const onClose = vi.fn();
    const page = render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus());
    const documents = screen.getByRole('region', { name: 'Documents and vehicle records' });
    const toggle = within(documents).getByRole('button', { name: 'Show details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(within(documents).getByRole('region', { name: 'AutoCheck' }));
    expect(within(documents).queryByRole('button', { name: /^Expand .* details$/ })).not.toBeInTheDocument();
    expect(within(documents).queryByText('Synthetic optional package')).not.toBeInTheDocument();
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAccessibleName('Hide details');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(documents).getByRole('list', { name: 'Included with equipment group' })).toHaveTextContent('Synthetic included camera');
    expect(within(documents).getByText('Synthetic optional package')).toBeVisible();
    expect(within(documents).getByText('5 service records reported')).toBeVisible();
    expect(within(documents).getByText('Powertrain · Synthetic coverage detail')).toBeVisible();
    page.rerender(<VehicleWorkspace vehicle={{ ...unit, price: 21988 }} homeStore={unit.location.homeStore} onClose={onClose} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAccessibleName('Show details');
    expect(within(documents).queryByText('Synthetic optional package')).not.toBeInTheDocument();
    expect(within(documents).queryByText('5 service records reported')).not.toBeInTheDocument();
    expect(within(documents).queryByText('Powertrain · Synthetic coverage detail')).not.toBeInTheDocument();
    await user.click(toggle);
    page.rerender(<VehicleWorkspace vehicle={{ ...unit, id: 'TESTDATAOTHER001', vin: 'TESTDATAOTHER001' }} homeStore={unit.location.homeStore} onClose={onClose} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(documents).queryByText('Synthetic optional package')).not.toBeInTheDocument();
    await user.click(within(documents).getByRole('button', { name: 'Full records' }));
    expect(screen.getByRole('tab', { name: 'Records' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps history beside specifications and spans equipment and reference facts beneath the gallery', () => {
    const unit = vehicle();
    unit.windowSticker = {dataState:'current',basePrice:42500,totalMsrp:50560,pricingCurrency:'USD'};
    unit.fordOasis = {dataState:'current',warrantyStartDate:'2024-08-14',openFieldServiceActions:[],warrantyCoverages:[],extendedCoverageExpirations:[]};
    unit.autoCheckReport = {dataState:'current',score:91,ownerCount:1,checks:[{label:'State title brand',status:'Clean'},{label:'Accident / damage',status:'No issue'}]};
    unit.warrantyCheck = {dataState:'current',mileageEntered:123328,autoCheck:null,fordOasis:{warrantyStartDate:'2024-08-14',monthsInService:25,coverages:[{type:'Powertrain',termText:'5 years / 60,000 miles',remainingTimeText:'35 months remaining',remainingMilesText:'21,500 miles remaining',status:'ACTIVE'}]}};
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()}/>);
    const overview = screen.getByRole('tabpanel',{name:'Overview'});
    const reference = within(overview).getByRole('region',{name:'Frequently used vehicle facts'});
    const specifications = within(overview).getByRole('region',{name:'Vehicle specifications'});
    const shortcuts = within(overview).getByRole('region',{name:'Document shortcuts'});
    const equipment = within(overview).getByRole('region',{name:'Key equipment'});
    const history = within(overview).getByRole('region',{name:'AutoCheck history'});
    expect(reference.parentElement).toHaveClass('vdp-focus-vehicle-context');
    expect(equipment.parentElement).toHaveClass('vdp-focus-vehicle-context');
    expect(history.parentElement).toHaveClass('vdp-focus-vehicle-intelligence');
    expect(specifications.compareDocumentPosition(equipment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(history.compareDocumentPosition(equipment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(equipment.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shortcuts.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(reference).getAllByRole('term').map(node=>node.textContent)).toEqual(['In-service','Coverage','Original MSRP','Base MSRP']);
    expect(within(reference).getByText('08/14/2024')).toBeVisible();
    expect(within(reference).getByText('$42,500')).toBeVisible();
    expect(within(reference).getByText('$50,560')).toBeVisible();
    expect(reference).toHaveTextContent('Powertrain · 35 months remaining · 21,500 miles remaining');
    expect(within(reference).getByText('Window sticker · Before options & destination')).toBeVisible();
    expect(within(reference).getByRole('button', {name:'Copy base MSRP: 42500'})).toBeVisible();
    expect(within(reference).queryByText('Public listing')).not.toBeInTheDocument();
    expect(within(reference).queryByText('08/29/2026')).not.toBeInTheDocument();
    expect(within(history).getAllByRole('term').map(node=>node.textContent)).toEqual(['Score','Owners','Title','Accidents']);
    expect(history).toHaveTextContent('91');
    expect(history).toHaveTextContent('1 reported');
    expect(history).toHaveTextContent('Clean');
    expect(history).toHaveTextContent('No issue');
    expect(reference).not.toHaveTextContent('USD');
    for (const label of ['In-service','Base MSRP']) {
      expect(within(overview).getAllByText(label,{selector:'dt'})).toHaveLength(1);
      expect(within(specifications).queryByText(label,{selector:'dt'})).not.toBeInTheDocument();
    }
  });

  it.each(['2024-08-14','14-AUG-2024','08/14/2024'])('formats the operational loaner service date numerically: %s', serviceDate => {
    const unit = vehicle();
    unit.dealerMail.loaner = {active:true,program:'FCTP',label:'Loaner FCTP',serviceDate};
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()}/>);
    const operations = screen.getByRole('region',{name:'Vehicle operational summary'});
    expect(within(operations).getByText('Loaner FCTP · 08/14/2024')).toBeVisible();
    expect(unit.dealerMail.loaner.serviceDate).toBe(serviceDate);
  });

  it('does not turn a literal fee or total MSRP into the base-MSRP lookup when base is missing', async () => {
    const unit = vehicle();
    unit.windowSticker = {dataState:'current',totalMsrp:50560,pricingCurrency:'USD',options:['WEIGHT FEE — $123.45']};
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const facts=screen.getByRole('region',{name:'Frequently used vehicle facts'});
    const lookup=within(facts).getByText('Original MSRP',{selector:'dt'}).parentElement!;
    expect(lookup).toHaveTextContent('$50,560');
    expect(lookup).toHaveTextContent('Window sticker');
    expect(within(facts).queryByText('Base MSRP',{selector:'dt'})).not.toBeInTheDocument();
    expect(lookup).not.toHaveTextContent('123.45');
    expect(within(facts).queryByText('Weight fee',{selector:'dt'})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab',{name:'Records'}));
    expect(document.querySelector('.vdp-records-summary')).toHaveTextContent('Base MSRP—');
    expect(screen.getByRole('list',{name:'Factory options'})).toHaveTextContent('WEIGHT FEE — $123.45');
  });

  it('retains an original sticker base with unknown currency without borrowing another source currency', () => {
    const unit=vehicle();
    unit.windowSticker={dataState:'current',basePrice:42500.5};
    unit.factoryEquipment={dataState:'current',isOriginalWindowSticker:false,basePrice:39999};
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const facts=screen.getByRole('region',{name:'Frequently used vehicle facts'});
    const lookup=within(facts).getByText('Base MSRP',{selector:'dt'}).parentElement!;
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
    const lookup = within(facts).getByText('vAuto base MSRP', {selector:'dt'}).parentElement!;
    expect(facts).toHaveTextContent('vAuto base MSRP31,234.5');
    expect(facts).not.toHaveTextContent('vAuto reference · confirm on sticker');
    expect(within(facts).queryByText('Weight fee', {selector:'dt'})).not.toBeInTheDocument();
    expect(facts).not.toHaveTextContent('123.45');
    expect(lookup).not.toHaveTextContent(/CAD|USD|\$/);
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
    expect(facts).toHaveTextContent('Base MSRPCAD 45,000');
    expect(facts).not.toHaveTextContent('31,234');
    expect(within(facts).getAllByText('Base MSRP')).toHaveLength(1);
    expect(facts).toHaveTextContent('Est. in-service05/12/2023AutoCheck');
    await userEvent.click(screen.getByRole('tab', { name: 'Records' }));
    expect(document.querySelector('.vdp-records-summary')).toHaveTextContent('In-service · AutoCheck estimate05/12/2023');
    expect(document.querySelector('.vdp-records-summary')).toHaveTextContent('Base MSRPCAD 45,000');
  });

  it('prefers captured OASIS in-service date over AutoCheck estimates', () => {
    const unit = vehicle();
    unit.fordOasis = { dataState: 'current', warrantyStartDate: '2023-05-13', openFieldServiceActions: [], warrantyCoverages: [], extendedCoverageExpirations: [] };
    unit.autoCheckReport = { dataState: 'current', estimatedInServiceDate: '2023-05-12' };
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const facts = screen.getByRole('region', { name: 'Frequently used vehicle facts' });
    expect(facts).toHaveTextContent('In-service05/13/2023OASIS');
    expect(facts).not.toHaveTextContent('estimate');
  });

  it('is a labelled modal dialog that closes with Escape', () => {
    const onClose = vi.fn();
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('id', 'inventory-vehicle-workspace');
    expect(dialog).toHaveAttribute('aria-label', '2017 Ford F-150 Lariat vehicle workspace');
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes once from the close control while the system prefers reduced motion', () => {
    const preference = createMotionPreference();
    preference.install();
    try {
      preference.set(true);
      const onClose = vi.fn();
      render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: 'Close vehicle details' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      preference.restore();
    }
  });

  it('keeps one vehicle identity, responsive copy controls and persistent close controls', () => {
    render(<main><VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={vi.fn()} /></main>);
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: '2017 Ford F-150 Lariat' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Copy stock number: W5863Q' })).toBeVisible();
    const desktopIdentifiers = document.querySelector('.vdp-focus-identifiers') as HTMLElement;
    const mobileVin = document.querySelector('.vdp-focus-mobile-vin') as HTMLElement;
    expect(within(desktopIdentifiers).getByRole('button', { name: 'Copy VIN: TESTDATASYN000002' })).toBeInTheDocument();
    expect(within(mobileVin).getByRole('button', { name: 'Copy VIN: TESTDATASYN000002' })).toBeInTheDocument();
    expect(document.querySelector('.vdp-focus-mobile-stock')).toHaveTextContent('Stock W5863Q');
    expect(screen.getByRole('button', { name: 'Back to inventory' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close vehicle details' })).toBeVisible();
    const quickStatus = screen.getByRole('group', { name: 'Quick vehicle status' });
    expect(quickStatus).toHaveTextContent('Fowlerville');
    expect(quickStatus).toHaveTextContent('On hold');
    expect(within(quickStatus).getByRole('link', { name: 'Service: Waiting for service' })).toBeVisible();
    expect(quickStatus).not.toHaveTextContent('123,328 mi');
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
    expect(operations).toHaveTextContent('Hold statusHeld');
    expect(operations).toHaveTextContent('Jamie Howell');
    // The detailed hold owner stays labeled below the decisive workflow strip;
    // 'Held by' is reserved for DealerMail's evidence.heldBy.
    const operationalDetails = screen.getByRole('region', { name: 'Operational details' });
    expect(within(operationalDetails).getByText('Salesperson').closest('.inventory-workspace-fact')).toHaveTextContent('Jamie Howell');
    expect(within(operations).queryByText('Held by')).not.toBeInTheDocument();
    expect(operations).not.toHaveTextContent(/sold|delivered|CDK/);
  });

  it('provides compact mobile specs and nests backup context under the same hold', () => {
    const unit = vehicle();
    unit.dealerMail.activeRecordCount = 3;
    unit.mpgHighway = 24;
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    const mobileSpecs = document.querySelector('.vdp-focus-mobile-specs')!;
    expect(Array.from(mobileSpecs.querySelectorAll('p'), line => line.textContent)).toEqual([
      '123,328 mi · 2 days',
      '3.5L V6 EcoBoost · 4WD',
      '10-Speed Automatic · Gasoline',
      '24 hwy MPG',
      'Black / Black Leather',
    ]);
    const specs = screen.getByRole('region', { name: 'Vehicle specifications' });
    expect(within(specs).getByText('Fuel economy', { selector: 'dt' }).closest('.inventory-workspace-fact')).toHaveTextContent('24 hwy MPG');
    const operations = screen.getByRole('region', { name: 'Vehicle operational summary' });
    const hold = within(operations).getByText('Hold status', { selector: 'dt' }).closest('.inventory-workspace-fact')!;
    expect(hold).toHaveTextContent('Held');
    expect(hold.querySelector('.vdp-focus-hold-context')).toHaveTextContent('Jamie Howell · 2 backup holds');
    const operationalDetails = screen.getByRole('region', { name: 'Operational details' });
    expect(within(operationalDetails).getByText('Salesperson').closest('.inventory-workspace-fact')).toHaveTextContent('Jamie Howell');
    expect(within(operationalDetails).getByText('Backup holds').closest('.inventory-workspace-fact')).toHaveTextContent('2');
    expect(document.querySelector('.vdp-focus-service-fact')).toHaveTextContent('ServiceWaiting for service');
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
    expect(screen.queryByRole('region', { name: 'DealerMail vehicle tools' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open in DealerMail (copies stock)' })).not.toBeInTheDocument();
  });

  it('renders service confirmation links with an exact VIN and keeps missing status waiting', () => {
    const unit = vehicle();
    unit.serviceReadiness = { vin: unit.vin, status: 'needs_service' } as NonNullable<InventoryVehicle['serviceReadiness']>;
    const { rerender } = render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Start service' })).toHaveAttribute('href', '/service?vin=TESTDATASYN000002&action=in_service');
    expect(screen.getByRole('link', { name: 'Mark Ready' })).toHaveAttribute('href', '/service?vin=TESTDATASYN000002&action=serviced');
    rerender(<VehicleWorkspace vehicle={{ ...unit, serviceReadiness: undefined }} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Mark Ready' })).toBeVisible();
    expect(document.querySelector('.vdp-focus-service-fact')).toHaveTextContent('ServiceWaiting for service');
  });

  it('keeps every equipment item reachable without repeated source labels or tooltips', async () => {
    const user = userEvent.setup(); const unit = vehicle();
    unit.features = ['Blind Spot Information System', 'Lane Keeping Assist', 'Automatic Emergency Braking', 'Rear Cross Traffic Alert', 'Surround View Camera', 'Driver Alert System', 'Traffic Sign Recognition'];
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} initialTab="equipment" onClose={vi.fn()} />);
    const equipment = screen.getByRole('tabpanel', { name: 'Equipment' });
    const last = within(equipment).getByText('Traffic Sign Recognition').closest('li')!;
    expect(last).not.toBeVisible();
    await user.click(within(equipment).getByRole('button', { name: 'Show all 7 items' }));
    expect(last).toBeVisible();
    expect(last).not.toHaveAttribute('title');
    expect(equipment.querySelector('.inventory-workspace-equipment-item-source')).toBeNull();
    expect(within(equipment).queryAllByRole('button', { name: /copy/i })).toHaveLength(0);
    expect(equipment).not.toHaveTextContent('Equipment Group 502A');
  });

  it('keeps captured group contents in highlights, the finder and separate full records', async () => {
    const user=userEvent.setup();const unit=vehicle();
    unit.windowSticker={dataState:'current',pricingCurrency:'USD',equipmentGroup:'Equipment Group 302A',equipmentGroupPrice:4770,equipmentGroupContents:['Heated seats','Remote start'],options:['Bed Utility Package (68L) USD 635.00']};
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()}/>);
    expect(within(screen.getByRole('region',{name:'Key equipment'})).getByText('Heated seats')).toBeVisible();
    await user.click(screen.getByRole('tab',{name:'Equipment'}));
    const finder=screen.getByRole('region',{name:'Equipment & packages'});
    expect(within(finder).getByText('Heated seats')).toBeVisible();
    expect(within(finder).getByText('Remote start')).toBeVisible();
    expect(within(finder).getByText('$4,770')).toBeVisible();
    await user.click(screen.getByRole('tab',{name:'Records'}));
    const included=screen.getByRole('list',{name:'Equipment group contents'});
    expect(included).toHaveTextContent('Heated seatsRemote start');
    expect(included).not.toHaveTextContent('Bed Utility');
    expect(screen.getByRole('list',{name:'Factory options'})).toHaveTextContent('Bed Utility Package (68L) $635.00');
    expect(screen.getByText('Equipment group price',{selector:'dt'}).parentElement).toHaveTextContent('$4,770');
  });

  it('puts equipment search first and keeps complete specifications in a collapsed disclosure', async () => {
    const user = userEvent.setup();
    const unit = vehicle();
    unit.modelCode = 'DEMO-CODE';
    unit.mpgCity = 18;
    unit.mpgHighway = 24;
    unit.features = ['Heated seats'];
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} initialTab="equipment" onClose={vi.fn()}/>);
    const equipment = screen.getByRole('tabpanel',{name:'Equipment'});
    const specifications = within(equipment).getByRole('group',{name:'Complete vehicle specifications'});
    const finder = within(equipment).getByRole('region',{name:'Equipment & packages'});
    expect(finder.compareDocumentPosition(specifications) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(specifications).not.toHaveAttribute('open');
    const disclosure = within(specifications).getByText('Specifications');
    await user.click(disclosure);
    expect(specifications).toHaveAttribute('open');
    for (const [label, value] of [
      ['Mileage', '123,328 mi'], ['Age', '2 days'], ['Engine', '3.5L V6 EcoBoost'],
      ['Drive', '4WD'], ['Transmission', '10-Speed Automatic'], ['Body', 'SuperCrew 4x4'],
      ['Trim', 'Lariat'], ['Exterior', 'Black'], ['Interior', 'Black Leather'],
      ['Fuel', 'Gasoline'],
      ['Model code', 'DEMO-CODE'], ['MPG city / hwy', '18 / 24'],
    ]) {
      const fact = within(specifications).getByText(label, {selector:'dt'}).closest('div')!;
      expect(within(fact).getByText(value, {selector:'dd'})).toBeVisible();
    }
    expect(within(equipment).getByRole('region',{name:'Equipment & packages'})).toHaveTextContent('Heated seats');
  });

  it('searches raw equipment codes, filters categories, and resets to every category without losing source variants', async () => {
    const user = userEvent.setup(); const unit = vehicle();
    unit.features = ['Max Trailer Tow Package', 'Heated seats', 'Heated seats (trial)', 'Wireless charging'];
    unit.windowSticker = {dataState:'current',options:['Max Trailer Tow Package (DEMO-1) USD 1,100.50', 'BlueCruise 90-day trial', '.TAILGATE STEP']};
    unit.factoryEquipment = {dataState:'current',isOriginalWindowSticker:false,packages:[{name:'Max Trailer Tow Package',code:'DEMO-2',price:1250.75}]};
    const original = JSON.stringify(unit);
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} initialTab="equipment" onClose={vi.fn()}/>);
    const finder = screen.getByRole('region',{name:'Equipment & packages'});
    const categories = within(finder).getByRole('navigation',{name:'Equipment categories'});
    const allEquipment = within(categories).getByRole('button',{name:'All equipment, 7 items'});
    const comfort = within(categories).getByRole('button',{name:'Comfort, 2 items'});
    expect(within(categories).getByRole('button',{name:'Safety & assist, 1 item'})).toBeVisible();
    expect(allEquipment).toHaveAttribute('aria-pressed','true');
    expect(comfort).toHaveAttribute('aria-pressed','false');
    expect(within(finder).getAllByText('Max Trailer Tow Package')).toHaveLength(2);
    expect(within(finder).getByText('Heated seats')).toBeVisible();
    expect(within(finder).getByText('Heated seats (trial)')).toBeVisible();
    expect(within(finder).getByText('TAILGATE STEP')).toBeVisible();
    expect(within(finder).getByText('$1,100.50')).toBeVisible();
    const search = within(finder).getByRole('searchbox',{name:'Search equipment, packages, or codes'});
    await user.type(search,'tOW DEMO-1');
    expect(within(finder).getAllByText('Max Trailer Tow Package')).toHaveLength(1);
    expect(within(finder).queryByText('Heated seats')).not.toBeInTheDocument();
    await user.click(within(finder).getByRole('button',{name:'Clear'}));
    expect(search).toHaveValue('');
    expect(allEquipment).toHaveAttribute('aria-pressed','true');
    await user.click(comfort);
    expect(comfort).toHaveAttribute('aria-pressed','true');
    expect(allEquipment).toHaveAttribute('aria-pressed','false');
    expect(within(finder).getByText('Heated seats')).toBeVisible();
    expect(within(finder).getByText('Heated seats (trial)')).toBeVisible();
    expect(within(finder).queryByText('Max Trailer Tow Package')).not.toBeInTheDocument();
    await user.type(search,'absent feature');
    expect(within(finder).getByText('No matching equipment')).toBeVisible();
    expect(comfort).toHaveAttribute('aria-pressed','true');
    await user.click(within(finder).getByRole('button',{name:'Show all equipment'}));
    expect(search).toHaveValue('');
    expect(allEquipment).toHaveAttribute('aria-pressed','true');
    expect(comfort).toHaveAttribute('aria-pressed','false');
    for(const category of ['Packages','Safety & assist','Comfort','Technology','Towing & utility']) expect(within(finder).getByRole('heading',{name:category})).toBeVisible();
    expect(JSON.stringify(unit)).toBe(original);
    await user.click(screen.getByRole('tab',{name:'Records'}));
    expect(screen.getByRole('list',{name:'Factory options'})).toHaveTextContent('Max Trailer Tow Package (DEMO-1) $1,100.50');
    expect(screen.getByRole('list',{name:'Factory options'})).toHaveTextContent('.TAILGATE STEP');
  });

  it('says a vehicle the server marks unlisted is not publicly listed, never listed online', () => {
    const unit = vehicle(); unit.holdEvidence = [];
    unit.dealerMail = { ...unit.dealerMail, hasActiveHold: false, activeRecordCount: 0, position: null };
    const { unmount } = render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    expect(screen.getAllByText(/Not publicly listed/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Listed online/)).not.toBeInTheDocument();
    unmount();
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} initialTab="hold" onClose={vi.fn()} />);
    expect(screen.getAllByText('Not publicly listed').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Listed online/)).not.toBeInTheDocument();
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

  it('opens Hold status on the hold evidence, with DealerMail as a secondary handoff after it', async () => {
    const user = userEvent.setup(); const openSpy = vi.spyOn(window, 'open');
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Hold status' }));
    const pane = screen.getByRole('tabpanel', { name: 'Holds & moves' });
    expect(pane).toBeVisible();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Holds & moves' })).toHaveFocus());
    const evidence = within(pane).getByText('Customer appointment');
    const handoff = within(pane).getByRole('button', { name: 'Open in DealerMail (copies stock)' });
    expect(evidence.compareDocumentPosition(handoff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The duplicated position chip and Comments/Alerts chips are gone.
    expect(within(pane).queryByText('No comments')).not.toBeInTheDocument();
    expect(within(pane).queryByText('No alerts')).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('puts the compact workflow strip before the gallery intelligence, shortcuts, operational details, records, and customer tools', () => {
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} onClose={vi.fn()} />);
    const operations = screen.getByRole('region', { name: 'Vehicle operational summary' });
    const specs = screen.getByRole('region', { name: 'Vehicle specifications' });
    const shortcuts = screen.getByRole('region', { name: 'Document shortcuts' });
    const equipment = screen.getByRole('region', { name: 'Key equipment' });
    const operationalDetails = screen.getByRole('region', { name: 'Operational details' });
    const records = screen.getByRole('region', { name: 'Documents and vehicle records' });
    const customer = screen.getByText('Customer summary').closest('details')!;
    expect(operations.compareDocumentPosition(specs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(operations.compareDocumentPosition(shortcuts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(specs.compareDocumentPosition(equipment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shortcuts.compareDocumentPosition(operationalDetails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(equipment.compareDocumentPosition(operationalDetails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(operationalDetails.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(records.compareDocumentPosition(customer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(operations).getByRole('link', { name: /^Waiting for service\. Open service status for VIN TESTDATASYN000002$/ }))
      .toHaveAttribute('href', '/service?vin=TESTDATASYN000002');
  });

  it('shows another store\'s overdue move neutrally with who it waits on, and the viewer\'s own overdue step as urgent', async () => {
    const user = userEvent.setup();
    const unit = vehicle();
    unit.movement = {
      requestId: 'synthetic-move-1', state: 'at_requesting_store', requestStatus: 'customer_showing',
      nextAction: 'Show the vehicle, then start its return', nextActionOwner: 'Fowlerville sales', nextActionStore: 'Fowlerville',
      dueAt: '2026-08-30T15:00:00Z', overdue: true,
    };
    const { unmount } = render(<VehicleWorkspace vehicle={unit} homeStore={{ id: 'howell', name: 'Howell' }} onClose={vi.fn()} />);
    const waiting = within(screen.getByRole('region', { name: 'Vehicle operational summary' })).getByText('Overdue · waiting on Fowlerville salesperson');
    expect(waiting).not.toHaveClass('vdp-focus-next-action__overdue');
    await user.click(screen.getByRole('tab', { name: 'Holds & moves' }));
    const movement = screen.getByRole('region', { name: 'Location & movement' });
    expect(within(movement).getByText('Overdue · waiting on Fowlerville salesperson').closest('.inventory-availability-note')).toBeNull();
    unmount();

    render(<VehicleWorkspace vehicle={unit} homeStore={{ id: 'fowlerville', name: 'Fowlerville' }} onClose={vi.fn()} />);
    const own = within(screen.getByRole('region', { name: 'Vehicle operational summary' })).getByText('Overdue');
    expect(own).toHaveClass('vdp-focus-next-action__overdue');
    expect(screen.queryByText(/waiting on/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Holds & moves' }));
    expect(within(screen.getByRole('region', { name: 'Location & movement' })).getByText('Overdue.').closest('.inventory-availability-note')).toHaveClass('inventory-availability-note--danger');
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
      await user.click(screen.getByRole('button', { name: 'Open in DealerMail (copies stock)' }));
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
      await user.click(screen.getByRole('button', { name: 'Open in DealerMail (copies stock)' }));
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

  it('shows disposition in the workflow strip, keeps its evidence in Operational details, and opens the one dialog to change it', async () => {
    const unit = {
      ...vehicle(),
      appDisposition: { vin: 'TESTDATASYN000002', code: 'sold_pending' as const, version: 1, effectiveDate: '2026-08-29', destinationStore: null, updatedAt: '2026-08-29T15:00:00Z', updatedByRole: 'manager' as const, store: 'Howell' as const, ownerStore: 'Howell' as const, canManage: true },
    };
    dispositionApi.getDisposition.mockResolvedValue({ ...unit.appDisposition, updatedBy: 'Synthetic Howell Manager', note: null, history: [] });
    dispositionApi.updateDisposition.mockResolvedValue({ ...unit.appDisposition, code: 'delivered', version: 2, effectiveDate: '2026-08-30', history: [] });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()}
      dispositionContext={{ role: 'manager', homeStore: 'Howell', reportDate: '2026-08-30', onChanged }} />);
    const operations = screen.getByRole('region', { name: 'Vehicle operational summary' });
    expect(operations).toHaveTextContent('Sold pending');
    expect(screen.getByRole('region', { name: 'Operational details' })).toHaveTextContent('recorded in Inventory Flow');
    fireEvent.click(within(operations).getByRole('button', { name: 'Change disposition' }));
    const dialog = await screen.findByRole('dialog', { name: /^Disposition · / });
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Delivered' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save disposition' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(dispositionApi.updateDisposition).toHaveBeenCalledWith('TESTDATASYN000002', { disposition: 'delivered', expectedVersion: 1, effectiveDate: '2026-08-30' }, 'manager', 'Howell');
    expect(await screen.findByText('Delivered recorded for #W5863Q.')).toBeInTheDocument();
  });

  it('says disposition storage is not enabled yet instead of offering the control', () => {
    const unit = { ...vehicle(), appDisposition: { vin: 'TESTDATASYN000002', code: null, version: 0, effectiveDate: null, destinationStore: null, updatedAt: null, updatedByRole: null, store: null, ownerStore: 'Howell' as const, canManage: false } };
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()}
      dispositionContext={{ role: 'group_manager', homeStore: 'Howell', enabled: false, onChanged: vi.fn() }} />);
    const operations = screen.getByRole('region', { name: 'Vehicle operational summary' });
    expect(operations).toHaveTextContent('Disposition storage is not enabled yet.');
    expect(within(operations).queryByRole('button', { name: /disposition/i })).not.toBeInTheDocument();
  });

  it('offers no disposition control without a viewer context or to a viewer who cannot record an empty one', () => {
    const unit = { ...vehicle(), appDisposition: { vin: 'TESTDATASYN000002', code: null, version: 0, effectiveDate: null, destinationStore: null, updatedAt: null, updatedByRole: null, store: null, ownerStore: 'Howell' as const, canManage: false } };
    render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()}
      dispositionContext={{ role: 'sales', homeStore: 'Howell', onChanged: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: /disposition/i })).not.toBeInTheDocument();
    cleanup();
    render(<VehicleWorkspace vehicle={{ ...unit, appDisposition: { ...unit.appDisposition, canManage: true } }} homeStore={unit.location.homeStore} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /disposition/i })).not.toBeInTheDocument();
  });
});
