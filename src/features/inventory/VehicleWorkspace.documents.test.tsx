import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleWorkspace } from './VehicleWorkspace';
import type { InventoryVehicle } from './types';

afterEach(cleanup);

function vehicle(withDocuments = true): InventoryVehicle {
  return {
    id: 'TESTDATASYN000001',
    vin: 'TESTDATASYN000001',
    stockNumber: 'HT0529A',
    year: 2026,
    make: 'Ford',
    model: 'Explorer',
    trim: 'Active',
    price: 42810,
    msrp: 49480,
    mileage: 2052,
    daysListed: 18,
    exteriorColor: 'Carbonized Gray Metallic',
    interiorColor: 'Dark Space Gray',
    engine: '2.3L EcoBoost',
    transmission: '10-speed automatic',
    publicListing: { dataState: 'current', isListed: true },
    dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
    dealerMail: { dataState: 'current', hasActiveHold: false, position: null },
    location: { homeStore: { id: 'howell', name: 'Howell' } },
    ...(withDocuments
      ? {
          autoCheckReport: {
            dataState: 'current' as const,
            url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token',
            reportRunAt: '2026-08-30T00:38:38-04:00',
            score: 92,
            scoreRangeLow: 89,
            scoreRangeHigh: 94,
            usage: 'Personal',
            ownerCount: 1,
            lastReportedOdometer: 2052,
            lastReportedOdometerDate: '2026-05-23',
            checks: [
              { label: 'Accident / damage', status: 'No accidents or damage reported' },
              { label: 'Open recall check', status: 'No open recalls' },
            ],
          },
          windowSticker: {
            dataState: 'current' as const,
            url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U',
            vehicleDescription: '2026 Explorer Active 4WD',
            equipmentGroup: 'Equipment Group 200A',
            basePrice: 42585,
            totalOptions: 5100,
            destinationCharge: 1795,
            totalMsrp: 49480,
            engine: '2.3L EcoBoost',
            transmission: '10-speed automatic',
            options: ['Active Comfort Package', '20-inch wheels'],
          },
        }
      : {}),
  };
}

function openVehicleDocuments() {
  fireEvent.click(screen.getByRole('tab', { name: 'Records' }));
  return screen.queryByRole('region', { name: 'Vehicle documents' });
}

describe('vehicle document workspace', () => {
  it('keeps mixed manual and DealerMail overview facts attached to their own sources', () => {
    const record = vehicle(false)
    record.manualHold = { vin:record.vin, state:'active', version:1, ownerStore:'Howell', canManage:true, enabled:true, customerLabel:'Synthetic manual AB', expectedDeliveryDate:'2026-09-02', note:'Synthetic manual note', updatedAt:null }
    record.dealerMail = { ...record.dealerMail, hasActiveHold:true, canViewEvidence:true, activeRecordCount:2 }
    record.holdEvidence = [{ id:'synthetic-primary', position:'primary', salesperson:'Synthetic imported salesperson', expectedDeliveryDate:'2026-08-31' }, { id:'synthetic-backup', position:'backup' }]
    render(<VehicleWorkspace vehicle={record} homeStore={record.location.homeStore} onClose={vi.fn()} />)
    const summary = screen.getByRole('region', { name:'Vehicle operational summary' })
    const manual = within(summary).getByText('Manual hold', { exact:true }).parentElement!
    const imported = within(summary).getByText('DealerMail', { exact:true }).parentElement!
    expect(manual).toHaveTextContent('Inventory Flow')
    expect(manual).toHaveTextContent('Synthetic manual AB')
    expect(manual).toHaveTextContent('09/02/2026')
    expect(manual).not.toHaveTextContent('08/31/2026')
    expect(manual).not.toHaveTextContent('backup')
    expect(imported).toHaveTextContent('Synthetic imported salesperson')
    expect(imported).toHaveTextContent('08/31/2026')
    expect(imported).toHaveTextContent('1 backup hold')
    expect(imported).not.toHaveTextContent('Synthetic manual AB')
    expect(imported).not.toHaveTextContent('09/02/2026')
  })

  it('replaces an empty OEM placeholder with the full VIN-linked vAuto profile', () => {
    const complete = vehicle();
    complete.windowSticker = {
      dataState: 'incomplete',
      url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U',
    };
    const equipmentUrl = 'https://assets.cai-media-management.com/window-stickers/d09817fc-332f-45c1-9e7f-86f0a9e16153.jpg';
    complete.factoryEquipment = { dataState: 'current', url: equipmentUrl, isOriginalWindowSticker: false, packages: [], sections: [] };
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    expect(document.querySelector('[data-document-kind="window-sticker"]')).toBeNull();
    const equipment = document.querySelector('[data-document-kind="vauto-factory-equipment"]') as HTMLElement;
    expect(equipment).toHaveAttribute('data-original-window-sticker', 'false');
    expect(equipment).toHaveTextContent("Original window sticker unavailable. Showing this VIN's vAuto equipment profile.");
    expect(within(equipment).getByRole('link', { name: /Open equipment details/ })).toHaveAttribute('href', equipmentUrl);
    expect(document.querySelector('.vdp-record-vauto-supplement')).toBeNull();
    expect(equipment).toBeVisible();
  });

  it('keeps partial OEM facts visible beside the full vAuto fallback', () => {
    const complete = vehicle();
    complete.windowSticker = {
      dataState: 'incomplete',
      equipmentGroup: 'Partially captured OEM package',
      options: ['Captured OEM option'],
    };
    complete.factoryEquipment = {
      dataState: 'current',
      isOriginalWindowSticker: false,
      packages: [{ name: 'Additional vAuto package' }],
      sections: [],
    };
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const sticker = document.querySelector('[data-document-kind="window-sticker"]') as HTMLElement;
    const equipment = document.querySelector('[data-document-kind="vauto-factory-equipment"]') as HTMLElement;
    expect(sticker).toBeVisible();
    expect(sticker).toHaveTextContent('Partially captured OEM package');
    expect(sticker).toHaveTextContent('Captured OEM option');
    expect(equipment).toBeVisible();
    expect(equipment).toHaveTextContent('Additional vAuto package');
    expect(equipment).not.toHaveTextContent('Original window sticker unavailable');
  });

  it('keeps cached vAuto facts visible when neither source is currently usable', () => {
    const complete = vehicle();
    complete.windowSticker = { dataState: 'unavailable' };
    complete.factoryEquipment = {
      dataState: 'unavailable',
      isOriginalWindowSticker: false,
      packages: [{ name: 'Cached vAuto package' }],
      sections: [],
    };
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    expect(document.querySelector('[data-document-kind="window-sticker"]')).toBeNull();
    expect(document.querySelector('.vdp-record-vauto-supplement')).toBeNull();
    const equipment = document.querySelector('[data-document-kind="vauto-factory-equipment"]') as HTMLElement;
    expect(equipment).toBeVisible();
    expect(equipment).toHaveTextContent('Cached vAuto package');
    expect(equipment).toHaveTextContent('Original window sticker unavailable');
  });

  it('orders complete records by the working flow and moves keyboard focus to each named section', () => {
    const complete=vehicle();
    complete.fordOasis={dataState:'current',warrantyStartDate:'01-June-2026',openFieldServiceActions:[],warrantyCoverages:[],extendedCoverageExpirations:[]};
    complete.warrantyCheck={dataState:'current',mileageEntered:2052,autoCheck:null,fordOasis:{warrantyStartDate:'01-June-2026',monthsInService:3,coverages:[]}};
    complete.factoryEquipment={dataState:'current',isOriginalWindowSticker:false,packages:[{name:'Supplemental tow package',features:['Supplemental trailer camera']}],sections:[]};
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data"/>);
    const panel=screen.getByRole('region',{name:'Vehicle documents'});
    expect([...panel.querySelectorAll('[data-record-section]')].map(section=>section.getAttribute('data-record-section'))).toEqual(['autocheck','oasis','warranty','sticker','equipment']);
    const nav=within(panel).getByRole('navigation',{name:'Record sections'});
    expect(within(nav).getAllByRole('button').map(button=>button.textContent)).toEqual(['AutoCheck','OASIS','Warranty','Window sticker','Equipment']);
    const supplement=panel.querySelector<HTMLDetailsElement>('.vdp-record-vauto-supplement')!;
    expect(supplement).not.toBeNull();
    expect(supplement).not.toHaveAttribute('open');
    expect(within(supplement).getByText('Additional vAuto equipment')).toBeVisible();
    expect(within(supplement).getByText('Supplemental tow package')).not.toBeVisible();
    const scroll=panel.closest<HTMLElement>('.vdp-focus-scroll')!;
    const dialog=panel.closest<HTMLElement>('[role="dialog"]')!;
    Object.defineProperty(scroll,'getBoundingClientRect',{configurable:true,value:()=>new DOMRect(0,100,500,500)});
    dialog.scrollTop=75;
    const pageTop=window.scrollY;
    const documentTop=document.documentElement.scrollTop;
    const pageScrollTo=vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
    const pageScrollBy=vi.spyOn(window,'scrollBy').mockImplementation(()=>{});
    try {
      for (const [index,[id,label]] of [['autocheck','AutoCheck'],['oasis','OASIS'],['warranty','Warranty'],['sticker','Window sticker'],['equipment','Equipment']].entries()) {
        const section=panel.querySelector<HTMLElement>(`[data-record-section="${id}"]`)!;
        Object.defineProperty(section,'getBoundingClientRect',{configurable:true,value:()=>new DOMRect(0,350+index*100,300,200)});
        scroll.scrollTop=120;
        const focus=vi.spyOn(section,'focus');
        fireEvent.click(within(nav).getByRole('button',{name:label}));
        if (id === 'equipment') {
          expect(supplement).toHaveAttribute('open');
          expect(within(supplement).getByText('Supplemental tow package')).toBeVisible();
          expect(within(supplement).getByText('Supplemental trailer camera')).toBeVisible();
        }
        expect(section).toHaveFocus();
        expect(focus).toHaveBeenCalledWith({preventScroll:true});
        expect(scroll.scrollTop).toBe(360+index*100);
        expect(dialog.scrollTop).toBe(75);
        expect(window.scrollY).toBe(pageTop);
        expect(document.documentElement.scrollTop).toBe(documentTop);
      }
      expect(pageScrollTo).not.toHaveBeenCalled();
      expect(pageScrollBy).not.toHaveBeenCalled();
    } finally {
      pageScrollTo.mockRestore();
      pageScrollBy.mockRestore();
    }
  });

  it('keeps an odometer discrepancy visible even when its detail also includes a last reading', () => {
    const complete=vehicle();
    complete.autoCheckReport={...complete.autoCheckReport!,checks:[{label:'Odometer Check',status:'No Issue',detail:'Odometer discrepancy reported; Last reported odometer: 100,000 (09/01/2026)'}]};
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data"/>);
    const history=document.querySelector('[data-document-kind="autocheck"]') as HTMLElement;
    const checks=within(history).getByLabelText('AutoCheck at-a-glance results');
    expect(checks).toHaveTextContent('Odometer discrepancy reported');
    expect(checks.querySelector('[data-result-tone="review"]')).not.toBeNull();
    expect(history.querySelector('.vdp-record-source-details')).not.toBeVisible();
  });

  it('shows concise history and sticker facts without exposing source diagnostics', () => {
    const complete = vehicle();
    complete.autoCheckReport = { ...complete.autoCheckReport!, usage: 'Personal / lease', ownerCount: 2, vehicleClass: 'SUV', assemblyCountry: 'USA', estimatedInServiceDate: '2025-05-01', checks: Array.from({ length: 7 }, (_, index) => ({ label: `History check ${index + 1}`, status: `Captured result ${index + 1}`, detail: `Source detail ${index + 1}` })) };
    complete.windowSticker = { ...complete.windowSticker!, standardEquipment: ['Factory line one', 'Factory line two'], warranty: ['3 years / 36,000 miles'], exteriorColor: 'Gray', interiorColor: 'Black' };
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const panel = screen.getByRole('region', { name: 'Vehicle documents' });
    const history = panel.querySelector('[data-document-kind="autocheck"]') as HTMLElement;
    const summary = within(history).getByLabelText('AutoCheck summary');
    expect(summary).toHaveTextContent('Owners2');
    for (const value of ['Personal / lease', '2,052 mi', '05/23/2026']) expect(history).toHaveTextContent(value);
    const checks = within(history).getByLabelText('AutoCheck at-a-glance results');
    expect(within(checks).getByText('History check 7')).toBeVisible();
    expect(within(checks).getByText('Captured result 7 · Source detail 7')).toBeVisible();
    expect(within(history).getByText('SUV')).not.toBeVisible();
    expect(history.querySelector('.vdp-record-source-details')).not.toBeVisible();
    const source = within(history).getByRole('link', { name: /Open AutoCheck report/ });
    expect(source).toHaveTextContent('Open report');
    expect(source.compareDocumentPosition(checks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const sticker = panel.querySelector('[data-document-kind="window-sticker"]') as HTMLElement;
    expect(sticker.querySelector('details')).not.toBeVisible();
    for (const value of ['Active Comfort Package', '20-inch wheels', 'Factory line one', 'Factory line two', '3 years / 36,000 miles', '49,480']) expect(within(sticker).getByText(value)).toBeVisible();
    expect(sticker).not.toHaveTextContent('5,100');
    expect(sticker).not.toHaveTextContent('1,795');
    expect(within(sticker).queryByText(/confirm currency/)).not.toBeInTheDocument();
  });

  it('keeps important history findings visible and expands the remaining checks on demand', () => {
    const complete = vehicle();
    complete.autoCheckReport!.checks = [
      { label: 'State title brand', status: 'Clean' },
      { label: 'Accident / damage', status: 'No Issue', detail: 'No accidents or damage reported' },
      { label: 'Open recall check', status: 'No open recalls' },
      { label: 'Odometer check', status: 'No Issue' },
      { label: 'Additional history', status: 'Events reported', detail: 'Corrected title' },
    ];
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const history = document.querySelector('[data-document-kind="autocheck"]') as HTMLElement;
    const highlights = within(history).getByLabelText('AutoCheck at-a-glance results');
    expect(within(highlights).getByText('Clean')).toBeVisible();
    expect(within(highlights).getByText('No accidents or damage reported')).toBeVisible();
    expect(within(highlights).getByText('No open recalls')).toBeVisible();
    expect(within(highlights).getByText('Odometer')).toBeVisible();
    expect(within(highlights).queryByText('Events reported · Corrected title')).not.toBeInTheDocument();
    const more = history.querySelector('.vdp-history-more') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    const additional = within(history).getByLabelText('Additional AutoCheck results');
    expect(within(additional).getByText('Events reported · Corrected title')).not.toBeVisible();
    // jsdom does not implement the native summary click default action.
    more.open = true;
    fireEvent(more, new Event('toggle'));
    expect(within(additional).getByText('Events reported · Corrected title')).toBeVisible();
  });

  it('does not claim original links exist when only a failed capture is available', () => {
    const missing = vehicle(false);
    missing.autoCheckReport = { dataState: 'incomplete' };
    missing.windowSticker = { dataState: 'incomplete', sourceMessage: 'The source did not publish a document for this VIN.' };
    render(<VehicleWorkspace vehicle={missing} homeStore={missing.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const panel = screen.getByRole('region', { name: 'Vehicle documents' });
    expect(within(panel).queryByRole('link', { name: /Open (AutoCheck report|window sticker)/ })).not.toBeInTheDocument();
    expect(within(panel).queryByText(/official.*link is available/i)).not.toBeInTheDocument();
    expect(within(panel).queryByText('The source did not publish a document for this VIN.')).not.toBeInTheDocument();
    expect(within(panel).getAllByText('Document unavailable').length).toBeGreaterThan(0);
  });

  it('shows a vAuto history capture as available evidence without inventing a report link', () => {
    const captured = vehicle(false);
    captured.autoCheckReport = {
      dataState: 'current', accessMethod: 'vauto', score: 91, ownerCount: 1,
      sourceLabel: 'Experian AutoCheck report captured through vAuto for this VIN',
      capturedAt: '2026-09-21T20:45:00.000Z', checks: [{ label: 'Accident / damage', status: 'No accidents reported' }],
    };
    render(<VehicleWorkspace vehicle={captured} homeStore={captured.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const card = document.querySelector('[data-document-kind="autocheck"]') as HTMLElement;
    expect(card).toHaveAttribute('data-link-state', 'captured');
    expect(within(card).getByText('Captured via vAuto')).toBeVisible();
    expect(within(card).queryByRole('link', { name: /Open AutoCheck report/ })).not.toBeInTheDocument();
    expect(within(card).queryByText('Document unavailable')).not.toBeInTheDocument();
    expect(card.querySelector('details')).not.toBeVisible();
  });

  it('shows captured OASIS coverage without a competing AutoCheck estimate', () => {
    const complete = vehicle(false);
    const coverage = { type: 'Powertrain', termText: '5 years / 60,000 miles', remainingMilesText: '57,948 miles', remainingTimeText: '4 years', status: 'ACTIVE' as const, note: 'Ford source note' };
    complete.warrantyCheck = { dataState: 'current', capturedAt: '2026-09-12T15:00:00.000Z', mileageEntered: 2052, mileageSource: 'Entered dealer odometer', fordOasis: { warrantyStartDate: '01-June-2026', monthsInService: 3, coverages: [coverage] }, autoCheck: { inServiceDate: '02-June-2026', inServiceAgeMonths: 2, defaultMileage: 2011, coverages: [{ ...coverage, status: 'EXPIRED', note: 'Experian source note', remainingTimeText: 'Expired by time' }] } };
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const card = document.querySelector('[data-document-kind="warranty-check"]') as HTMLElement;
    expect(card.querySelector('details')).not.toBeVisible();
    expect(within(card).getByText('Mileage source: Entered dealer odometer')).not.toBeVisible();
    expect(within(card).getByRole('table', { name: 'Remaining factory warranty by coverage' })).toBeVisible();
    expect(within(card).getByRole('link', { name: /Open OASIS coverage lookup/ })).toHaveAttribute('href', 'https://www.fordtechservice.dealerconnection.com/oasis/Index?vin=TESTDATASYN000001');
    expect(within(card).queryByRole('region', { name: 'AutoCheck estimate' })).not.toBeInTheDocument();
    expect(within(card).getByRole('table', { name: 'Remaining factory warranty by coverage' })).not.toHaveTextContent('Ford source note');
    expect(within(card).queryByRole('table', { name: 'AutoCheck warranty estimate', hidden: true })).not.toBeInTheDocument();
    expect(complete.warrantyCheck.autoCheck!.inServiceDate).toBe('02-June-2026');
  });

  it('shows kilometre source text in US miles across the captured warranty, OASIS and sticker records', () => {
    const metric = vehicle(false);
    const coverage = { type: 'Powertrain', termText: '60 months / 100,000 km', remainingMilesText: '40,000 km', remainingTimeText: '4 years', status: 'ACTIVE' as const };
    metric.warrantyCheck = { dataState: 'current', capturedAt: '2026-09-12T15:00:00.000Z', mileageEntered: 2052, fordOasis: { warrantyStartDate: '01-June-2026', monthsInService: 3, coverages: [coverage] }, autoCheck: null };
    metric.fordOasis = { dataState: 'current', capturedAt: '2026-09-11T14:00:00Z', openActionsCaptured: true, openFieldServiceActions: [], warrantyCoverages: [{ type: 'Powertrain', description: '60 months/100,000 km' }], extendedCoverageExpirations: ['ESP to 160,000 km'] };
    metric.windowSticker = { dataState: 'current', originalMarket: 'Canada', engine: '2.0L EcoBoost · 9.8 L/100 km', warranty: ['3 years / 60,000 km'], standardEquipment: ['Combined 9.8 L/100 km'], options: ['Extended range tank — 900 km'] };
    metric.autoCheckReport = { dataState: 'current', usage: 'Personal · 148 000 km reported', vehicleClass: 'Light truck · 3,500 km rated', checks: [{ label: 'Odometer check', status: 'Records found', detail: 'Highest reading 148,000 km' }] };
    render(<VehicleWorkspace vehicle={metric} homeStore={metric.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const panel = screen.getByRole('region', { name: 'Vehicle documents' });
    const table = within(panel).getByRole('table', { name: 'Remaining factory warranty by coverage' });
    expect(table).toHaveTextContent('60 months / 62,137 mi (100,000 km in the source)');
    expect(table).toHaveTextContent('24,855 mi (40,000 km in the source)');
    expect(panel).toHaveTextContent('60 months/62,137 mi (100,000 km in the source)');
    expect(panel).toHaveTextContent('ESP to 99,419 mi (160,000 km in the source)');
    expect(panel).toHaveTextContent('3 years / 37,282 mi (60,000 km in the source)');
    expect(panel).toHaveTextContent('Combined 24 mpg (9.8 L/100 km in the source)');
    expect(panel).toHaveTextContent('Personal · 91,963 mi reported (148,000 km in the source)');
    expect(panel).toHaveTextContent('Highest reading 91,963 mi (148,000 km in the source)');
    expect(panel).toHaveTextContent('Extended range tank — 559 mi (900 km in the source)');
    expect(panel).toHaveTextContent('2.0L EcoBoost · 24 mpg (9.8 L/100 km in the source)');
    expect(panel).toHaveTextContent('Light truck · 2,175 mi rated (3,500 km in the source)');
    // The only kilometre figures left are the source evidence in the qualifiers.
    expect((panel.textContent ?? '').replace(/\([^)]* in the source\)/g, '')).not.toMatch(/\d[\d,.\s]*(?:km|kilomet)/i);
  });

  it('does not interpret an incomplete empty OASIS capture as a clear recall result', () => {
    const incomplete = vehicle(false);
    incomplete.fordOasis = { dataState: 'incomplete', openFieldServiceActions: [], warrantyCoverages: [], extendedCoverageExpirations: [] };
    render(<VehicleWorkspace vehicle={incomplete} homeStore={incomplete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const panel = screen.getByRole('region', { name: 'Vehicle documents' });
    expect(within(panel).getByRole('status', { name: 'Open field service actions' })).toHaveTextContent('Service action result not captured');
    expect(within(panel).queryByText('No open service actions listed')).not.toBeInTheDocument();
  });

  it.each([undefined, false])('keeps dated legacy/default empty OASIS actions with flag %s unconfirmed', openActionsCaptured => {
    const legacy = vehicle(false);
    legacy.fordOasis = { dataState: 'current', capturedAt: '2026-09-11T14:00:00Z', openActionsCaptured, openFieldServiceActions: [], warrantyCoverages: [], extendedCoverageExpirations: [] };
    render(<VehicleWorkspace vehicle={legacy} homeStore={legacy.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const panel = screen.getByRole('region', { name: 'Vehicle documents' });
    expect(within(panel).getByRole('status', { name: 'Open field service actions' })).toHaveTextContent('Service action result not captured');
    expect(within(panel).queryByText('No open service actions listed')).not.toBeInTheDocument();
  });

  it('keeps Canadian sticker pricing legible without source diagnostics', async () => {
    const canadian = vehicle();
    canadian.windowSticker = { ...canadian.windowSticker!, originalMarket: 'Canada', pricingCurrency: 'CAD', pricingCurrencyEvidence: 'Canadian original sticker; amounts retained without conversion' };
    render(<VehicleWorkspace vehicle={canadian} homeStore={{ id: 'howell', name: 'Howell' }} onClose={vi.fn()} />);
    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText(/CAD\s49,480/)).toBeInTheDocument();
    expect(within(panel!).getByText('Canada window sticker')).toBeInTheDocument();
    expect(within(panel!).queryByText(/amounts retained without conversion/i)).not.toBeInTheDocument();
    expect(within(panel!).queryByText('$49,480')).not.toBeInTheDocument();
  });

  it('shows VIN-specific links and truthful parsed facts as a separate source panel', async () => {
    render(
      <VehicleWorkspace
        vehicle={vehicle()}
        homeStore={{ id: 'howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    );

    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    if (!panel) return;
    const autoCheckLink = within(panel).getByRole('link', { name: /Open AutoCheck report for 2026 Ford Explorer Active/i });
    const stickerLink = within(panel).getByRole('link', { name: /Open window sticker for 2026 Ford Explorer Active/i });
    expect(autoCheckLink).toHaveAttribute('href', 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token');
    expect(stickerLink).toHaveAttribute('href', 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U');
    expect(autoCheckLink).toHaveAttribute('data-read-only', 'true');
    expect(stickerLink).toHaveAttribute('data-read-only', 'true');
    expect(within(panel).getByRole('img', { name: 'AutoCheck by Experian' })).toHaveAttribute(
      'src',
      '/resource-brands/autocheck.svg',
    );
    expect(within(panel).getByRole('img', { name: 'Ford factory window sticker' })).toBeInTheDocument();
    expect(within(panel).getByText('92')).toBeInTheDocument();
    expect(within(panel).getByText('Typical 89–94')).toBeVisible();
    expect(within(panel).getByText('Equipment Group 200A')).toBeInTheDocument();
    expect(within(panel).getByText('Active Comfort Package')).toBeInTheDocument();
    expect(within(panel).getByText('Records don’t confirm availability.')).toBeInTheDocument();
    expect(within(panel).queryByText(/equipment verified|no issues found/i)).not.toBeInTheDocument();
  });

  it('does not add a document panel when no VIN-specific resource was published', async () => {
    render(
      <VehicleWorkspace
        vehicle={vehicle(false)}
        homeStore={{ id: 'howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    );

    expect(await openVehicleDocuments()).not.toBeInTheDocument();
  });

  it('shows only the failed resource card when its source exists without a usable link', async () => {
    const failedVehicle = vehicle(false);
    failedVehicle.autoCheckReport = { dataState: 'incomplete', score: 92 };
    render(
      <VehicleWorkspace
        vehicle={failedVehicle}
        homeStore={{ id: 'howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    );

    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    if (!panel) return;
    expect(within(panel).getByText('Document unavailable')).toBeInTheDocument();
    expect(within(panel).queryByText('Factory window sticker')).not.toBeInTheDocument();
  });

  it('rejects non-HTTPS document links instead of rendering an unsafe launcher', async () => {
    const unsafeVehicle = vehicle();
    unsafeVehicle.autoCheckReport = {
      ...unsafeVehicle.autoCheckReport!,
      url: 'javascript:alert(1)',
    };
    render(
      <VehicleWorkspace
        vehicle={unsafeVehicle}
        homeStore={{ id: 'howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    );

    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    if (!panel) return;
    expect(within(panel).getByText('Document unavailable')).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: /Open AutoCheck report/i })).not.toBeInTheDocument();
  });

  it('shows CRM-capable vAuto equipment as equipment details', async () => {
    const fallbackVehicle = vehicle(false);
    fallbackVehicle.publicListing = { dataState: 'current', isListed: false };
    fallbackVehicle.factoryEquipment = {
      dataState: 'current',
      isOriginalWindowSticker: false,
      url: 'https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg',
      vehicleDescription: '2024 Chevrolet Silverado 1500 RST Crew Cab Short Bed 1SP',
      totalMsrp: 66360,
      packages: [{ name: 'Safety Package', code: 'PQB', price: 0, features: ['Blind Spot Monitor', 'Rear Cross Traffic Alert'] }],
      sections: [{ name: 'Technology', items: [{ label: 'Aerial View Display System', price: 250 }] }],
      disclaimer: 'Provided for information purposes only, this is not the actual Monroney label.',
    };

    render(
      <VehicleWorkspace
        vehicle={fallbackVehicle}
        homeStore={{ id: 'howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    );

    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    if (!panel) return;
    expect(within(panel).getByText('vAuto factory-equipment profile')).toBeInTheDocument();
    expect(within(panel).queryByText(/Informational equipment label/i)).not.toBeInTheDocument();
    expect(within(panel).queryByText('66,360')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Base MSRP')).not.toBeInTheDocument();
    expect(within(panel).getByText(/this is not the actual Monroney label/i)).not.toBeVisible();
    expect(within(panel).getByRole('link', { name: /Open equipment details/i })).toHaveAttribute(
      'href',
      fallbackVehicle.factoryEquipment.url,
    );
    expect(within(panel).queryByText('Factory window sticker')).not.toBeInTheDocument();
    const card = panel.querySelector('[data-document-kind="vauto-factory-equipment"]') as HTMLElement;
    expect(panel.querySelector('.vdp-record-vauto-supplement')).toBeNull();
    expect(card).toBeVisible();
    expect(card.querySelector('.vdp-record-source-details')).not.toBeVisible();
    expect(within(card).queryByText('66,360')).not.toBeInTheDocument();
    for (const value of ['Safety Package (PQB)', 'Blind Spot Monitor · Rear Cross Traffic Alert', 'Aerial View Display System', '0', '250']) expect(within(card).getByText(value)).toBeVisible();
    expect(within(card).queryByText(/Verify installed equipment and the currency of any reference prices\./)).not.toBeInTheDocument();
  });

  it('shows Ford OASIS open recalls first with dates exactly as printed', async () => {
    const oasisVehicle = vehicle(false);
    oasisVehicle.fordOasis = {
      dataState: 'current',
      capturedAt: '2026-09-12T15:00:00.000Z',
      vehicleDescription: '2026 Explorer',
      versionSeries: 'SERIES 00',
      buildDate: '01-May-2026',
      warrantyStartDate: '01-June-2026',
      releaseDate: '02-May-2026',
      monthsInService: 3,
      saleMileage: 12,
      openFieldServiceActions: [
        { code: '00T01', description: 'Synthetic field service action' },
        { code: '25S66', description: null },
      ],
      warrantyCoverages: [{ type: 'Bumper-to-Bumper' }, { type: 'Powertrain' }],
      extendedCoverageExpirations: ['01/01/2029'],
    };

    render(
      <VehicleWorkspace
        vehicle={oasisVehicle}
        homeStore={{ id: 'howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    );

    const flag = screen.getByRole('button', { name: /At least 2 open service actions · result incomplete; review vehicle records/i });
    expect(flag).toHaveTextContent('2 open service actions');

    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    if (!panel) return;
    const card = panel.querySelector('[data-document-kind="ford-oasis"]');
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute('data-open-recall-count', '2');
    expect(card!.querySelector('details')).not.toBeVisible();
    expect(within(card as HTMLElement).getByRole('list', { name: 'Ford warranty coverages' })).toBeVisible();
    expect(within(card as HTMLElement).getByRole('list', { name: 'Extended service plan expirations' })).toBeVisible();
    expect(within(panel).getByText('Ford OASIS vehicle report')).toBeInTheDocument();
    const oasisMark = within(panel).getByRole('img', { name: 'Ford OASIS vehicle report' });
    expect(oasisMark.querySelector('img')).toHaveAttribute('src', '/resource-brands/ford.svg');
    expect(within(panel).getByRole('status', { name: 'Open field service actions' })).toHaveTextContent(
      '2 open service actions',
    );
    const recallList = within(panel).getByRole('list', { name: 'Open field service action details' });
    expect(within(recallList).getByText('00T01')).toBeInTheDocument();
    expect(within(recallList).getByText('Synthetic field service action')).toBeInTheDocument();
    expect(within(recallList).getByText('25S66')).toBeInTheDocument();
    expect(within(panel).getByText('06/01/2026')).toBeInTheDocument();
    expect(within(panel).getByText('05/01/2026')).toBeInTheDocument();
    expect(within(panel).getByText('3 months')).toBeInTheDocument();
    expect(within(panel).getByText('12 mi')).toBeInTheDocument();
    expect(within(panel).getByText('01/01/2029')).toBeInTheDocument();
    const oasisLink = within(panel).getByRole('link', { name: /Open Ford OASIS lookup for 2026 Ford Explorer Active/i });
    expect(oasisLink).toHaveAttribute('href', 'https://www.fordtechservice.dealerconnection.com/oasis/Index?vin=TESTDATASYN000001');
    expect(oasisLink).toHaveAttribute('data-read-only', 'true');
  });

  it('shows decoded OASIS descriptions as plain text without mutating captured evidence', async () => {
    const oasisVehicle = vehicle(false);
    const encoded = 'REAR AXLE &#x25B4; &amp; &lt;img src=x onerror=alert(1)&gt;';
    oasisVehicle.fordOasis = {
      dataState: 'current', capturedAt: '2026-09-01',
      openFieldServiceActions: [{ code: 'TEST-26A', description: encoded }],
      warrantyCoverages: [{ type: 'Powertrain', description: '5 years &amp; 60,000 miles' }],
      extendedCoverageExpirations: [],
    };
    render(<VehicleWorkspace vehicle={oasisVehicle} homeStore={{ id: 'howell', name: 'Howell' }} onClose={vi.fn()} />);
    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    if (!panel) return;
    const list = within(panel).getByRole('list', { name: 'Open field service action details' });
    expect(list).toHaveTextContent('REAR AXLE ▴ & <img src=x onerror=alert(1)>');
    expect(list.querySelector('img')).toBeNull();
    expect(list.querySelector('[onerror]')).toBeNull();
    expect(within(panel).getByRole('list', { name: 'Ford warranty coverages' })).toHaveTextContent('5 years & 60,000 miles');
    expect(oasisVehicle.fordOasis.openFieldServiceActions![0].description).toBe(encoded);
  });

  it('states plainly when OASIS lists no open recalls and never flags the overview', async () => {
    const clearVehicle = vehicle(false);
    clearVehicle.fordOasis = {
      dataState: 'stale',
      capturedAt: '2026-09-11T15:00:00.000Z',
      warrantyStartDate: '01-June-2026',
      openActionsCaptured: true,
      openFieldServiceActions: [],
      warrantyCoverages: [],
      extendedCoverageExpirations: [],
    };

    render(
      <VehicleWorkspace
        vehicle={clearVehicle}
        homeStore={{ id: 'howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /review vehicle records/i })).not.toBeInTheDocument();
    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    if (!panel) return;
    expect(within(panel).getByRole('status', { name: 'Open field service actions' })).toHaveTextContent(
      'No open service actions listed',
    );
    expect(within(panel).queryByRole('list', { name: 'Open field service action details' })).not.toBeInTheDocument();
    expect(within(panel).queryByText('Update delayed')).not.toBeInTheDocument();
  });
});
