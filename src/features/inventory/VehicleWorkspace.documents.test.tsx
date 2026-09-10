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
      'https://www.autocheck.com/reportservice/common/img/autocheck-logo.svg',
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
    expect(within(panel).getByLabelText('AutoCheck report unavailable')).toBeInTheDocument();
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
    expect(within(panel).getByLabelText('AutoCheck report unavailable')).toBeInTheDocument();
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
      packages: [{ name: 'Safety Package', code: 'PQB', features: ['Blind Spot Monitor'] }],
      sections: [{ name: 'Technology', items: [{ label: 'Aerial View Display System' }] }],
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
    expect(within(panel).getByText('$66,360')).toBeInTheDocument();
    expect(within(panel).getByText(/this is not the actual Monroney label/i)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Open vAuto factory-equipment profile/i })).toHaveAttribute(
      'href',
      fallbackVehicle.factoryEquipment.url,
    );
    expect(within(panel).queryByText('Factory window sticker')).not.toBeInTheDocument();
  });
});
