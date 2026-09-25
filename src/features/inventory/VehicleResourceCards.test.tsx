import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InventoryVehicle } from './types';
import type { VehicleRecord } from '../../types';
import { VehicleResourceCards, type VehicleResourceVehicle } from './VehicleResourceCards';
import { vehicleResourceCatalog } from './vehicle-resource-catalog';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function sources(): VehicleResourceVehicle {
  return {
    vin: '1FTFW1E84RKF12345', make: 'Ford', year: 2024, model: 'F-150',
    publicListing: { listingUrl: 'https://www.bobmaxeyfordhowell.com/used-Synthetic-test' },
    autoCheckReport: { dataState: 'current', url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=synthetic&ac=synthetic', score: 91, ownerCount: 1, usage: 'Personal', checks: [{label:'Accident / damage', status:'No accidents reported'}] },
    windowSticker: { dataState: 'current', url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=synthetic&make=Ford&vehicleType=U', totalMsrp: 68420, pricingCurrency: 'CAD', equipmentGroup: 'Synthetic equipment group', options: ['Synthetic option'] },
    factoryEquipment: { dataState: 'current', isOriginalWindowSticker: false, url: 'https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg', packages: [{name:'Synthetic Tow Package'}], sections: [{name:'Synthetic equipment',items:[{label:'Heated front seats'},{label:'Heated front seats'},{label:'Synthetic camera'}]}] },
    fordOasis: { dataState: 'current', warrantyStartDate: '14-AUG-2024', buildDate: '20-JUN-2024', openFieldServiceActions: [{code:'DEMO-01'}], warrantyCoverages: [] },
  };
}

function expandDetails(kind: 'equipment' | 'history' | 'OASIS') {
  fireEvent.click(screen.getByRole('button', { name: `Expand ${kind} details` }));
}

describe('source-backed vehicle resource cards', () => {
  it('keeps desktop workspace reports compact until the user requests details', () => {
    const media = {matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()};
    vi.stubGlobal('matchMedia',vi.fn(() => media));
    const vehicle = sources();
    vehicle.windowSticker = {...vehicle.windowSticker!,equipmentGroupContents:['Included camera'],options:['Synthetic package USD 635.00','.Included tailgate','Late trial 90 days']};
    vehicle.autoCheckReport = {...vehicle.autoCheckReport!,checks:[{label:'Service / Repair',status:'Records available',detail:'5 service records reported'}]};
    vehicle.fordOasis = {...vehicle.fordOasis!,warrantyCoverages:[{type:'Powertrain',description:'5 years / 60,000 miles'}]};
    const original = JSON.stringify(vehicle);
    render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expect(screen.getAllByRole('button',{name:/^Expand .* details$/})).toHaveLength(3);
    expect(document.querySelectorAll('.vehicle-resource-summary__disclosure:not([hidden])')).toHaveLength(0);
    expect(screen.queryByText('Late trial 90 days')).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:/Open AutoCheck history/})).toHaveAttribute('href',vehicle.autoCheckReport.url);
    expandDetails('equipment');
    expect(document.querySelectorAll('.vehicle-resource-summary__disclosure:not([hidden])')).toHaveLength(1);
    expect(screen.getByRole('list',{name:'Included with equipment group'})).toHaveTextContent('Included camera');
    expect(screen.getByText('Late trial 90 days')).toBeVisible();
    expect(screen.queryByText('5 service records reported')).not.toBeInTheDocument();
    expect(screen.queryByText('Powertrain · 5 years / 60,000 miles')).not.toBeInTheDocument();
    expect(JSON.stringify(vehicle)).toBe(original);
  });

  it('keeps inventory report selectors together above one complete report, with stable focus and VIN reset', () => {
    const vehicle = sources();
    vehicle.windowSticker = {...vehicle.windowSticker!, equipmentGroupContents:['Included camera'], options:['Synthetic package USD 635.00','.Included tailgate','Late trial 90 days']};
    vehicle.autoCheckReport = {...vehicle.autoCheckReport!, dataState:'stale', checks:[{label:'Open Recall Check',status:'Recall found',detail:'1 unrepaired recall'}]};
    const original = JSON.stringify(vehicle);
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="preview"/>);
    const selectors = screen.getByRole('group',{name:'Choose a vehicle report'});
    expect(within(selectors).getAllByRole('button')).toHaveLength(4);
    expect(selectors).toHaveTextContent('OverviewStickerAutoCheckOASIS');
    expect(within(selectors).getByRole('button',{name:'Overview'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.getByText('1 included feature · 3 optional entries')).toBeVisible();
    expect(screen.getByText('Recall found · 1 unrepaired recall')).toBeVisible();
    expect(screen.getByRole('link',{name:/Open AutoCheck history/})).toBeVisible();
    expect(screen.getByRole('link',{name:/Open invoice/})).toBeVisible();
    const equipment = within(selectors).getByRole('button',{name:'Expand equipment details'});
    equipment.focus();
    fireEvent.click(equipment);
    expect(equipment).toHaveFocus();
    expect(screen.getByRole('list',{name:'Included with equipment group'})).toHaveTextContent('Included camera');
    expect(screen.getByText('Late trial 90 days')).toBeVisible();
    expect(screen.getAllByRole('region')).toHaveLength(2); // The source panel and its equipment-group section.
    const history = within(selectors).getByRole('button',{name:'Expand history details'});
    history.focus();
    fireEvent.click(history);
    expect(history).toHaveFocus();
    expect(equipment).toHaveAttribute('aria-expanded','false');
    expect(screen.queryByText('Late trial 90 days')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.vehicle-resource-summary__disclosure:not([hidden])')).toHaveLength(1);
    const historyPanel = document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement;
    expect(selectors.compareDocumentPosition(historyPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(historyPanel.parentElement).toHaveClass('vehicle-resource-summaries');
    expect(within(historyPanel).getByRole('link',{name:/Open AutoCheck history/})).toHaveAttribute('href',vehicle.autoCheckReport.url);
    expect(within(historyPanel).getByText('1 unrepaired recall')).toBeVisible();
    expect(within(historyPanel).getByText('Saved report · refresh at source')).toBeVisible();
    fireEvent.click(history);
    expect(history).toHaveFocus();
    expect(document.querySelectorAll('.vehicle-resource-summary__disclosure:not([hidden])')).toHaveLength(0);
    expect(within(selectors).getByRole('button',{name:'Overview'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getAllByRole('region')).toHaveLength(3);
    fireEvent.click(equipment);
    page.rerender(<VehicleResourceCards vehicle={{...vehicle,vin:'1FTFW1E84RKF54321'}} variant="preview"/>);
    expect(document.querySelectorAll('.vehicle-resource-summary__toggle[aria-expanded="true"]')).toHaveLength(0);
    expect(screen.queryByText('Late trial 90 days')).not.toBeInTheDocument();
    expect(JSON.stringify(vehicle)).toBe(original);
  });

  it('opens a directly selected report and lets the controlling inventory own selection and close', () => {
    const vehicle = sources();
    const onSelectResource = vi.fn();
    const onClose = vi.fn();
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="preview" selectedResourceId="autocheck" onSelectResource={onSelectResource} onClose={onClose}/>);
    expect(screen.getByRole('button',{name:'Collapse history details'})).toHaveAttribute('aria-expanded','true');
    expect(screen.getByText('91')).toBeVisible();
    expect(screen.getAllByRole('region')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:'Expand equipment details'}));
    expect(onSelectResource).toHaveBeenLastCalledWith('window-sticker');
    expect(screen.getByRole('button',{name:'Collapse history details'})).toHaveAttribute('aria-expanded','true');
    page.rerender(<VehicleResourceCards vehicle={vehicle} variant="preview" selectedResourceId="window-sticker" onSelectResource={onSelectResource} onClose={onClose}/>);
    expect(screen.getByText('Synthetic option')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Overview'}));
    expect(onSelectResource).toHaveBeenLastCalledWith(null);
    page.rerender(<VehicleResourceCards vehicle={vehicle} variant="preview" selectedResourceId={null} onSelectResource={onSelectResource} onClose={onClose}/>);
    expect(screen.getByText('CAD 68,420')).toBeVisible();
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.getByText('Synthetic option')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Close records'}));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers direct source actions with branded, basic scan facts without selecting the containing vehicle', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = {...vehicle.autoCheckReport!,checks:[{label:'Open Recall Check',status:'Recall found',detail:'1 unrepaired recall'},{label:'Insurance Loss / Transfer',status:'Loss reported'}]};
    const onSelectResource = vi.fn();
    const onRowClick = vi.fn();
    const onRowKey = vi.fn();
    const page = render(<div onClick={onRowClick} onKeyDown={onRowKey}><VehicleResourceCards vehicle={vehicle} variant="scan" selectedResourceId="autocheck" onSelectResource={onSelectResource}/></div>);
    const history = screen.getByRole('button',{name:'Show AutoCheck records'});
    expect(history).toHaveAttribute('aria-expanded','true');
    fireEvent.click(history);
    expect(history).toHaveFocus();
    expect(onSelectResource).toHaveBeenLastCalledWith('autocheck');
    fireEvent.keyDown(history,{key:'Enter'});
    expect(onRowKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Show sticker records'}));
    expect(onSelectResource).toHaveBeenLastCalledWith('window-sticker');
    fireEvent.click(screen.getByRole('button',{name:'Show OASIS records'}));
    expect(onSelectResource).toHaveBeenLastCalledWith('oasis');
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByText('Recalls')).toBeVisible();
    expect(screen.getByText('Recall found')).toBeVisible();
    expect(screen.getByText('1 unrepaired recall')).toBeVisible();
    expect(screen.queryByText('Loss reported')).not.toBeInTheDocument();
    expect(document.querySelector('[data-resource-kind="autocheck"] img')).toHaveAttribute('src','/resource-brands/autocheck.svg');
    expect(document.querySelector('[data-resource-kind="window-sticker"] img')).toHaveAttribute('src','/resource-brands/ford.svg');
    page.rerender(<VehicleResourceCards vehicle={{...vehicle,windowSticker:null}} variant="scan" onSelectResource={onSelectResource}/>);
    fireEvent.click(screen.getByRole('button',{name:'Show equipment records'}));
    expect(onSelectResource).toHaveBeenLastCalledWith('vauto');
    page.rerender(<VehicleResourceCards vehicle={{vin:vehicle.vin,make:'Ford'}} variant="scan" onSelectResource={onSelectResource}/>);
    expect(screen.queryByRole('button',{name:'Show OASIS records'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Open OASIS source in a new tab'})).toHaveAttribute('target','_blank');
    expect(screen.getByText('Action status unconfirmed')).toBeVisible();
  });

  it('fills the inventory overview with source-backed equipment, key checks, all exceptions, and OASIS facts', () => {
    const vehicle = sources();
    vehicle.windowSticker = {...vehicle.windowSticker!,pricingCurrency:'USD',equipmentGroupContents:Array.from({length:8},(_,i)=>`Included feature ${i + 1}`),options:[
      '.Orphan child USD 40.00', 'Tow package · DEMO-TOW · USD 1,000.50', '.Included brake controller USD 75.00', 'Axle upgrade NO CHARGE', 'Bed utility USD 200.00', 'Late office package USD 555.00', 'Connected trial 90 days',
    ]};
    vehicle.autoCheckReport = {...vehicle.autoCheckReport!,scoreRangeLow:80,scoreRangeHigh:96,lastReportedOdometer:23500,lastReportedOdometerDate:'2026-08-15',checks:[
      {label:'State Title Brand',status:'No issues'},
      {label:'Accident / Damage',status:'No accidents reported'},
      {label:'Open Recall Check',status:'Recall found',detail:'2 unrepaired recalls'},
      {label:'Insurance Loss / Transfer',status:'Loss reported'},
      {label:'Odometer Check',status:'No issues',detail:'Mileage discrepancy reported'},
      {label:'Service / Repair',status:'Records available',detail:'5 service records reported'},
      {label:'Additional history',status:'Events reported',detail:'Corrected title'},
    ]};
    vehicle.fordOasis = {...vehicle.fordOasis!,dataState:'incomplete',openActionsCaptured:false,releaseDate:'24-JUN-2024',monthsInService:25,saleMileage:12,openFieldServiceActions:[
      {code:'26X01',description:'Replace only if required after dealer evaluation'},
      {code:'26X02',description:'Software update'},
    ],warrantyCoverages:[{type:'Basic',description:'3 years / 36,000 miles'},{type:'Powertrain',description:'5 years / 60,000 miles'},{type:'Emissions',description:'8 years / 80,000 miles'}]};
    const original = JSON.stringify(vehicle);
    render(<VehicleResourceCards vehicle={vehicle} variant="preview"/>);
    const equipment = within(document.querySelector('[data-resource-kind="window-sticker"]') as HTMLElement);
    expect(equipment.getByText('$68,420')).toBeVisible();
    const features = equipment.getByRole('list',{name:'Included equipment highlights'});
    expect(within(features).getAllByRole('listitem')).toHaveLength(6);
    expect(equipment.queryByText('Included feature 7')).not.toBeInTheDocument();
    expect(equipment.getByText('2 more included features in the full report')).toBeVisible();
    const upgrades = equipment.getByRole('list',{name:'Equipment upgrade highlights'});
    expect(within(upgrades).getAllByRole('listitem')).toHaveLength(3);
    expect(within(upgrades).getByText('$1,000.50')).toBeVisible();
    expect(within(upgrades).queryByText('DEMO-TOW')).not.toBeInTheDocument();
    expect(within(upgrades).getByText('NO CHARGE')).toBeVisible();
    expect(within(upgrades).queryByText(/Orphan child|Included brake controller|Late office package/)).not.toBeInTheDocument();
    expect(equipment.getByText('4 more captured entries in the full report')).toBeVisible();
    const history = within(document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement);
    expect(history.getByText('80–96 typical range')).toBeVisible();
    expect(history.getByText('1 owner')).toBeVisible();
    expect(history.getByText('Personal')).toBeVisible();
    expect(history.getByText('23,500 mi')).toBeVisible();
    expect(history.getByText('08/15/2026')).toBeVisible();
    for (const finding of ['Recall found · 2 unrepaired recalls','Loss reported','Mileage discrepancy reported','5 service records reported']) expect(history.getByText(finding)).toBeVisible();
    expect(history.queryByText('Corrected title')).not.toBeInTheDocument();
    const oasis = within(document.querySelector('[data-resource-kind="oasis"]') as HTMLElement);
    expect(oasis.getByText('At least 2 captured service actions · result incomplete')).toBeVisible();
    expect(oasis.getByText('26X01 · Replace only if required after dealer evaluation')).toBeVisible();
    for (const fact of ['08/14/2024','06/20/2024','06/24/2024','25 months','12 mi','Emissions · 8 years / 80,000 miles']) expect(oasis.getByText(fact)).toBeVisible();
    expect(oasis.getByText('Partial captured record')).toBeVisible();
    expect(JSON.stringify(vehicle)).toBe(original);
    expandDetails('equipment');
    expect(screen.getByText('Included feature 8')).toBeVisible();
    expect(screen.getByText('Orphan child')).toBeVisible();
    expect(screen.getByText('Late office package')).toBeVisible();
    expect(screen.getByText('DEMO-TOW')).toBeVisible();
  });

  it('does not infer equipment, prices, clear checks, or zero actions in a sparse records overview', () => {
    const vehicle = {...sources(),windowSticker:{totalMsrp:68420,pricingCurrency:'USD'},factoryEquipment:null,autoCheckReport:{score:91,dataState:'incomplete'},fordOasis:{dataState:'incomplete',buildDate:'20-JUN-2024'}};
    render(<VehicleResourceCards vehicle={vehicle} variant="preview"/>);
    expect(screen.getByText('Equipment details not captured')).toBeVisible();
    expect(screen.queryByRole('list',{name:'Included equipment highlights'})).not.toBeInTheDocument();
    expect(screen.queryByRole('list',{name:'Equipment upgrade highlights'})).not.toBeInTheDocument();
    expect(screen.getByText('History checks not captured')).toBeVisible();
    expect(screen.queryByText(/No accidents|No issues|No open service actions|active coverage/i)).not.toBeInTheDocument();
    expect(screen.getByText('Action status unconfirmed')).toBeVisible();
    expect(screen.queryByText('In-service date')).not.toBeInTheDocument();
    expect(screen.queryByText('Mileage at sale')).not.toBeInTheDocument();
    expect(screen.getByText('06/20/2024')).toBeVisible();
  });

  it('keeps the vehicle scan to one useful history signal and leaves low-value events in Records', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = {...vehicle.autoCheckReport!, dataState:'stale', checks:[
      {label:'Additional history',status:'Events reported',detail:'Corrected title'},
      {label:'Open Recall Check',status:'Recall found',detail:'1 unrepaired recall'},
      {label:'Insurance Loss / Transfer',status:'Loss reported'},
      {label:'Odometer Check',status:'No issues',detail:'Mileage discrepancy reported'},
      {label:'Service / Repair',status:'Records available',detail:'5 service records reported'},
      {label:'Certified Pre-Owned',status:'No CPO info available'},
    ]};
    render(<VehicleResourceCards vehicle={vehicle} variant="scan"/>);
    expect(screen.queryByText('Corrected title')).not.toBeInTheDocument();
    expect(screen.getByText('Mileage discrepancy reported')).toBeVisible();
    expect(screen.queryByText('Loss reported')).not.toBeInTheDocument();
    expect(screen.queryByText('Open Recall Check: Recall found · 1 unrepaired recall')).not.toBeInTheDocument();
    expect(screen.getByText('Saved report · refresh at source')).toBeVisible();
    expect(screen.queryByText('5 service records reported')).not.toBeInTheDocument();
    expect(screen.queryByText('No CPO info available')).not.toBeInTheDocument();
  });

  it('starts compact, opens one complete resource at a time, retains control focus, and resets for another VIN', () => {
    const vehicle = sources();
    vehicle.windowSticker = {...vehicle.windowSticker!, equipmentGroupContents:['Included camera'], options:['Synthetic package USD 635.00','.Included tailgate','Late trial 90 days']};
    vehicle.autoCheckReport = {...vehicle.autoCheckReport!, checks:[{label:'Title',status:'No issues'},{label:'Accident / damage',status:'No accidents reported'},{label:'Additional history',status:'Events reported',detail:'Corrected title'},{label:'Auction',status:'No issues'}]};
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expect(screen.queryByRole('list', {name:'Included with equipment group'})).not.toBeInTheDocument();
    expect(screen.queryByText('Late trial 90 days')).not.toBeInTheDocument();
    expect(screen.getByText('1 included feature · 3 optional entries')).toBeVisible();
    expect(screen.queryByText('Corrected title')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Auction')).not.toBeInTheDocument();
    const equipmentToggle = screen.getByRole('button', {name:'Expand equipment details'});
    equipmentToggle.focus();
    fireEvent.click(equipmentToggle);
    expect(equipmentToggle).toHaveFocus();
    expect(equipmentToggle).toHaveAttribute('aria-expanded','true');
    expect(document.getElementById(equipmentToggle.getAttribute('aria-controls')!)).toBeVisible();
    expect(screen.getByRole('list', {name:'Included with equipment group'})).toHaveTextContent('Included camera');
    expect(screen.getByText('Late trial 90 days')).toBeVisible();
    const historyToggle = screen.getByRole('button', {name:'Expand history details'});
    historyToggle.focus();
    fireEvent.click(historyToggle);
    expect(historyToggle).toHaveFocus();
    expect(equipmentToggle).toHaveAttribute('aria-expanded','false');
    expect(screen.queryByText('Late trial 90 days')).not.toBeInTheDocument();
    expect(screen.getByTitle('Auction')).toBeVisible();
    expect(screen.getByText('Corrected title')).toBeVisible();
    expect(document.querySelectorAll('.vehicle-resource-summary__toggle[aria-expanded="true"]')).toHaveLength(1);
    fireEvent.click(historyToggle);
    expect(historyToggle).toHaveFocus();
    expect(historyToggle).toHaveAttribute('aria-expanded','false');
    expandDetails('equipment');
    page.rerender(<VehicleResourceCards vehicle={{...vehicle,vin:'1FTFW1E84RKF54321'}} variant="summary"/>);
    expect(document.querySelectorAll('.vehicle-resource-summary__toggle[aria-expanded="true"]')).toHaveLength(0);
    expect(screen.queryByText('Late trial 90 days')).not.toBeInTheDocument();
    expect(vehicle.windowSticker.options).toEqual(['Synthetic package USD 635.00','.Included tailgate','Late trial 90 days']);
  });


  it('keeps captured recall and insurance-loss exceptions visible without expanding routine service counts', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = {...vehicle.autoCheckReport!, checks:[
      {label:'Open Recall Check',status:'Recall found',detail:'1 unrepaired recall'},
      {label:'Insurance Loss / Transfer',status:'Loss reported'},
      {label:'Service / Repair',status:'Records available',detail:'5 service records reported'},
      {label:'Certified Pre-Owned',status:'No CPO info available'},
    ]};
    render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    const history = within(document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement);
    expect(history.getByText('Recall found · 1 unrepaired recall')).toBeVisible();
    expect(history.getByText('Loss reported')).toBeVisible();
    expect(history.queryByText('5 service records reported')).not.toBeInTheDocument();
    expect(history.queryByText('No CPO info available')).not.toBeInTheDocument();
    expect(history.getByRole('button',{name:'Expand history details'})).toHaveAttribute('aria-expanded','false');
    expandDetails('history');
    expect(history.getByText('5 service records reported')).toBeVisible();
    expect(history.getByText('No CPO info available')).toBeVisible();
  });

  it('does not promote a known demo-only CPO qualifier into a history exception', () => {
    const vehicle = {...sources(),vin:'TESTDATAHWELL0001',imageUrl:'/demo-vehicles/f150.jpg'};
    vehicle.autoCheckReport = {...vehicle.autoCheckReport!, checks:[{label:'Certified Pre-Owned',status:'No CPO info available',detail:'Synthetic result'}]};
    const original = JSON.stringify(vehicle);
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    const history = () => within(document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement);
    expect(history().queryByText(/No CPO info available/)).not.toBeInTheDocument();
    expect(history().getByRole('button',{name:'Expand history details'})).toHaveAttribute('aria-expanded','false');
    expandDetails('history');
    expect(history().getByText('No CPO info available')).toBeVisible();
    expect(JSON.stringify(vehicle)).toBe(original);
    page.rerender(<VehicleResourceCards vehicle={{...vehicle,vin:'1FTFW1E84RKF12345'}} variant="summary"/>);
    expect(history().getByText('No CPO info available · Synthetic result')).toBeVisible();
    page.rerender(<VehicleResourceCards vehicle={{...vehicle,autoCheckReport:{...vehicle.autoCheckReport!,checks:[{label:'Certified Pre-Owned',status:'No CPO info available',detail:'Prior certification record requires review · Synthetic result'}]}}} variant="summary"/>);
    expect(history().getByText('No CPO info available · Prior certification record requires review')).toBeVisible();
  });

  it('retains adverse detail beneath a clear status and after an earlier check with the same normalized label', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = {...vehicle.autoCheckReport!, checks:[
      {label:'Open Recall Check',status:'No issues'},
      {label:'Open   Recall Check',status:'No issues',detail:'1 unrepaired recall'},
      {label:'Insurance Loss / Transfer',status:'No issues',detail:'Insurance loss reported'},
      {label:'Odometer Check',status:'No issues'},
      {label:'Odometer Check',status:'No issues',detail:'Mileage discrepancy reported'},
      {label:'Service / Repair',status:'No issue',detail:'5 service records reported'},
    ]};
    render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    const history = within(document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement);
    expect(history.getByText('1 unrepaired recall')).toBeVisible();
    expect(history.getByText('Insurance loss reported')).toBeVisible();
    expect(history.getByText('Mileage discrepancy reported')).toBeVisible();
    expect(history.queryByText('5 service records reported')).not.toBeInTheDocument();
    expect(history.getByRole('button',{name:'Expand history details'})).toHaveAttribute('aria-expanded','false');
  });

  it('uses one attributed equipment fallback while preserving an official link without parsed equipment', () => {
    const vehicle = sources();
    vehicle.windowSticker = { dataState: 'current', url: vehicle.windowSticker!.url };
    vehicle.factoryEquipment = { ...vehicle.factoryEquipment!, packages: [{ name: 'Synthetic package', code: 'TEST-01', price: 1250.75, features: ['Included camera'] }, { name: 'Included package', price: 0 }], sections: [{ name: 'Equipment', items: [{ label: 'Heated front seats' }, { label: 'Synthetic late option' }] }] };
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expandDetails('equipment');
    const panel = within(document.querySelector('[data-resource-kind="vauto"]') as HTMLElement);
    expect(screen.getAllByText('vAuto equipment')).toHaveLength(1);
    expect(panel.getByText('vAuto equipment profile · not an original window sticker')).toBeVisible();
    expect(panel.getByRole('listitem', { name: 'Synthetic package · TEST-01 · Price 1,250.75' })).toBeVisible();
    expect(panel.getByText('Price 1,250.75')).toHaveClass('vehicle-resource-sticker__price');
    expect(panel.getByText('Price 0')).toHaveClass('vehicle-resource-sticker__price');
    expect(panel.getByRole('listitem', { name: '. Included camera' })).toHaveClass('is-child');
    expect(panel.getByText('Synthetic late option')).toBeVisible();
    expect(panel.getByRole('link', { name: 'Window sticker' })).toHaveAttribute('href', vehicle.windowSticker.url);
    expect(document.querySelector('[data-resource-kind="window-sticker"]')).toBeNull();
    page.rerender(<VehicleResourceCards vehicle={{ ...vehicle, windowSticker: { ...vehicle.windowSticker, dataState: 'unavailable', equipmentGroup: 'Unavailable original group', options: ['Unavailable original option'] } }} variant="summary"/>);
    expect(screen.getByText('vAuto equipment profile · not an original window sticker')).toBeVisible();
    expect(screen.queryByText('Unavailable original option')).not.toBeInTheDocument();
  });

  it('keeps a link-only vAuto fallback actionable on the inventory scan', () => {
    const vehicle = sources();
    vehicle.windowSticker = { dataState: 'incomplete', url: vehicle.windowSticker!.url };
    vehicle.factoryEquipment = {
      dataState: 'current', isOriginalWindowSticker: false,
      url: 'https://assets.cai-media-management.com/window-stickers/d09817fc-332f-45c1-9e7f-86f0a9e16153.jpg',
    };
    render(<VehicleResourceCards vehicle={vehicle} variant="scan" />);
    expect(document.querySelector('[data-resource-kind="window-sticker"]')).toBeNull();
    const equipment = within(document.querySelector('[data-resource-kind="vauto"]') as HTMLElement);
    expect(equipment.getByText('VIN equipment profile available')).toBeVisible();
    expect(equipment.getByText('Equipment')).toBeVisible();
  });

  it('keeps mobile scan evidence brief while retaining source status and service actions', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, dataState: 'stale', checks: [{ label: 'Additional history', status: 'Events reported', detail: 'Corrected title' }] };
    vehicle.fordOasis = { ...vehicle.fordOasis!, openActionsCaptured: false, capturedAt: '2026-09-01', openFieldServiceActions: [{ code: '26X01', description: 'Replace only if required after dealer evaluation' }] };
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="scan"/>);
    expect(screen.getByText('Score')).toBeVisible();
    expect(screen.getByText('91')).toBeVisible();
    expect(screen.getByText('1 owner')).toBeVisible();
    expect(screen.queryByText('Corrected title')).not.toBeInTheDocument();
    expect(screen.getByText('Saved report · refresh at source')).toBeVisible();
    expect(screen.getByText('At least 1 captured service action · result incomplete')).toBeVisible();
    expect(document.querySelector('.vehicle-resource-summary')).toBeNull();
    page.rerender(<VehicleResourceCards vehicle={vehicle} variant="summary" hideInServiceDate/>);
    expandDetails('OASIS');
    expect(screen.getByText('Captured actions (incomplete)')).toBeVisible();
    expect(screen.getByText('26X01 · Replace only if required after dealer evaluation')).toBeVisible();
    expect(screen.queryByText('Warranty start')).not.toBeInTheDocument();
  });

  it('keeps a sole material loss finding among the first two labeled scan rows', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, checks:[{label:'Insurance Loss / Transfer',status:'Total loss reported'}] };
    render(<VehicleResourceCards vehicle={vehicle} variant="scan"/>);
    const history = document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement;
    const rows = history.querySelectorAll('.vehicle-resource-scan__fields > div');
    expect(within(rows[0] as HTMLElement).getByText('Score')).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText('Insurance')).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText('Total loss reported')).toBeVisible();
  });

  it('offers additional captured comparison facts without inventing report results or changing source records', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, reportRunAt:'2026-09-01', lastReportedOdometer:12000, lastReportedOdometerDate:'2026-08-20', checks:[
      { label:'Title', status:'No title brands reported' },
      { label:'Accident / damage', status:'No accidents reported' },
    ] };
    vehicle.windowSticker = { ...vehicle.windowSticker!, equipmentGroupContents:['Adaptive cruise control', 'Heated front seats'], options:['Trailer Tow Package', 'Power moonroof'], totalOptions:5400 };
    vehicle.fordOasis = { ...vehicle.fordOasis!, dataState:'stale', capturedAt:'2026-08-30', openActionsCaptured:false, openFieldServiceActions:[{code:'26X01',description:'Inspect connector before replacing'}], warrantyCoverages:[{type:'Powertrain',description:'5 years / 60,000 miles'}] };
    const original = JSON.stringify(vehicle);
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="scan"/>);
    for (const provider of document.querySelectorAll('.vehicle-resource-scan__fields')) expect(provider.children.length).toBeLessThanOrEqual(3);
    expect(screen.queryByText('Adaptive cruise control')).not.toBeInTheDocument();
    page.rerender(<VehicleResourceCards vehicle={vehicle} variant="preview"/>);
    expandDetails('history');
    expect(screen.getByText('No title brands reported')).toBeVisible();
    expect(screen.getByText('12,000 mi')).toBeVisible();
    expect(screen.getByText('08/20/2026')).toBeVisible();
    expandDetails('equipment');
    expect(screen.getByText('Adaptive cruise control')).toBeVisible();
    expect(screen.getByText('Heated front seats')).toBeVisible();
    expect(screen.getByText('CAD 5,400')).toBeVisible();
    expandDetails('OASIS');
    expect(screen.getByText('26X01 · Inspect connector before replacing')).toBeVisible();
    expect(screen.getByText('06/20/2024')).toBeVisible();
    expect(screen.getByText('Powertrain · 5 years / 60,000 miles')).toBeVisible();
    expect(screen.queryByText(/No open actions|Active warranty|Available for sale/)).not.toBeInTheDocument();
    expect(JSON.stringify(vehicle)).toBe(original);
  });

  it('keeps adverse history visible in phone signals even beside a clean accident check', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, dataState:'stale', checks:[
      {label:'Accident / damage',status:'No accidents reported'},
      {label:'Insurance Loss / Transfer',status:'Total loss reported'},
    ] };
    vehicle.fordOasis = {dataState:'current',buildDate:'2024-06-20'};
    render(<VehicleResourceCards vehicle={vehicle} variant="signals"/>);
    expect(screen.getByText('AutoCheck (saved): Total loss reported')).toBeVisible();
    expect(screen.queryByText('No accidents reported')).not.toBeInTheDocument();
  });

  it('uses one demo qualifier without stripping real source details', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, checks: [{label:'Additional history',status:'Events reported',detail:'Corrected title · Synthetic example'}] };
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expect(screen.queryByText('Corrected title · Synthetic example')).not.toBeInTheDocument();
    page.rerender(<VehicleResourceCards vehicle={{...vehicle,vin:'TESTDATAHWELL0001',imageUrl:'/demo-vehicles/f150.jpg'}} variant="summary"/>);
    const history = within(document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement);
    expect(history.getByText('Demo')).toBeVisible();
    expect(history.queryByText('Corrected title')).not.toBeInTheDocument();
    expandDetails('history');
    expect(history.getByText('Corrected title')).toBeVisible();
    expect(history.queryByText('Corrected title · Synthetic example')).not.toBeInTheDocument();
    expect(vehicle.autoCheckReport.checks?.[0]?.detail).toBe('Corrected title · Synthetic example');
  });

  it('fills inventory source windows with actual history checks and named equipment', () => {
    render(<VehicleResourceCards vehicle={sources()} variant="summary" onOpenSection={vi.fn()}/>);
    expandDetails('history');
    const history = document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement;
    expect(within(history).getByText('Score')).toBeVisible();
    expect(within(history).getByText('91')).toBeVisible();
    expect(within(history).getByTitle('Accident / damage')).toBeVisible();
    expect(within(history).getByText('No accidents reported')).toBeVisible();
    expect(within(history).getByText('1 owner')).toBeVisible();
    expect(within(history).getByText('Personal')).toBeVisible();
    expandDetails('equipment');
    const equipment = document.querySelector('[data-resource-kind="window-sticker"]') as HTMLElement;
    expect(within(equipment).getByText('Synthetic option')).toBeVisible();
    expect(within(equipment).getByText('Sticker & equipment')).toBeVisible();
    expect(document.querySelector('[data-resource-kind="vauto"]')).toBeNull();
    expandDetails('OASIS');
    const oasis = document.querySelector('[data-resource-kind="oasis"]') as HTMLElement;
    expect(within(oasis).getByText('Captured actions (incomplete)')).toBeVisible();
    expect(within(oasis).getByText('DEMO-01')).toBeVisible();
    expect(within(oasis).getByText('Warranty start')).toBeVisible();
    expect(within(oasis).getByText('08/14/2024')).toBeVisible();
  });

  it('keeps sparse evidence visible while uncaptured destinations remain compact source links', () => {
    render(<VehicleResourceCards vehicle={{vin:'TESTDATAHWELL0001',make:'Ford',year:2024,model:'F-150',trim:'Lariat',msrp:68420,imageUrl:'/demo-vehicles/f150.jpg'}} variant="summary"/>);
    const sample = document.querySelector('.vehicle-resource-summary--sparse') as HTMLElement;
    expect(within(sample).getByText('F-150 Lariat')).toBeVisible();
    expect(within(sample).getByText('$68,420 MSRP')).toBeVisible();
    expect(within(sample).getByRole('link', { name:/Open demo sticker/ })).toBeVisible();
    const lookups = document.querySelector('.vehicle-resource-lookups') as HTMLElement;
    expect(within(lookups).getByRole('link', { name:/Open OASIS/ })).toBeVisible();
    expect(within(lookups).getByRole('link', { name:/Open invoice/ })).toBeVisible();
    expect(screen.queryByText(/No open Ford actions|clean history/i)).not.toBeInTheDocument();
  });

  it('preserves captured sticker details alongside a synthetic document preview', () => {
    const vehicle = { ...sources(), vin: 'TESTDATAHWELL0001', imageUrl: '/demo-vehicles/f150.jpg' };
    render(<VehicleResourceCards vehicle={vehicle} variant="summary" summaryLimit={6}/>);
    expandDetails('equipment');
    const sticker = document.querySelector('[data-resource-kind="window-sticker"]') as HTMLElement;
    expect(within(sticker).getByText('CAD 68,420')).toBeVisible();
    expect(within(sticker).getByText('Synthetic equipment group')).toBeVisible();
    expect(within(sticker).getByText('Synthetic option')).toBeVisible();
    const preview = within(sticker).getByRole('img', { name: 'Clearly marked synthetic demo window sticker' });
    expect(preview).toHaveAttribute('src', '/demo-documents/window-sticker-TESTDATAHWELL0001.png');
    fireEvent.error(preview);
    expect(within(sticker).queryByRole('img')).not.toBeInTheDocument();
    expect(within(sticker).getByText('Synthetic option')).toBeVisible();
    expect(within(sticker).getByRole('link', { name: /Open demo sticker/ })).toBeVisible();
  });

  it('preserves captured warnings and safe fallback actions in expanded source windows', () => {
    const vehicle = sources();
    vehicle.autoCheckReport = {dataState:'current',url:'https://carfax.com/report',score:81,checks:[{label:'Title',status:'Salvage reported'},{label:'Odometer',status:'Discrepancy reported'}]};
    const onOpenSection = vi.fn();
    render(<VehicleResourceCards vehicle={vehicle} variant="summary" summaryLimit={6} onOpenSection={onOpenSection}/>);
    const history = document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement;
    expect(within(history).getByTitle('Title')).toBeVisible();
    expect(within(history).getByText('Salvage reported')).toBeVisible();
    expect(within(history).getByTitle('Odometer')).toBeVisible();
    expect(within(history).getByText('Discrepancy reported')).toBeVisible();
    expect(within(history).queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', {name:/View AutoCheck data/}));
    expect(onOpenSection).toHaveBeenCalledWith('data');
  });

  it('separates explicitly captured equipment-group contents and price from optional equipment', () => {
    const vehicle = sources();
    vehicle.windowSticker = {...vehicle.windowSticker!,pricingCurrency:'USD',equipmentGroup:'Equipment Group 302A',equipmentGroupPrice:4770,equipmentGroupContents:['Heated seats','Remote start','Power seat'],options:['Bed Utility Package (68L) USD 635.00','.Tailgate step']};
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expandDetails('equipment');
    const included = screen.getByRole('list',{name:'Included with equipment group'});
    expect(within(included).getAllByRole('listitem').map(item=>item.textContent)).toEqual(['Heated seats','Remote start','Power seat']);
    expect(screen.getByText('$4,770')).toBeVisible();
    expect(screen.getByText('Optional equipment',{exact:true})).toBeVisible();
    expect(within(included).queryByText('Bed Utility Package')).not.toBeInTheDocument();
    expect(screen.getByRole('listitem',{name:'Bed Utility Package (68L) USD 635.00'})).toBeVisible();
    page.rerender(<VehicleResourceCards vehicle={{...vehicle,windowSticker:{...vehicle.windowSticker!,equipmentGroupContents:undefined,equipmentGroupPrice:undefined}}} variant="summary"/>);
    expect(screen.queryByRole('list',{name:'Included with equipment group'})).not.toBeInTheDocument();
    expect(screen.getByText('Captured equipment',{exact:true})).toBeVisible();
    expect(screen.queryByText('$4,770')).not.toBeInTheDocument();
  });

  it('keeps sticker options and standard equipment visible without mixing in vAuto-only packages', () => {
    const vehicle = sources();
    vehicle.windowSticker = { ...vehicle.windowSticker!, options: ['Technology Package (55A) $1,995', '20-inch optional wheels'], standardEquipment: ['Standard radio'] };
    vehicle.factoryEquipment = { ...vehicle.factoryEquipment!, packages: [{ name: 'vAuto-only package' }] };
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="summary" summaryLimit={6}/>);
    expandDetails('equipment');
    const sticker = () => within(document.querySelector('[data-resource-kind="window-sticker"]') as HTMLElement);
    expect(sticker().getByRole('listitem', { name: 'Technology Package (55A) $1,995' })).toBeVisible();
    expect(sticker().getByText('20-inch optional wheels')).toBeVisible();
    expect(sticker().getByText('Standard radio')).toBeVisible();
    expect(sticker().getByRole('region', { name: 'Standard equipment' })).toBeVisible();
    expect(sticker().queryByText('vAuto-only package')).not.toBeInTheDocument();
    expect(document.querySelector('[data-resource-kind="vauto"]')).toBeNull();
    expect(vehicleResourceCatalog(vehicle).find(resource => resource.id === 'vauto')!.facts).toContain('vAuto-only package');
    page.rerender(<VehicleResourceCards vehicle={{ ...vehicle, windowSticker: { ...vehicle.windowSticker!, options: [] } }} variant="summary"/>);
    expect(sticker().getByText('Optional equipment details not captured')).toBeVisible();
  });

  it('shows every captured optional sticker item without a package or option cap', () => {
    const vehicle = sources();
    const options = ['Tow Package (53C) $1,095', 'Technology Package (55A) $1,995', 'Sport Package (68S) $1,495', 'Winter Package (68W) $695', '20-inch optional wheels', 'Panoramic roof', 'Bed liner', 'Power running boards', 'Onboard power outlet'];
    vehicle.windowSticker = { ...vehicle.windowSticker!, options };
    render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expandDetails('equipment');
    const sticker = within(document.querySelector('[data-resource-kind="window-sticker"]') as HTMLElement);
    expect(sticker.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(options);
  });

  it('keeps leading marked equipment as peers without inventing a parent', () => {
    const vehicle = sources();
    vehicle.windowSticker = {...vehicle.windowSticker!, equipmentGroup:'Equipment Group 301A', options:['.HEATED SEATS','.POWER LIFTGATE']};
    render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expandDetails('equipment');
    const first = screen.getByRole('listitem',{name:'.HEATED SEATS'});
    const second = screen.getByRole('listitem',{name:'.POWER LIFTGATE'});
    expect(first.parentElement).toBe(second.parentElement);
    expect(first).toHaveTextContent('HEATED SEATS');
    expect(second).toHaveTextContent('POWER LIFTGATE');
    expect(first.querySelector('ol')).toBeNull();
  });

  it('preserves package children, exact prices, no-charge and late trial lines in sticker source order', () => {
    const vehicle = sources();
    const options = ['Bed Utility Package (68L) · USD 635.00', '.TAILGATE STEP', '.275/60R20 BSW ALL-TERRAIN', 'HYBRID TRANSMISSION NO CHARGE', 'Floor liners CAD 200.00', 'Mobile Office Package $555', '.Wireless charging', 'BlueCruise 90-day trial', '.5L source engine text', '.20" GLOSS BLACK PAINTED ALUM', '.3.5L V6 ECOBOOST', '.20-inch wheels'];
    vehicle.windowSticker = { ...vehicle.windowSticker!, options };
    render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expandDetails('equipment');
    const sticker = within(document.querySelector('[data-resource-kind="window-sticker"]') as HTMLElement);
    const items = sticker.getAllByRole('listitem');
    expect(items.map(item => item.getAttribute('aria-label'))).toEqual(options);
    expect(items[0].querySelector('.vehicle-resource-sticker__price')).toHaveTextContent('$635.00');
    expect(items[1]).toHaveClass('is-child');
    expect(items[1].textContent).toBe('TAILGATE STEP');
    expect(items[1].closest('.vehicle-resource-sticker__children')?.parentElement).toBe(items[0]);
    expect(within(items[0]).getByText('68L')).toBeVisible();
    expect(items[2]).toHaveClass('is-child');
    expect(items[3].querySelector('.vehicle-resource-sticker__price')).toHaveTextContent('NO CHARGE');
    expect(items[4].querySelector('.vehicle-resource-sticker__price')).toHaveTextContent('CAD 200.00');
    expect(items[7]).toHaveTextContent('BlueCruise 90-day trial');
    expect(items[7].querySelector('.vehicle-resource-sticker__price')).toBeNull();
    expect(items[8]).not.toHaveClass('is-child');
    expect(items[9]).toHaveClass('is-child');
    expect(items[10]).toHaveClass('is-child');
    expect(items[11]).toHaveClass('is-child');
  });

  it('shows every history check beyond six rows and preserves report/source qualifications', () => {
    const vehicle = sources();
    const labels = ['State Title Brand', 'Auction Brand / Issues', 'Accident / Damage', 'Open Recall Check', 'Insurance Loss / Transfer', 'Odometer Check', 'Certified Pre-Owned', 'Service / Repair', 'Additional History'];
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, dataState: 'stale', reportRunAt: '2026-09-01', checks: labels.map(label => ({ label, status: label === 'Additional History' ? 'EVENTS REPORTED' : label === 'Certified Pre-Owned' ? 'NO CPO INFO AVAILABLE' : 'NO ISSUE', detail: label === 'Additional History' ? 'Corrected Title' : label === 'Service / Repair' ? '5 Service Records Reported' : undefined })) };
    vehicle.factoryEquipment = { ...vehicle.factoryEquipment!, dataState: 'incomplete', capturedAt: '2026-08-28' };
    vehicle.windowSticker = null;
    vehicle.fordOasis = { ...vehicle.fordOasis!, dataState: 'unavailable' };
    render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expandDetails('history');
    const history = within(document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement);
    labels.forEach(label => expect(history.getByTitle(label)).toBeVisible());
    expect(history.getByText('Corrected Title')).toBeVisible();
    expect(history.getByText('NO CPO INFO AVAILABLE')).toBeVisible();
    expect(history.getByText('5 Service Records Reported')).toBeVisible();
    expect(history.getByText('Saved report · refresh at source · Report run 09/01/2026')).toBeVisible();
    expect(screen.getByText('Partial captured record')).toBeVisible();
    expandDetails('equipment');
    expect(screen.getByText('Partial captured record · Captured 08/28/2026')).toBeVisible();
    expect(screen.getByText('Source currently unavailable')).toBeVisible();
  });

  it('keeps every OASIS action condition and coverage term visible beyond summary limits', () => {
    const vehicle = sources();
    const actions = [
      { code: '26S01', description: 'Synthetic inspection' },
      { code: '26N02', description: 'Synthetic component replacement if required after dealer evaluation' },
      { code: '26M03', description: 'Synthetic module update if required after dealer evaluation' },
      { code: '26X04', description: 'Synthetic calibration campaign' },
    ];
    const coverages = [
      { type: 'Basic', description: '3 years / 36,000 miles' },
      { type: 'Corrosion', description: '5 years / unlimited miles' },
      { type: 'Restraint', description: '5 years / 60,000 miles' },
      { type: 'Powertrain', description: '5 years / 60,000 miles' },
      { type: 'Emissions', description: '8 years / 80,000 miles' },
    ];
    vehicle.fordOasis = { dataState: 'incomplete', capturedAt: '2026-09-01', warrantyStartDate: '04-JUN-2021', buildDate: '12-MAY-2021', releaseDate: '18-MAY-2021', monthsInService: 63, saleMileage: 12, openFieldServiceActions: actions, warrantyCoverages: coverages, extendedCoverageExpirations: ['Synthetic extension through 31-MAY-2028'] };
    render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expandDetails('OASIS');
    const oasis = within(document.querySelector('[data-resource-kind="oasis"]') as HTMLElement);
    actions.forEach(action => expect(oasis.getByText(`${action.code} · ${action.description}`)).toBeVisible());
    coverages.forEach(coverage => expect(oasis.getByText(`${coverage.type} · ${coverage.description}`)).toBeVisible());
    expect(oasis.getByText('06/04/2021')).toBeVisible();
    expect(oasis.getByText('05/18/2021')).toBeVisible();
    expect(oasis.getByText('63 months')).toBeVisible();
    expect(oasis.getByText('12 mi')).toBeVisible();
    expect(oasis.getByText('Synthetic extension through 05/31/2028')).toBeVisible();
    expect(oasis.getByText('Partial captured record · Captured 09/01/2026')).toBeVisible();
    expect(oasis.queryByText(/active coverage|all recalls/i)).not.toBeInTheDocument();
  });

  it.each(['Ford', 'Lincoln'])('uses an AutoCheck estimate for %s only while OASIS lacks an in-service date', make => {
    const vehicle = { ...sources(), make, fordOasis: null, autoCheckReport: { dataState: 'current', estimatedInServiceDate: '2024-08-14' } };
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    const history = () => within(document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement);
    expect(history().getByText('Est. in-service 08/14/2024')).toBeVisible();
    page.rerender(<VehicleResourceCards vehicle={{ ...vehicle, fordOasis: { warrantyStartDate: '18-AUG-2024' } }} variant="summary"/>);
    expect(history().queryByText(/08\/14\/2024|Est. in-service|Estimated warranty start/)).not.toBeInTheDocument();
    expect(vehicleResourceCatalog(vehicle).find(resource => resource.id === 'autocheck')!.facts).toContain('Estimated warranty start 08/14/2024');
  });

  it('retains non-Ford estimated in-service and only deduplicates matching vAuto specifications', () => {
    const vehicle = { ...sources(), make: 'Chevrolet', fordOasis: null, engine: 'Synthetic V6', transmission: 'Synthetic automatic', drivetrain: 'AWD' };
    vehicle.autoCheckReport = { ...vehicle.autoCheckReport!, estimatedInServiceDate: '2024-08-14' };
    vehicle.factoryEquipment = { ...vehicle.factoryEquipment!, engine: 'Synthetic V6', transmission: 'Synthetic automatic', drivetrain: 'AWD', totalMsrp: vehicle.windowSticker!.totalMsrp };
    const page = render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expect(within(document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement).getByText('Est. in-service 08/14/2024')).toBeVisible();
    const equipment = () => vehicleResourceCatalog(vehicle).find(resource => resource.id === 'vauto')!;
    expect(equipment().summaryRows?.some(row => row.label === 'Powertrain')).toBe(false);
    expect(equipment().summaryRows?.some(row => row.label === 'MSRP')).toBe(false);
    expect(document.querySelector('[data-resource-kind="vauto"]')).toBeNull();
    expect(vehicleResourceCatalog(vehicle).find(resource => resource.id === 'vauto')!.facts).toContain('Synthetic V6 · Synthetic automatic · AWD');
    const different = { ...vehicle, factoryEquipment: { ...vehicle.factoryEquipment!, engine: 'Different captured engine', totalMsrp: 70000 } };
    page.rerender(<VehicleResourceCards vehicle={different} variant="summary"/>);
    expect(vehicleResourceCatalog(different).find(resource => resource.id === 'vauto')!.facts).toContain('Different captured engine · Synthetic automatic · AWD');
  });

  it('keeps workspace source links external, provider-named, and separate from row selection', () => {
    const rowAction = vi.fn();
    render(<div onClick={rowAction}><VehicleResourceCards vehicle={sources()} variant="summary"/></div>);
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    const autoCheck = screen.getByRole('link', {name:/Open AutoCheck history/});
    expect(autoCheck).toHaveAttribute('href',sources().autoCheckReport?.url);
    fireEvent.click(autoCheck);
    expect(rowAction).not.toHaveBeenCalled();
    for (const link of links) {
      expect(link).toHaveAttribute('target','_blank');
      expect(link).toHaveAttribute('rel','noopener noreferrer');
      expect(link).toHaveAttribute('referrerpolicy','no-referrer');
    }
    expect(screen.queryByRole('link',{name:/Open vAuto equipment/})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:/Open invoice/})).toHaveAttribute('href',expect.stringContaining('v=1FTFW1E84RKF12345'));
  });

  it('does not swallow Escape or Tab needed by the containing vehicle dialog', () => {
    const keyAction = vi.fn();
    render(<div onKeyDown={keyAction}><VehicleResourceCards vehicle={sources()} variant="summary"/></div>);
    const link = screen.getByRole('link',{name:/Open AutoCheck/});
    fireEvent.keyDown(link,{key:'Escape'}); fireEvent.keyDown(link,{key:'Tab'});
    expect(keyAction).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(link,{key:'Enter'});
    expect(keyAction).toHaveBeenCalledTimes(2);
  });

  it('offers an explicit captured-data action when a URL is rejected without weakening the source guard', () => {
    const vehicle=sources(); vehicle.autoCheckReport!.url='https://carfax.com/report?vin=1FTFW1E84RKF12345';
    const onOpenSection=vi.fn(); render(<VehicleResourceCards vehicle={vehicle} variant="summary" onOpenSection={onOpenSection}/>);
    expect(screen.queryByRole('link',{name:/AutoCheck/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/View AutoCheck data/}));
    expect(onOpenSection).toHaveBeenCalledWith('data');
    expect(screen.queryByText(/CARFAX/)).not.toBeInTheDocument();
  });

  it('omits missing resources and never manufactures a dealer lookup from an invalid VIN', () => {
    render(<VehicleResourceCards vehicle={{vin:'NOT-A-VIN',make:'Ford'}} variant="summary"/>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('.vehicle-resources')).toBeNull();
  });

  it('uses a clearly marked local demo sticker only with the exact synthetic identity and image', () => {
    const vehicle={vin:'TESTDATAHWELL0001',make:'Ford',year:2024,model:'F-150',trim:'Lariat',msrp:68420,imageUrl:'/demo-vehicles/f150.jpg'};
    render(<VehicleResourceCards vehicle={vehicle} variant="summary"/>);
    expect(screen.getByRole('link',{name:/Open demo sticker/})).toHaveAttribute('href','/demo-documents/window-sticker.html?vehicle=TESTDATAHWELL0001');
    const sticker=document.querySelector('[data-resource-kind="window-sticker"]') as HTMLElement;
    expect(sticker.querySelector('.vehicle-resource-brand--ford')).toBeNull();
    expect(vehicleResourceCatalog({...vehicle,imageUrl:'/demo-vehicles/escape.jpg'}).find(resource=>resource.id==='window-sticker')).toBeUndefined();
  });

  it('keeps valid Ford destinations compact when no report details are available', () => {
    const entries=vehicleResourceCatalog({vin:sources().vin,make:'Ford'});
    expect(entries.map(entry=>entry.id)).toEqual(['oasis','invoice']);
    expect(entries.every(entry=>!entry.hasCapturedData)).toBe(true);
    expect(entries.find(entry=>entry.id==='oasis')?.compactFacts).toEqual([]);
    expect(entries.find(entry=>entry.id==='oasis')?.sourceNote).toBeNull();
  });

  it('accepts both application and common API records without an adapter', () => {
    const record={...sources(),fordOasis:{dataState:'stale_unverified',warrantyStartDate:'14-AUG-2024'}} as unknown as VehicleRecord;
    const adapted=sources() as InventoryVehicle;
    expect(vehicleResourceCatalog(record).find(entry=>entry.id==='oasis')?.sourceNote).toBe('Saved report · refresh at source');
    expect(vehicleResourceCatalog(adapted)).toHaveLength(5);
  });

});
