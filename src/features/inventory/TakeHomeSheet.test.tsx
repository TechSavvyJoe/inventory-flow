import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleWorkspace } from './VehicleWorkspace';
import { TakeHomeSheetContent, takeHomeModel } from './TakeHomeSheet';
import type { InventoryVehicle } from './types';

afterEach(cleanup);

function vehicle(): InventoryVehicle {
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
    certified: true,
    exteriorColor: 'Carbonized Gray Metallic',
    interiorColor: 'Dark Space Gray',
    engine: '2.3L EcoBoost',
    transmission: '10-speed automatic',
    dealerComments: 'Synthetic description.',
    features: ['Ford Co-Pilot360', 'Apple CarPlay', 'Heated front seats'],
    publicListing: { dataState: 'current', isListed: true, listingUrl: 'https://www.bobmaxeyfordhowell.com/used-Howell-2026-Ford-Explorer' },
    dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
    dealerMail: { dataState: 'current', hasActiveHold: true, position: 'primary', canViewEvidence: true },
    holdEvidence: [{ id: 'hold-1', position: 'primary', salesperson: 'Demo Salesperson', customerOrReason: 'Customer appointment', dataState: 'current' }],
    location: {
      homeStore: { id: 'howell', name: 'Howell' },
      appConfirmedLocation: 'Fowlerville',
      appConfirmedStore: { id: 'fowlerville', name: 'Fowlerville' },
      custodian: 'Demo Driver',
    },
    movement: { state: 'in_transit', requestId: 'transfer-1', custodian: 'Demo Driver', nextAction: 'Mark arrived' },
    autoCheckReport: { dataState: 'current', score: 92, ownerCount: 1, estimatedInServiceDate: '2024-03-14', checks: [] },
  } as InventoryVehicle;
}

describe('take-home sheet', () => {
  it('carries only published, customer-facing facts', () => {
    const model = takeHomeModel(vehicle());
    expect(model).toMatchObject({ store: 'Howell', storeName: 'Bob Maxey Ford of Howell', stockNumber: 'HT0529A', price: 42810, msrp: 49480, savings: 6670, mileage: 2052 });
    expect(model.certified?.name).toBe('Ford Blue Certified');
    expect(model.history).toBe('AutoCheck score 92 · 1 owner reported');
    const serialized = JSON.stringify(model);
    for (const forbidden of ['Demo Salesperson', 'Customer appointment', 'Fowlerville', 'Demo Driver', 'transfer-1', 'in_transit', 'Mark arrived', '2024-03-14', 'inService', 'Bumper-to-bumper']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('keeps the printable customer surface compact and listing-safe', () => {
    const model = takeHomeModel(vehicle());
    const { container } = render(<TakeHomeSheetContent model={model} now={new Date('2026-09-22T12:00:00Z')} />);
    expect(container.querySelector('.th-bottom-grid')).toBeInTheDocument();
    expect(container.querySelector('.th-listing-link')).toHaveAttribute('href', vehicle().publicListing.listingUrl);
    expect(container.querySelector('.th-cert-note')).toHaveTextContent('Separate from any factory warranty');
    expect(container.querySelector('.th-equipment')).toBeInTheDocument();
  });

  it('does not render an unsafe listing URL into the customer sheet', () => {
    const unsafe = { ...vehicle(), publicListing: { ...vehicle().publicListing, listingUrl: 'javascript:alert(1)' } };
    const model = takeHomeModel(unsafe);
    expect(model.listingUrl).toBeNull();
  });

  it('closes on Escape without closing the vehicle workspace beneath it', async () => {
    const onClose = vi.fn();
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={{ id: 'howell', name: 'Howell' }} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Take-home page' }));
    const sheet = screen.getByRole('dialog', { name: /Take-home page/ });
    expect(sheet).toBeInTheDocument();

    // Both dialogs listen on the document; only the one on top may act.
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Take-home page/ })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /vehicle workspace/ })).toBeInTheDocument();

    // With the sheet gone the workspace owns Escape again.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
