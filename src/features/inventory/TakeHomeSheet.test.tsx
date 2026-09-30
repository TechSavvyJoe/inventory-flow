import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleWorkspace } from './VehicleWorkspace';
import { TakeHomeSheet, TakeHomeSheetContent, takeHomeModel } from './TakeHomeSheet';
import type { InventoryVehicle } from './types';
import { createTakeHomePdf } from '../../../extension/sidepanel/lib/takehome-pdf.mjs';

vi.mock('../../../extension/sidepanel/lib/takehome-pdf.mjs', () => ({ createTakeHomePdf:vi.fn().mockResolvedValue(new Blob(['%PDF-1.7 synthetic unit fixture'], { type:'application/pdf' })) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
    for (const forbidden of ['Demo Salesperson', 'Customer appointment', 'Fowlerville', 'Demo Driver', 'transfer-1', 'in_transit', 'Mark arrived', '2024-03-14', 'inService', 'Bumper-to-bumper', 'DEMO-', 'USD ']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('keeps the printable customer surface compact and listing-safe', () => {
    const model = takeHomeModel(vehicle());
    const { container } = render(<TakeHomeSheetContent model={model} now={new Date('2026-09-22T12:00:00Z')} />);
    expect(container.querySelector('.th-bottom-grid')).toBeInTheDocument();
    expect(container.querySelector('.th-listing-link')).toHaveAttribute('href', vehicle().publicListing.listingUrl);
    expect(container.querySelector('.th-cert-note')).toHaveTextContent('Separate from any factory warranty');
    expect(screen.getAllByText('Apple CarPlay')).toHaveLength(1);
    expect(container.querySelector('.th-photo')).not.toBeInTheDocument();
    expect(container.querySelector('.th-identity')).toHaveTextContent('HT0529A');
    expect(container.querySelector('.th-identity')).toHaveTextContent('TESTDATASYN000001');
    expect(container.querySelector('.th-price')).toHaveTextContent('$42,810');
  });

  it('fills highlights without duplicating equipment and renders an available vehicle photo', () => {
    const model = takeHomeModel({ ...vehicle(), imageUrl: 'https://example.com/vehicle.jpg', features: ['Adaptive cruise control', 'Heated front seats', 'Apple CarPlay'] });
    const { container } = render(<TakeHomeSheetContent model={model} />);
    expect(model.highlights).toHaveLength(3);
    expect(container.querySelector('.th-photo')).toHaveAttribute('src', 'https://example.com/vehicle.jpg');
    expect(container.querySelectorAll('.th-chips li')).toHaveLength(3);
    expect(screen.getAllByText('Apple CarPlay')).toHaveLength(1);
  });

  it('does not render an unsafe listing URL into the customer sheet', () => {
    const unsafe = { ...vehicle(), publicListing: { ...vehicle().publicListing, listingUrl: 'javascript:alert(1)' } };
    const model = takeHomeModel(unsafe);
    expect(model.listingUrl).toBeNull();
  });

  it('renders each selected vehicle once in one labelled printable document', async () => {
    const first = vehicle();
    const second = { ...vehicle(), id:'TESTDATASYN000002', vin:'TESTDATASYN000002', stockNumber:'HT0530A', model:'Escape', publicListing:{ ...vehicle().publicListing, listingUrl:'https://example.com/escape' } };
    render(<TakeHomeSheet vehicle={first} vehicles={[first, second, first]} listLabel="Jamie vehicle choices" onClose={vi.fn()}/>);
    expect(screen.getByRole('dialog', { name:'Take-home page · Jamie vehicle choices' })).toBeVisible();
    expect(document.querySelectorAll('.takehome-stage > .th')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name:'View full vehicle listing' })).toHaveLength(2);
    expect(screen.getByRole('button', { name:'Print / Save as PDF' })).toBeVisible();
    expect(screen.getByRole('button', { name:'Save PDF' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name:'Share' })).toBeEnabled());
  });

  it('shares a prepared PDF from the native user action', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share, canShare:() => true });
    render(<TakeHomeSheet vehicle={vehicle()} onClose={vi.fn()} />);
    const button = screen.getByRole('button', { name:'Share' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const file = share.mock.calls[0][0].files[0];
    expect(file.type).toBe('application/pdf');
    expect(file.name).toMatch(/\.pdf$/);
    expect(screen.getByRole('status')).toHaveTextContent('Shared PDF document');
  });

  it('retains the sheet and retries PDF preparation after a temporary asset failure', async () => {
    vi.mocked(createTakeHomePdf).mockRejectedValueOnce(new Error('Temporary asset failure'));
    render(<TakeHomeSheet vehicle={vehicle()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Temporary asset failure'));
    expect(screen.getByRole('button', { name:'Share' })).toBeDisabled();
    expect(screen.getByRole('button', { name:'Print / Save as PDF' })).toBeEnabled();
    expect(screen.getByText('2026 Ford Explorer Active')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name:'Retry PDF' }));
    await waitFor(() => expect(screen.getByRole('button', { name:'Share' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('preserves equipment qualifications and full customer notes without repeating highlights', () => {
    const feature = 'Adaptive cruise control requires an active subscription after the included trial period';
    const notes = 'Customer notes. '.repeat(40) + 'Delivery appointment to be confirmed.';
    const model = takeHomeModel({ ...vehicle(), features: [feature], dealerComments: notes });
    render(<TakeHomeSheetContent model={model} />);
    expect(screen.getAllByText(feature)).toHaveLength(1);
    expect(document.querySelector('.th-desc')?.textContent).toBe(notes);
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
