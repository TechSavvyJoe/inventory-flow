import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleWorkspace } from './VehicleWorkspace';
import type { InventoryVehicle } from './types';

afterEach(cleanup);

function vehicle(withDocuments = true): InventoryVehicle {
  return {
    id: '1FMUK8DHXTGB76992',
    vin: '1FMUK8DHXTGB76992',
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
  it('exposes every captured history finding and sticker line without nested disclosure controls', () => {
    const complete = vehicle();
    complete.autoCheckReport = { ...complete.autoCheckReport!, usage: 'Personal / lease', ownerCount: 2, vehicleClass: 'SUV', assemblyCountry: 'USA', estimatedInServiceDate: '2025-05-01', checks: Array.from({ length: 7 }, (_, index) => ({ label: `History check ${index + 1}`, status: `Captured result ${index + 1}`, detail: `Source detail ${index + 1}` })) };
    complete.windowSticker = { ...complete.windowSticker!, standardEquipment: ['Factory line one', 'Factory line two'], warranty: ['3 years / 36,000 miles'], exteriorColor: 'Gray', interiorColor: 'Black' };
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const panel = screen.getByRole('region', { name: 'Vehicle documents' });
    const history = panel.querySelector('[data-document-kind="autocheck"]') as HTMLElement;
    expect(history.querySelector('details')).toBeNull();
    for (const value of ['2 owners', 'Personal / lease', '2,052 mi · May 23, 2026', 'SUV', 'USA', 'May 1, 2025', 'History check 7', 'Captured result 7 · Source detail 7']) expect(within(history).getByText(value)).toBeVisible();
    const source = within(history).getByRole('link', { name: /Open AutoCheck report/ });
    expect(source.compareDocumentPosition(within(history).getByText('History check 7')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const sticker = panel.querySelector('[data-document-kind="window-sticker"]') as HTMLElement;
    expect(sticker.querySelector('details')).toBeNull();
    for (const value of ['Active Comfort Package', '20-inch wheels', 'Factory line one', 'Factory line two', '3 years / 36,000 miles', '42,585 (original sticker currency; verify)', '5,100 (original sticker currency; verify)', '1,795 (original sticker currency; verify)', '49,480 (original sticker currency; verify)']) expect(within(sticker).getByText(value)).toBeVisible();
  });

  it('does not claim original links exist when only a failed capture is available', () => {
    const missing = vehicle(false);
    missing.autoCheckReport = { dataState: 'incomplete' };
    missing.windowSticker = { dataState: 'incomplete', sourceMessage: 'The source did not publish a document for this VIN.' };
    render(<VehicleWorkspace vehicle={missing} homeStore={missing.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const panel = screen.getByRole('region', { name: 'Vehicle documents' });
    expect(within(panel).queryByRole('link', { name: /Open (AutoCheck report|window sticker)/ })).not.toBeInTheDocument();
    expect(within(panel).queryByText(/official.*link is available/i)).not.toBeInTheDocument();
    expect(within(panel).getByText('The source did not publish a document for this VIN.')).toBeVisible();
    expect(within(panel).getByLabelText('Original window sticker link not captured')).toBeVisible();
  });

  it('shows captured OASIS coverage and the separate AutoCheck estimate with all supporting fields', () => {
    const complete = vehicle(false);
    const coverage = { type: 'Powertrain', termText: '5 years / 60,000 miles', remainingMilesText: '57,948 miles', remainingTimeText: '4 years', status: 'ACTIVE' as const, note: 'Ford source note' };
    complete.warrantyCheck = { dataState: 'current', capturedAt: '2026-09-12T14:52:37.597Z', mileageEntered: 2052, mileageSource: 'Entered dealer odometer', fordOasis: { warrantyStartDate: '09-June-2026', monthsInService: 3, coverages: [coverage] }, autoCheck: { inServiceDate: '11-June-2026', inServiceAgeMonths: 2, defaultMileage: 2011, coverages: [{ ...coverage, status: 'EXPIRED', note: 'Experian source note', remainingTimeText: 'Expired by time' }] } };
    render(<VehicleWorkspace vehicle={complete} homeStore={complete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const card = document.querySelector('[data-document-kind="warranty-check"]') as HTMLElement;
    expect(card.querySelector('details')).toBeNull();
    expect(card).toHaveAttribute('data-warranty-source', 'ford-oasis');
    expect(within(card).getByText('Entered dealer odometer')).toBeVisible();
    expect(within(card).getByRole('link', { name: /Open OASIS coverage lookup/ })).toHaveAttribute('href', 'https://www.fordtechservice.dealerconnection.com/oasis/Index?vin=1FMUK8DHXTGB76992');
    const estimate = within(card).getByRole('region', { name: 'AutoCheck estimate' });
    for (const value of ['11-June-2026', '2 months', '2,011 mi', 'Experian source note', 'Expired by time', 'Expired']) expect(within(estimate).getByText(value)).toBeVisible();
    expect(within(estimate).getByText(/Ford OASIS factory record above takes precedence/)).toBeVisible();
    expect(within(card).getByRole('table', { name: 'Remaining factory warranty by coverage' })).toHaveTextContent('Ford source note');
    expect(within(card).getByRole('table', { name: 'AutoCheck warranty estimate' })).toBeVisible();
  });

  it('does not interpret an incomplete empty OASIS capture as a clear recall result', () => {
    const incomplete = vehicle(false);
    incomplete.fordOasis = { dataState: 'incomplete', openFieldServiceActions: [], warrantyCoverages: [], extendedCoverageExpirations: [] };
    render(<VehicleWorkspace vehicle={incomplete} homeStore={incomplete.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const panel = screen.getByRole('region', { name: 'Vehicle documents' });
    expect(within(panel).getByRole('status', { name: 'Open recalls and field service actions' })).toHaveTextContent('No recall or field service action findings captured');
    expect(within(panel).queryByText('No open recalls or field service actions listed')).not.toBeInTheDocument();
  });

  it.each([undefined, false])('keeps dated legacy/default empty OASIS actions with flag %s unconfirmed', openActionsCaptured => {
    const legacy = vehicle(false);
    legacy.fordOasis = { dataState: 'current', capturedAt: '2026-09-11T14:00:00Z', openActionsCaptured, openFieldServiceActions: [], warrantyCoverages: [], extendedCoverageExpirations: [] };
    render(<VehicleWorkspace vehicle={legacy} homeStore={legacy.location.homeStore} onClose={vi.fn()} initialTab="data" />);
    const panel = screen.getByRole('region', { name: 'Vehicle documents' });
    expect(within(panel).getByRole('status', { name: 'Open recalls and field service actions' })).toHaveTextContent('No recall or field service action findings captured');
    expect(within(panel).queryByText('No open recalls or field service actions listed')).not.toBeInTheDocument();
  });

  it('labels Canadian original document pricing and preserves its raw market evidence', async () => {
    const canadian = vehicle();
    canadian.windowSticker = { ...canadian.windowSticker!, originalMarket: 'Canada', pricingCurrency: 'CAD', pricingCurrencyEvidence: 'Canadian original sticker; amounts retained without conversion' };
    render(<VehicleWorkspace vehicle={canadian} homeStore={{ id: 'howell', name: 'Howell' }} onClose={vi.fn()} />);
    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText(/CAD\s49,480/)).toBeInTheDocument();
    expect(within(panel!).getByText(/Original market: Canada/)).toHaveTextContent('amounts retained without conversion');
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
    expect(within(panel).getByText('89–94')).toBeInTheDocument();
    expect(within(panel).getByText('Equipment Group 200A')).toBeInTheDocument();
    expect(within(panel).getByText('Active Comfort Package')).toBeInTheDocument();
    expect(within(panel).getByText(/Documents are reference sources—not availability signals/i)).toBeInTheDocument();
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
    expect(within(panel).getByLabelText('Original AutoCheck report link not captured')).toBeInTheDocument();
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
    expect(within(panel).getByLabelText('Original AutoCheck report link not captured')).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: /Open AutoCheck report/i })).not.toBeInTheDocument();
  });

  it('shows a CRM-capable vAuto fallback as informational equipment, never as an original sticker', async () => {
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
    expect(within(panel).getByText(/Informational equipment label—not an original window sticker/i)).toBeInTheDocument();
    expect(within(panel).getByText('66,360 · currency not captured')).toBeInTheDocument();
    expect(within(panel).getByText(/this is not the actual Monroney label/i)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Open vAuto factory-equipment profile/i })).toHaveAttribute(
      'href',
      fallbackVehicle.factoryEquipment.url,
    );
    expect(within(panel).queryByText('Factory window sticker')).not.toBeInTheDocument();
    const card = panel.querySelector('[data-document-kind="vauto-factory-equipment"]') as HTMLElement;
    expect(card.querySelector('details')).toBeNull();
    for (const value of ['Safety Package (PQB)', 'Blind Spot Monitor · Rear Cross Traffic Alert', 'Aerial View Display System', '0 · currency not captured', '250 · currency not captured']) expect(within(card).getByText(value)).toBeVisible();
  });

  it('shows Ford OASIS open recalls first with dates exactly as printed', async () => {
    const oasisVehicle = vehicle(false);
    oasisVehicle.fordOasis = {
      dataState: 'current',
      capturedAt: '2026-09-12T14:52:37.597Z',
      vehicleDescription: '2026 Explorer',
      versionSeries: 'SERIES 10',
      buildDate: '11-May-2026',
      warrantyStartDate: '09-June-2026',
      releaseDate: '12-May-2026',
      monthsInService: 3,
      saleMileage: 12,
      openFieldServiceActions: [
        { code: '24N08', description: 'DRIVERS SIDE SEAT BUCKLE REPLACEMENT' },
        { code: '25S66', description: null },
      ],
      warrantyCoverages: [{ type: 'Bumper-to-Bumper' }, { type: 'Powertrain' }],
      extendedCoverageExpirations: ['01/16/2029'],
    };

    render(
      <VehicleWorkspace
        vehicle={oasisVehicle}
        homeStore={{ id: 'howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    );

    const flag = screen.getByRole('button', { name: /2 open Ford recalls or field service actions; review vehicle records/i });
    expect(flag).toHaveTextContent('2 open recalls');

    const panel = await openVehicleDocuments();
    expect(panel).not.toBeNull();
    if (!panel) return;
    const card = panel.querySelector('[data-document-kind="ford-oasis"]');
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute('data-open-recall-count', '2');
    expect(card!.querySelector('details')).toBeNull();
    expect(within(card as HTMLElement).getByRole('list', { name: 'Ford warranty coverages' })).toBeVisible();
    expect(within(card as HTMLElement).getByRole('list', { name: 'Extended service plan expirations' })).toBeVisible();
    expect(within(panel).getByText('Ford OASIS vehicle report')).toBeInTheDocument();
    expect(within(panel).getByRole('status', { name: 'Open recalls and field service actions' })).toHaveTextContent(
      '2 open recalls / field service actions',
    );
    const recallList = within(panel).getByRole('list', { name: 'Open field service action details' });
    expect(within(recallList).getByText('24N08')).toBeInTheDocument();
    expect(within(recallList).getByText('DRIVERS SIDE SEAT BUCKLE REPLACEMENT')).toBeInTheDocument();
    expect(within(recallList).getByText('25S66')).toBeInTheDocument();
    expect(within(panel).getByText('09-June-2026')).toBeInTheDocument();
    expect(within(panel).getByText('11-May-2026')).toBeInTheDocument();
    expect(within(panel).getByText('3 months')).toBeInTheDocument();
    expect(within(panel).getByText('12 mi')).toBeInTheDocument();
    expect(within(panel).getByText('01/16/2029')).toBeInTheDocument();
    const oasisLink = within(panel).getByRole('link', { name: /Open Ford OASIS lookup for 2026 Ford Explorer Active/i });
    expect(oasisLink).toHaveAttribute('href', 'https://www.fordtechservice.dealerconnection.com/oasis/Index?vin=1FMUK8DHXTGB76992');
    expect(oasisLink).toHaveAttribute('data-read-only', 'true');
  });

  it('states plainly when OASIS lists no open recalls and never flags the overview', async () => {
    const clearVehicle = vehicle(false);
    clearVehicle.fordOasis = {
      dataState: 'stale',
      capturedAt: '2026-09-11T14:52:37.597Z',
      warrantyStartDate: '09-June-2026',
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
    expect(within(panel).getByRole('status', { name: 'Open recalls and field service actions' })).toHaveTextContent(
      'No open recalls or field service actions listed',
    );
    expect(within(panel).queryByRole('list', { name: 'Open field service action details' })).not.toBeInTheDocument();
    expect(within(panel).getByText('Update delayed')).toBeInTheDocument();
  });
});
