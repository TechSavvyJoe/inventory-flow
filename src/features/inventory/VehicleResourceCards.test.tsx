import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InventoryVehicle } from './types';
import type { VehicleRecord } from '../../types';
import { VehicleResourceCards, type VehicleResourceVehicle } from './VehicleResourceCards';
import { vehicleResourceCatalog } from './vehicle-resource-catalog';

afterEach(cleanup);
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

describe('source-backed vehicle resource cards', () => {
  it('shows four branded cards with captured facts and keeps invoice out of the card row', () => {
    render(<VehicleResourceCards vehicle={sources()} variant="cards"/>);
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByText('CAD 68,420 MSRP · Synthetic equipment group')).toBeVisible();
    expect(screen.getByText('91')).toBeVisible();
    expect(screen.getByText('Score')).toBeVisible();
    expect(screen.getByText('1 owner · Personal')).toBeVisible();
    expect(screen.getByText('Heated front seats')).toBeVisible();
    expect(screen.getByText('Synthetic Tow Package')).toBeVisible();
    expect(screen.getByText('Warranty start 14-AUG-2024')).toBeVisible();
    expect(screen.queryByText(/CARFAX/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ford invoice')).not.toBeInTheDocument();
    expect(document.querySelector('[data-resource="autocheck"] img')).toHaveAttribute('src','/resource-brands/autocheck.svg');
    expect(document.querySelector('[data-resource="vauto"] img')).toHaveAttribute('src','/resource-brands/vauto.svg');
  });

  it('keeps direct compact source links external, provider-named, and separate from row selection', () => {
    const rowAction = vi.fn();
    render(<div onClick={rowAction}><VehicleResourceCards vehicle={sources()} variant="inline"/></div>);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
    const autoCheck = screen.getByRole('link', {name:/Open AutoCheck history/});
    expect(autoCheck).toHaveAttribute('href',sources().autoCheckReport?.url);
    fireEvent.click(autoCheck);
    expect(rowAction).not.toHaveBeenCalled();
    for (const link of links) {
      expect(link).toHaveAttribute('target','_blank');
      expect(link).toHaveAttribute('rel','noopener noreferrer');
      expect(link).toHaveAttribute('referrerpolicy','no-referrer');
    }
    expect(screen.getByRole('link',{name:/Open vAuto equipment/})).toHaveAttribute('href',sources().factoryEquipment?.url);
    expect(screen.getByRole('link',{name:/Open invoice/})).toHaveAttribute('href',expect.stringContaining('v=1FTFW1E84RKF12345'));
  });

  it('does not swallow Escape or Tab needed by the containing vehicle dialog', () => {
    const keyAction = vi.fn();
    render(<div onKeyDown={keyAction}><VehicleResourceCards vehicle={sources()} variant="inline"/></div>);
    const link = screen.getByRole('link',{name:/Open AutoCheck/});
    fireEvent.keyDown(link,{key:'Escape'}); fireEvent.keyDown(link,{key:'Tab'});
    expect(keyAction).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(link,{key:'Enter'});
    expect(keyAction).toHaveBeenCalledTimes(2);
  });

  it('offers an explicit captured-data action when a URL is rejected without weakening the source guard', () => {
    const vehicle=sources(); vehicle.autoCheckReport!.url='https://carfax.com/report?vin=1FTFW1E84RKF12345';
    const onOpenSection=vi.fn(); render(<VehicleResourceCards vehicle={vehicle} variant="inline" onOpenSection={onOpenSection}/>);
    expect(screen.queryByRole('link',{name:/AutoCheck/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/View AutoCheck data/}));
    expect(onOpenSection).toHaveBeenCalledWith('data');
    expect(screen.queryByText(/CARFAX/)).not.toBeInTheDocument();
  });

  it('omits missing resources and never manufactures a dealer lookup from an invalid VIN', () => {
    render(<VehicleResourceCards vehicle={{vin:'NOT-A-VIN',make:'Ford'}} variant="inline"/>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('.vehicle-resources')).toBeNull();
  });

  it('labels valid uncaptured Ford destinations as sign-in lookups, not completed reports', () => {
    const entries=vehicleResourceCatalog({vin:sources().vin,make:'Ford'});
    expect(entries.map(entry=>entry.id)).toEqual(['oasis','invoice']);
    expect(entries.every(entry=>!entry.hasCapturedData && entry.subtitle==='Exact-VIN dealer lookup')).toBe(true);
    expect(entries.find(entry=>entry.id==='oasis')?.compactFacts).toEqual(['DealerConnection sign-in']);
    expect(entries.find(entry=>entry.id==='oasis')?.sourceNote).toBe('No OASIS report details captured');
  });

  it('uses a clearly marked local demo sticker only with the exact synthetic identity and image', () => {
    const vehicle={vin:'TESTDATAHWELL0001',make:'Ford',year:2024,model:'F-150',trim:'Lariat',msrp:68420,imageUrl:'/demo-vehicles/f150.png'};
    render(<VehicleResourceCards vehicle={vehicle} variant="cards"/>);
    expect(screen.getByRole('link',{name:/Open demo sticker/})).toHaveAttribute('href','/demo-documents/window-sticker.html?vehicle=TESTDATAHWELL0001');
    const card=document.querySelector('[data-resource="window-sticker"]') as HTMLElement;
    expect(within(card).getByText('Synthetic sample · not an original')).toBeVisible();
    expect(within(card).getByText('F-150 Lariat')).toBeVisible();
    expect(within(card).getByText('USD 68,420 MSRP')).toBeVisible();
    expect(within(card).queryByText('Open the source for its full details.')).not.toBeInTheDocument();
    expect(within(card).getByRole('img')).toHaveAttribute('src','/demo-documents/window-sticker-preview.png');
    expect(card.querySelector('.vehicle-resource-brand--ford')).toBeNull();
    expect(vehicleResourceCatalog({...vehicle,imageUrl:'/demo-vehicles/escape.png'}).find(resource=>resource.id==='window-sticker')).toBeUndefined();
  });

  it('keeps a demo-sticker card useful when its optional preview asset cannot load', () => {
    const vehicle={vin:'TESTDATAHWELL0001',make:'Ford',year:2024,model:'F-150',trim:'Lariat',msrp:68420,imageUrl:'/demo-vehicles/f150.png'};
    render(<VehicleResourceCards vehicle={vehicle} variant="cards"/>);
    const card=document.querySelector('[data-resource="window-sticker"]') as HTMLElement;
    const preview=card.querySelector('.vehicle-resource-preview') as HTMLImageElement;
    fireEvent.error(preview);

    expect(card.querySelector('.vehicle-resource-preview')).toBeNull();
    expect(card.querySelector('.vehicle-resource-body')).not.toHaveClass('has-preview');
    expect(within(card).getByText('F-150 Lariat')).toBeVisible();
    expect(within(card).getByRole('link',{name:/Open demo sticker/})).toHaveAttribute('href','/demo-documents/window-sticker.html?vehicle=TESTDATAHWELL0001');
  });

  it('accepts both application and common API records without an adapter', () => {
    const record={...sources(),fordOasis:{dataState:'stale_unverified',warrantyStartDate:'14-AUG-2024'}} as unknown as VehicleRecord;
    const adapted=sources() as InventoryVehicle;
    expect(vehicleResourceCatalog(record).find(entry=>entry.id==='oasis')?.sourceNote).toContain('Saved report · refresh at source');
    expect(vehicleResourceCatalog(adapted)).toHaveLength(5);
  });

  it('renders useful SRP facts as page content, not just title tooltips', () => {
    render(<VehicleResourceCards vehicle={sources()} variant="inline" onOpenSection={vi.fn()}/>);
    const history = document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement;
    expect(history.querySelector('.vehicle-resource-inline-facts')).toHaveTextContent('Score 91');
    expect(history.querySelector('.vehicle-resource-inline-facts')).toHaveTextContent('1 owner');
    expect(history.querySelector('.vehicle-resource-inline-facts')).toHaveTextContent('No accidents reported');
    expect(within(history).queryByText('Original source')).not.toBeInTheDocument();
    const sticker = document.querySelector('[data-resource-kind="window-sticker"]') as HTMLElement;
    expect(sticker.querySelector('.vehicle-resource-inline-facts')).toHaveTextContent('CAD 68,420 MSRP');
    expect(sticker.querySelector('.vehicle-resource-inline-facts')).toHaveTextContent('Synthetic equipment group');
  });

  it('keeps non-original and synthetic source identity visible in compact SRP cards', () => {
    const { unmount } = render(<VehicleResourceCards vehicle={sources()} variant="inline" onOpenSection={vi.fn()}/>);
    const equipment = document.querySelector('[data-resource-kind="vauto"]') as HTMLElement;
    expect(within(equipment).getByText('Informational label')).toBeVisible();
    expect(within(equipment).getByText('Informational · not an original sticker')).not.toBeVisible();
    fireEvent.click(equipment.querySelector('summary')!);
    expect(within(equipment).getByText('Informational · not an original sticker')).toBeVisible();

    unmount();
    render(<VehicleResourceCards vehicle={{
      vin: 'TESTDATAHWELL0001', make: 'Ford', year: 2024, model: 'F-150', trim: 'Lariat', msrp: 68420,
      imageUrl: '/demo-vehicles/f150.png',
    }} variant="inline" onOpenSection={vi.fn()}/>);
    const demo = document.querySelector('[data-resource-kind="window-sticker"]') as HTMLElement;
    expect(within(demo).getByText('Synthetic sample · not an original')).toBeVisible();
  });

  it('keeps captured VDP details separate from the original source action', () => {
    const onOpenSection=vi.fn();
    render(<VehicleResourceCards vehicle={sources()} variant="cards" onOpenSection={onOpenSection}/>);
    const history=document.querySelector('[data-resource="autocheck"]') as HTMLElement;
    expect(within(history).getByRole('link',{name:/Open AutoCheck history/})).toHaveAttribute('href',sources().autoCheckReport?.url);
    fireEvent.click(within(history).getByRole('button',{name:/View AutoCheck data/}));
    expect(onOpenSection).toHaveBeenCalledWith('data');
    expect(within(history).getByText('Accident / damage: No accidents reported')).toBeVisible();
  });

  it('shows partial or stale provenance with an explicit saved-data action', () => {
    const vehicle=sources();
    vehicle.autoCheckReport={dataState:'stale',ownerCount:1,checks:[{label:'Title',status:'Salvage reported'}]};
    render(<VehicleResourceCards vehicle={vehicle} variant="inline" onOpenSection={vi.fn()}/>);
    const history=document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement;
    expect(within(history).getByText('Saved data')).toBeVisible();
    expect(history.querySelector('.vehicle-resource-inline-facts')).toHaveTextContent('Title: Salvage reported');
    expect(within(history).getByText('Refresh source')).toBeVisible();
    expect(within(history).getByText('Saved report · refresh at source')).not.toBeVisible();
    fireEvent.click(history.querySelector('summary')!);
    expect(within(history).getByText('Saved report · refresh at source')).toBeVisible();
    expect(within(history).queryByRole('link')).not.toBeInTheDocument();
  });

  it.each(['2099-01-01', 'not-a-date'])('keeps suspect capture dates visible in inline summaries: %s', reportRunAt => {
    const vehicle=sources();
    vehicle.autoCheckReport!.reportRunAt=reportRunAt;
    vehicle.fordOasis={dataState:'current',warrantyStartDate:'14-AUG-2024',openFieldServiceActions:[]};
    render(<VehicleResourceCards vehicle={vehicle} variant="inline" onOpenSection={vi.fn()}/>);
    const history=document.querySelector('[data-resource-kind="autocheck"]') as HTMLElement;
    expect(within(history).getByText('Source date needs verification')).toBeVisible();
    fireEvent.click(history.querySelector('summary')!);
    expect(within(history).getByText(/Future source date|Unrecognized source date/)).toBeVisible();
    const oasis=document.querySelector('[data-resource-kind="oasis"]') as HTMLElement;
    expect(within(oasis).getByText('Action result not captured')).toBeVisible();
  });

  it('keeps invoice as one compact sign-in source link with no blank summary block', () => {
    render(<VehicleResourceCards vehicle={sources()} variant="inline"/>);
    const invoice=document.querySelector('[data-resource-kind="invoice"]')!;
    expect(invoice).toHaveClass('vehicle-resource-inline-item--lookup');
    expect(within(invoice as HTMLElement).getByRole('link',{name:/Open invoice/})).toHaveAttribute('href',expect.stringContaining('v=1FTFW1E84RKF12345'));
    expect(invoice.querySelector('.vehicle-resource-inline-facts')).toBeNull();
    expect(invoice.querySelector('details')).toBeNull();
    expect(invoice).toHaveTextContent('Dealer sign-in');
    expect(invoice).not.toHaveTextContent('Invoice details are not captured');
  });

  it('keeps routine capture dates out of primary summaries but reachable under Source details', () => {
    const vehicle=sources(); vehicle.autoCheckReport!.reportRunAt='2026-09-01';
    render(<VehicleResourceCards vehicle={vehicle} variant="cards"/>);
    const history=document.querySelector('[data-resource="autocheck"]') as HTMLElement;
    expect(within(history).getByText('Report run Sep 1, 2026')).not.toBeVisible();
    expect(history.querySelector('summary')).toHaveAttribute('aria-label','Source details for AutoCheck');
    expect(history.querySelector('.vehicle-resource-body')).not.toHaveTextContent('Report run');
    fireEvent.click(history.querySelector('summary')!);
    expect(within(history).getByText('Report run Sep 1, 2026')).toBeVisible();
  });

  it('does not rewrite a long OASIS warning as an equipment cue', () => {
    const vehicle=sources();
    const description='CAMERA INSPECTION — VERIFY VIN BEFORE REPAIR; SERVICE ACTION REMAINS OPEN';
    vehicle.fordOasis!.openFieldServiceActions=[{code:'TEST-26A',description}];
    render(<VehicleResourceCards vehicle={vehicle} variant="inline"/>);
    expect(document.querySelector('[data-resource-kind="oasis"] .vehicle-resource-inline-facts')).toHaveTextContent(description);
  });
});
