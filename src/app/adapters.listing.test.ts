// PRODUCT-RULE TEST
import { describe, expect, it } from 'vitest';
import { publicListingLabel } from '../features/inventory/inventory-utils';
import type { BootstrapData, PublicListingCode, TransferRecord, VehicleRecord } from '../types';
import { toInventoryVehicle } from './adapters';
import { toTransferVehicle, transferStatusLanes } from './transferAdapters';

// The server owns the public-listing fact (server/service-core.mjs
// publicListingCode). Every label below is display text; these cases pin that
// no label, website wording or listing URL can flip the client's answer.
const LABELS: Record<PublicListingCode, string> = {
  listed: 'Listed publicly; availability not confirmed',
  stale: 'Last verified public listing — availability not confirmed',
  pre_listing: 'Pre-listing — current DealerMail record; public website listing not yet observed',
  not_in_release: 'Not in current public release',
};

function vehicle(publicListing: PublicListingCode | undefined): VehicleRecord {
  return {
    vin: 'TESTDATASYN000001',
    stockNumber: 'HT0529A',
    year: 2026,
    make: 'Ford',
    model: 'Explorer',
    vehicleName: '2026 Ford Explorer Active',
    publicStore: 'Howell',
    homeStore: 'Howell',
    homeStoreConfirmed: true,
    sourceReportedLocation: 'Howell',
    // Wording that the old substring parser read as "listed" for a
    // DealerMail-only vehicle. It must never decide the fact.
    websiteStatus: 'Current DealerMail record — not publicly listed',
    listingUrl: 'https://www.bobmaxeyfordhowell.com/used-Howell-2026-Ford-Explorer',
    publicListing,
    publicListingState: publicListing ? LABELS[publicListing] : 'Listed publicly; availability not confirmed',
    dealerOn: { inStock: null, inTransit: null, inProduction: null },
    hold: { state: 'none_observed', label: 'No current hold', backupCount: 0 },
    movement: { state: 'source_reported', label: 'Source-reported location', currentLocation: 'Howell', locationConfidence: 'reported' },
  };
}

function data(publicFreshness: BootstrapData['meta']['publicFreshness'] = 'current'): BootstrapData {
  return {
    meta: {
      reportDate: '2026-08-30',
      completedAt: '2026-08-30T09:00:00-04:00',
      timezone: 'America/New_York',
      publicFreshness,
      dealerMailFreshness: 'current',
      publicCount: 1,
      crmCount: 1,
      heldVinCount: 0,
      publicChangeCounts: {
        newArrival: 0, removed: 0, priceChange: 0, mileageChange: 0,
        websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 0,
      },
      holdChangeStatus: 'current',
      warnings: [],
    },
    stores: [],
    vehicles: [],
    transfers: [],
    attention: [],
  };
}

function transfer(publicListing: PublicListingCode | undefined, dealStatus = 'not_confirmed'): TransferRecord {
  return {
    id: 'move-1',
    workflowMode: 'simple',
    vin: 'TESTDATASYN000001',
    stockNumber: 'HT0529A',
    vehicleName: '2026 Ford Explorer Active',
    homeStore: 'Howell',
    requestingStore: 'Fowlerville',
    currentLocation: 'Howell',
    destination: 'Fowlerville',
    requestStatus: 'approved',
    movementStatus: 'at_home_store',
    dealStatus,
    deliveryStatus: 'not_confirmed',
    dealerMailHoldState: 'none_observed',
    publicListing,
    publicListingState: publicListing ? LABELS[publicListing] : 'Not in current public release',
    cdkStatus: 'Not provided',
    priority: 'normal',
    requestedBy: 'Demo Salesperson',
    requestedAt: '2026-08-30T09:00:00Z',
    nextAction: 'Start the move',
    nextActionOwner: 'Fowlerville sales',
    returnRequired: true,
    locationConfidence: 'reported',
    events: [],
  };
}

describe('public-listing code adapter', () => {
  it('maps listed to a current public listing', () => {
    const mapped = toInventoryVehicle(vehicle('listed'), data());
    expect(mapped.publicListing).toMatchObject({ dataState: 'current', isListed: true });
    expect(publicListingLabel(mapped)).toBe('Public listing');
  });

  it('maps stale to the last verified listing while dataState carries the staleness', () => {
    const mapped = toInventoryVehicle(vehicle('stale'), data('stale_unverified'));
    expect(mapped.publicListing).toMatchObject({ dataState: 'stale', isListed: true });
  });

  it('maps a DealerMail-only pre_listing vehicle to not publicly listed', () => {
    const mapped = toInventoryVehicle(vehicle('pre_listing'), data());
    expect(mapped.publicListing).toMatchObject({ dataState: 'current', isListed: false });
    expect(publicListingLabel(mapped)).toBe('Not publicly listed');
  });

  it('maps not_in_release to not publicly listed', () => {
    const mapped = toInventoryVehicle(vehicle('not_in_release'), data());
    expect(mapped.publicListing.isListed).toBe(false);
    expect(publicListingLabel(mapped)).toBe('Not publicly listed');
  });

  it('keeps a record without a code unknown instead of reading its label or URL', () => {
    const mapped = toInventoryVehicle(vehicle(undefined), data());
    expect(mapped.publicListing.isListed).toBeNull();
    expect(publicListingLabel(mapped)).toBe('Public listing unknown');
  });

  it.each([
    ['listed', 'listed'],
    ['stale', 'retained-stale'],
    ['pre_listing', 'not-found'],
    ['not_in_release', 'not-found'],
    [undefined, 'status-not-provided'],
  ] as const)('maps the move lane for %s to %s', (code, lane) => {
    const lanes = transferStatusLanes(transfer(code), data().meta);
    expect(lanes.publicListing.code).toBe(lane);
    expect(lanes.publicListing.label).toBe(code ? LABELS[code] : 'Not in current public release');
    expect(toTransferVehicle(vehicle(code), data().meta).status.publicListing.code).toBe(lane);
  });

  it('lets public-source freshness outrank a listed code on the move lane', () => {
    expect(transferStatusLanes(transfer('listed'), data('incomplete').meta).publicListing.code).toBe('source-incomplete');
    expect(transferStatusLanes(transfer('listed'), data('stale_unverified').meta).publicListing.code).toBe('retained-stale');
  });
});

describe('deal status lane', () => {
  it.each([
    ['not_confirmed', 'no-outcome'],
    ['customer_showing', 'show-in-progress'],
    ['pending_confirmation', 'decision-pending'],
    ['sold_pending', 'sold-pending'],
    ['not_sold', 'shown-not-sold'],
    // Free text the server never writes is not parsed into an outcome.
    ['sale confirmed per notes', 'no-outcome'],
  ])('maps the server deal_status %s to %s', (dealStatus, lane) => {
    expect(transferStatusLanes(transfer('listed', dealStatus), data().meta).deal.code).toBe(lane);
  });
});
