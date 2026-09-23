// PRODUCT-RULE TEST
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRequestVehicleMove, isMoveRequestBlocked, movementTrackingPath, resolveCurrentLocation, transferByVin } from '../features/inventory/inventory-utils';
import { VehicleWorkspace } from '../features/inventory/VehicleWorkspace';
import { selectRequestedTransfer } from '../features/transfers/transfer-selection';
import type { BootstrapData, MovementSummary, TransferRecord, VehicleRecord } from '../types';
import { toInventoryVehicle } from './adapters';

// A Fowlerville vehicle viewed from another store. The movement shapes below
// are the ones server/service-core.mjs actually emits (movementSummary,
// sharedLocationSummary and the location_exception branch of vehicleView).
function sourceVehicle(movement: MovementSummary): VehicleRecord {
  return {
    vin: 'TESTDATAFOWL00001',
    stockNumber: 'DEMO-F01',
    year: 2024,
    make: 'Ford',
    model: 'Bronco',
    trim: 'Badlands',
    vehicleName: '2024 Ford Bronco Badlands',
    publicStore: 'Fowlerville',
    homeStore: 'Fowlerville',
    homeStoreConfirmed: true,
    sourceReportedLocation: 'Fowlerville',
    websiteStatus: 'Available',
    publicListingState: 'Listed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'No current hold', backupCount: 0 },
    movement,
  };
}

/** What a cross-store sales or manager user receives while the vehicle is on a move (no transfer link). */
const withheldInTransit: MovementSummary = {
  state: 'in_transit',
  label: 'in transit',
  currentLocation: 'Howell',
  destination: 'Howell',
  lastConfirmedAt: '2026-08-30T12:00:00Z',
  departedAt: '2026-08-30T11:15:00Z',
  locationConfidence: 'verified',
};

/** What every role receives for a vehicle with no transfer at all. */
const sourceReported: MovementSummary = {
  state: 'source_reported',
  label: 'Source-reported location',
  currentLocation: 'Fowlerville',
  locationConfidence: 'reported',
  nextAction: 'Confirm with home store before customer commitment',
  nextActionOwner: 'Fowlerville manager',
};

/**
 * What every role receives after a simple-mode home receipt: the closed
 * transfer stays the location authority, so service-core keeps publishing it
 * (sharedLocationSummary, no transfer link) while blocksNewSimpleRequest lets
 * the vehicle be requested again. Pinned server-side by
 * tests/unit/simple-moves-workflow.test.ts ("keeps a completed home receipt
 * authoritative ...").
 */
const returnedHome: MovementSummary = {
  state: 'returned_home',
  label: 'returned home',
  currentLocation: 'Fowlerville',
  destination: 'Howell',
  lastConfirmedAt: '2026-08-30T14:20:00Z',
  locationConfidence: 'verified',
};

/** Emitted without a transfer link even to the owning store. */
const conflicting: MovementSummary = {
  state: 'location_exception',
  label: 'Location needs checking',
  currentLocation: 'Unknown',
  locationConfidence: 'conflicting',
};

/**
 * A trip canceled after it departed: the last physical fact is stale
 * ('picked_up', 'In transit') and service-core keeps publishing it as the
 * location authority (sharedLocationSummary, no link, no departure clock),
 * but a terminal row blocks nothing, so the server says a new request would
 * be accepted. Pinned server-side by tests/unit/simple-moves-workflow.test.ts
 * ("publishes its own new-request decision on every movement shape").
 */
const canceledAfterDeparture: MovementSummary = {
  state: 'picked_up',
  label: 'picked up',
  currentLocation: 'In transit',
  destination: 'Howell',
  lastConfirmedAt: '2026-08-30T11:20:00Z',
  locationConfidence: 'verified',
  newRequestBlocked: false,
};

function transferRecord(): TransferRecord {
  return {
    id: 'move-1',
    workflowMode: 'simple',
    vin: 'TESTDATAFOWL00001',
    stockNumber: 'DEMO-F01',
    vehicleName: '2024 Ford Bronco Badlands',
    homeStore: 'Fowlerville',
    requestingStore: 'Howell',
    currentLocation: 'Howell',
    destination: 'Howell',
    requestStatus: 'approved',
    movementStatus: 'in_transit',
    dealStatus: 'pending',
    deliveryStatus: 'not_delivered',
    dealerMailHoldState: 'none_observed',
    publicListingState: 'Listed',
    cdkStatus: 'unknown',
    priority: 'normal',
    requestedBy: 'Demo Salesperson',
    requestedAt: '2026-08-30T09:00:00Z',
    custodian: 'Demo Driver',
    transportAssignee: 'Demo Driver',
    nextAction: 'Mark arrived',
    nextActionOwner: 'Howell manager',
    dueAt: '2026-09-30T12:00:00Z',
    returnRequired: true,
    lastConfirmedAt: '2026-08-30T12:00:00Z',
    locationConfidence: 'verified',
    events: [
      { id: 'event-1', type: 'requested', label: 'Requested', occurredAt: '2026-08-30T09:00:00Z', actor: 'Demo Salesperson' },
      { id: 'event-2', type: 'departed', label: 'Departed Fowlerville', occurredAt: '2026-08-30T11:15:00Z', actor: 'Demo Driver', toLocation: 'In transit' },
    ],
  };
}

/** The same move after the Fowlerville manager confirmed it back home; closed in that transaction. */
function closedTransferRecord(): TransferRecord {
  return {
    ...transferRecord(),
    currentLocation: 'Fowlerville',
    requestStatus: 'closed',
    movementStatus: 'returned_home',
    dealStatus: 'not_confirmed',
    deliveryStatus: 'not_confirmed',
    custodian: undefined,
    transportAssignee: undefined,
    nextAction: 'Move complete · back at Howell',
    dueAt: undefined,
    lastConfirmedAt: '2026-08-30T14:20:00Z',
    events: [
      ...transferRecord().events,
      { id: 'event-3', type: 'arrived', label: 'Arrived Howell', occurredAt: '2026-08-30T12:00:00Z', actor: 'Demo Salesperson', toLocation: 'Howell' },
      { id: 'event-4', type: 'returned_home', label: 'Back at Fowlerville', occurredAt: '2026-08-30T14:20:00Z', actor: 'Demo Manager', toLocation: 'Fowlerville' },
    ],
  };
}

/**
 * The trip behind `canceledAfterDeparture`, as the stores party to it receive
 * it in bootstrap.transfers: a terminal row whose last physical fact is stale
 * and whose due date has passed. Its request id, next action and due date
 * belong to a request that no longer exists.
 */
function canceledAfterDepartureRecord(): TransferRecord {
  return {
    ...transferRecord(),
    currentLocation: 'In transit',
    requestStatus: 'canceled',
    movementStatus: 'picked_up',
    dealStatus: 'not_confirmed',
    deliveryStatus: 'not_confirmed',
    custodian: undefined,
    transportAssignee: undefined,
    nextAction: 'Confirm the vehicle arrived at Fowlerville',
    dueAt: '2026-08-30T19:00:00Z',
    lastConfirmedAt: '2026-08-30T11:20:00Z',
    events: [
      ...transferRecord().events,
      { id: 'event-3', type: 'canceled', label: 'Request canceled', occurredAt: '2026-08-30T11:30:00Z', actor: 'Demo Manager' },
    ],
  };
}

/** A request canceled before anything moved: the vehicle never left its source-reported location. */
function canceledBeforeDepartureRecord(): TransferRecord {
  return {
    ...transferRecord(),
    currentLocation: 'Fowlerville',
    requestStatus: 'canceled',
    movementStatus: 'at_home',
    dealStatus: 'not_confirmed',
    deliveryStatus: 'not_confirmed',
    custodian: undefined,
    transportAssignee: undefined,
    nextAction: 'Confirm with home store before customer commitment',
    dueAt: '2026-08-30T19:00:00Z',
    lastConfirmedAt: '2026-08-30T09:05:00Z',
    events: [
      { id: 'event-1', type: 'requested', label: 'Requested', occurredAt: '2026-08-30T09:00:00Z', actor: 'Demo Salesperson' },
      { id: 'event-2', type: 'canceled', label: 'Request canceled', occurredAt: '2026-08-30T09:05:00Z', actor: 'Demo Manager' },
    ],
  };
}

/** InventoryPage's join, the real one: the newest open transfer per VIN, else the closed one. */
function joinedByVin(data: BootstrapData, vin: string): TransferRecord | undefined {
  return transferByVin(data.transfers).get(vin);
}

function sourceData(transfers: TransferRecord[] = []): BootstrapData {
  return {
    meta: {
      reportDate: '2026-08-30',
      completedAt: '2026-08-30T09:00:00-04:00',
      timezone: 'America/New_York',
      publicFreshness: 'current',
      dealerMailFreshness: 'current',
      publicCount: 1,
      crmCount: 1,
      heldVinCount: 0,
      publicChangeCounts: {
        newArrival: 0,
        removed: 0,
        priceChange: 0,
        mileageChange: 0,
        websiteStatusChange: 0,
        stockCorrection: 0,
        storeTransfer: 0,
      },
      holdChangeStatus: 'current',
      warnings: [],
    },
    stores: [],
    vehicles: [],
    transfers,
    attention: [],
  };
}

afterEach(() => cleanup());

describe('app custody adapter', () => {
  it('treats a ledger-backed movement as app custody even when the transfer link is withheld', () => {
    // Under the previous rule, Boolean(movement || vehicle.movement.transferId),
    // this record had neither and fell back to the source-reported store.
    const mapped = toInventoryVehicle(sourceVehicle(withheldInTransit), sourceData());

    expect(mapped.location).toMatchObject({
      appConfirmedLocation: 'Howell',
      appConfirmedStore: { name: 'Howell' },
      appConfirmedAt: '2026-08-30T12:00:00Z',
      appConfirmedBy: null,
      custodian: null,
      conflict: false,
    });
    expect(mapped.location.sourceReportedStore?.name).toBe('Fowlerville');
    expect(mapped.movement).not.toBeNull();
    expect(mapped.movement).toMatchObject({
      state: 'in_transit',
      custodyStatus: 'in_transit',
      requestId: null,
      withheld: true,
      lastEventAt: '2026-08-30T12:00:00Z',
      lastEventLabel: null,
      nextAction: null,
      dueAt: null,
      overdue: false,
      custodian: null,
      transportAssignee: null,
    });
    // No transfer events were published, so the timeline stays empty.
    expect(mapped.timeline).toEqual([]);
    expect(resolveCurrentLocation(mapped)).toMatchObject({
      label: 'Howell',
      provenance: 'app-confirmed',
      store: { name: 'Howell' },
    });
  });

  it('carries whatever movement facts the server did publish for withheld custody', () => {
    const mapped = toInventoryVehicle(
      sourceVehicle({ ...withheldInTransit, state: 'at_requesting_store', nextAction: 'Return by due date', dueAt: '2026-08-01T12:00:00Z' }),
      sourceData(),
    );
    expect(mapped.movement).toMatchObject({
      state: 'at_requesting_store',
      custodyStatus: 'at_requesting_store',
      requestId: null,
      nextAction: 'Return by due date',
      dueAt: '2026-08-01T12:00:00Z',
      overdue: true,
    });
  });

  it('keeps a plain source report as source-reported with no movement', () => {
    for (const movement of [sourceReported, { ...sourceReported, label: 'Last verified source location', locationConfidence: 'stale' as const }]) {
      const mapped = toInventoryVehicle(sourceVehicle(movement), sourceData());
      expect(mapped.location).toMatchObject({
        appConfirmedLocation: null,
        appConfirmedStore: null,
        appConfirmedAt: null,
        conflict: false,
      });
      expect(mapped.movement).toBeNull();
      expect(mapped.timeline).toEqual([]);
      expect(resolveCurrentLocation(mapped)).toMatchObject({ label: 'Fowlerville', provenance: 'source-reported' });
    }
    // An empty state (integration projections may omit it) is not custody either.
    const empty = toInventoryVehicle(sourceVehicle({ ...sourceReported, state: '  ' }), sourceData());
    expect(empty.movement).toBeNull();
  });

  it('surfaces a conflicting location as a conflict, never as a store', () => {
    const mapped = toInventoryVehicle(sourceVehicle(conflicting), sourceData());

    expect(mapped.location.conflict).toBe(true);
    expect(mapped.location.appConfirmedStore).toBeNull();
    // The server emits a conflict without any transfer link, even to the
    // owning store: it is custody evidence that needs checking, not an open
    // move — no "Being moved" pill, and the server decides on any new request.
    expect(mapped.movement).toBeNull();
    expect(canRequestVehicleMove(mapped, 'sales', 'lincoln')).toBe(true);
    const resolved = resolveCurrentLocation(mapped);
    expect(resolved).toMatchObject({ label: 'Location needs checking', provenance: 'app-confirmed' });
    expect(resolved.store).toBeUndefined();
    // The conflict flag is independent of custody evidence.
    expect(toInventoryVehicle(sourceVehicle({ ...sourceReported, locationConfidence: 'conflicting' }), sourceData()).location.conflict).toBe(true);
  });

  it('never presents the server\'s Unknown sentinel as the app-confirmed location fact', async () => {
    const user = userEvent.setup();
    const mapped = toInventoryVehicle(sourceVehicle(conflicting), sourceData());
    render(
      createElement(VehicleWorkspace, {
        vehicle: mapped,
        homeStore: { id: 'lincoln', name: 'Lincoln' },
        onClose: vi.fn(),
      }),
    );
    await user.click(screen.getByRole('tab', { name: 'Holds & moves' }));
    const movement = screen.getByRole('region', { name: 'Location & movement' });
    expect(movement).toHaveTextContent('Location needs checking');
    expect(movement).not.toHaveTextContent('Unknown');
  });

  it('keeps a completed home receipt as location evidence without an open move', () => {
    // Withheld from a third store: the shape from simple-moves-workflow.test.ts.
    const mapped = toInventoryVehicle(sourceVehicle(returnedHome), sourceData());

    expect(mapped.location).toMatchObject({
      appConfirmedLocation: 'Fowlerville',
      appConfirmedStore: { name: 'Fowlerville' },
      appConfirmedAt: '2026-08-30T14:20:00Z',
      conflict: false,
    });
    expect(resolveCurrentLocation(mapped)).toMatchObject({ label: 'Fowlerville', provenance: 'app-confirmed' });
    // Not "being moved": no row pill, no "Being moved" quick view, no Track movement.
    expect(mapped.movement).toBeNull();
    expect(movementTrackingPath(mapped)).toBeNull();
    // The server accepts a new request from any other store after a receipt.
    expect(canRequestVehicleMove(mapped, 'sales', 'lincoln')).toBe(true);
    expect(canRequestVehicleMove(mapped, 'manager', 'howell')).toBe(true);
    expect(canRequestVehicleMove(mapped, 'sales', 'fowlerville')).toBe(false);
    expect(canRequestVehicleMove(mapped, 'porter', 'lincoln')).toBe(false);

    // The stores party to the move receive the closed transfer in bootstrap
    // and InventoryPage joins it by VIN; the outcome must be the same.
    const closed = closedTransferRecord();
    for (const joined of [
      toInventoryVehicle(sourceVehicle(returnedHome), sourceData([closed]), closed),
      toInventoryVehicle(sourceVehicle(returnedHome), sourceData([closed])),
    ]) {
      expect(joined.movement).toBeNull();
      expect(joined.location).toMatchObject({ appConfirmedLocation: 'Fowlerville', appConfirmedAt: '2026-08-30T14:20:00Z' });
      expect(canRequestVehicleMove(joined, 'manager', 'howell')).toBe(true);
    }
    // The events that were published still belong to the vehicle's history.
    const withHistory = toInventoryVehicle(sourceVehicle(returnedHome), sourceData([closed]), closed);
    expect(withHistory.timeline?.map((event) => event.title)).toEqual([
      'Requested',
      'Departed Fowlerville',
      'Arrived Howell',
      'Back at Fowlerville',
    ]);
  });

  it('never lets a completed receipt hide a newer open request', () => {
    // vehicleView spreads the physical-location row (the receipt) over the
    // active transfer summary, so a party store receives the new request as
    // the receipt's state plus the request's link and status.
    const closed = closedTransferRecord();
    const reopened: TransferRecord = {
      ...transferRecord(),
      id: 'move-2',
      requestingStore: 'Lincoln',
      currentLocation: 'Fowlerville',
      destination: 'Lincoln',
      requestStatus: 'requested',
      movementStatus: 'at_home',
      custodian: undefined,
      transportAssignee: undefined,
      nextAction: 'Check the vehicle is free, then approve this move',
      nextActionOwner: 'Fowlerville manager',
      dueAt: '2026-09-02T12:00:00Z',
      lastConfirmedAt: '2026-08-30T14:20:00Z',
      events: [{ id: 'event-5', type: 'requested', label: 'Requested', occurredAt: '2026-09-01T09:00:00Z', actor: 'Demo Salesperson' }],
    };
    const merged: MovementSummary = {
      ...returnedHome,
      transferId: 'move-2',
      requestStatus: 'requested',
      nextAction: reopened.nextAction,
      nextActionOwner: reopened.nextActionOwner,
      dueAt: reopened.dueAt,
      returnRequired: true,
    };
    const partyStore = toInventoryVehicle(sourceVehicle(merged), sourceData([closed, reopened]));
    expect(partyStore.movement).toMatchObject({ requestId: 'move-2', requestStatus: 'requested', nextAction: reopened.nextAction });
    expect(partyStore.location).toMatchObject({ appConfirmedLocation: 'Fowlerville', appConfirmedAt: '2026-08-30T14:20:00Z' });
    expect(movementTrackingPath(partyStore)).toBe('/transfers?id=move-2');
    expect(canRequestVehicleMove(partyStore, 'sales', 'howell')).toBe(false);

    // The requesting store may not be party to the receipt row, so its
    // vehicle.movement carries no link — but bootstrap.transfers holds its own
    // open request and InventoryPage joins it by VIN.
    const requester = toInventoryVehicle(sourceVehicle(returnedHome), sourceData([closed, reopened]), reopened);
    expect(requester.movement).toMatchObject({ requestId: 'move-2', requestStatus: 'requested' });
    expect(canRequestVehicleMove(requester, 'sales', 'lincoln')).toBe(false);

    // Only a joined closed receipt (or none) leaves the vehicle requestable.
    const idle = toInventoryVehicle(sourceVehicle(returnedHome), sourceData([closed]), closed);
    expect(idle.movement).toBeNull();
    expect(canRequestVehicleMove(idle, 'sales', 'lincoln')).toBe(true);

    // A conflict with a visible open transfer is still an open move.
    const conflictWithRequest = toInventoryVehicle(sourceVehicle(conflicting), sourceData([reopened]), reopened);
    expect(conflictWithRequest.location.conflict).toBe(true);
    expect(conflictWithRequest.movement).toMatchObject({ requestId: 'move-2' });
  });

  it('keeps the joined-transfer path unchanged', () => {
    const transfer = transferRecord();
    const record = sourceVehicle({
      ...withheldInTransit,
      transferId: transfer.id,
      requestStatus: 'approved',
      currentCustodian: 'Demo Driver',
      transportAssignee: 'Demo Driver',
      nextAction: 'Mark arrived',
      nextActionOwner: 'Howell manager',
      dueAt: '2026-09-30T12:00:00Z',
    });

    for (const mapped of [
      toInventoryVehicle(record, sourceData([transfer]), transfer),
      toInventoryVehicle(record, sourceData([transfer])),
    ]) {
      expect(mapped.location).toMatchObject({
        appConfirmedLocation: 'Howell',
        appConfirmedStore: { name: 'Howell' },
        appConfirmedAt: '2026-08-30T12:00:00Z',
        appConfirmedBy: 'Demo Driver',
        custodian: 'Demo Driver',
        conflict: false,
      });
      expect(mapped.movement).toMatchObject({
        state: 'in_transit',
        requestStatus: 'approved',
        custodyStatus: 'in_transit',
        customerOutcome: 'pending',
        deliveryConfirmation: 'not_delivered',
        requestId: 'move-1', withheld: false,
        lastEventLabel: 'Departed Fowlerville',
        nextAction: 'Mark arrived',
        dueAt: '2026-09-30T12:00:00Z',
        custodian: 'Demo Driver',
        transportAssignee: 'Demo Driver',
      });
      expect(mapped.timeline?.map((event) => event.title)).toEqual(['Requested', 'Departed Fowlerville']);
      expect(movementTrackingPath(mapped)).toBe('/transfers?id=move-1');
    }
  });

  it('never lets a closed joined row manufacture an open move or a custody record', () => {
    // The stores party to a canceled trip receive its row in bootstrap.transfers
    // and InventoryPage joins it by VIN. The outcome must match what a third
    // store — and the Deal Desk panel, whose join skips terminal rows — gets
    // from the server's physical-only shape: the stale 'picked_up' pill stays,
    // but no request id, status, next action or due date from a request that
    // no longer exists, so no Track movement, no "Move needs attention".
    const canceled = canceledAfterDepartureRecord();
    const data = sourceData([canceled]);
    const thirdStore = toInventoryVehicle(sourceVehicle(canceledAfterDeparture), sourceData());
    for (const joined of [
      toInventoryVehicle(sourceVehicle(canceledAfterDeparture), data, joinedByVin(data, canceled.vin)),
      toInventoryVehicle(sourceVehicle(canceledAfterDeparture), data, canceled),
    ]) {
      expect(joined.movement).toEqual(thirdStore.movement);
      expect(joined.movement).toMatchObject({
        state: 'picked_up', requestId: null, requestStatus: null, withheld: true,
        nextAction: null, dueAt: null, overdue: false, lastEventLabel: null, customerOutcome: null,
      });
      expect(joined.location).toEqual(thirdStore.location);
      expect(joined.location).toMatchObject({ appConfirmedLocation: 'In transit', appConfirmedAt: '2026-08-30T11:20:00Z', appConfirmedStore: null });
      expect(movementTrackingPath(joined)).toBeNull();
      expect(joined.moveRequestBlocked).toBe(false);
      expect(canRequestVehicleMove(joined, 'sales', 'howell')).toBe(true);
      expect(canRequestVehicleMove(joined, 'manager', 'lincoln')).toBe(true);
      // The row's events are still the vehicle's history.
      expect(joined.timeline?.map((event) => event.title)).toEqual(['Requested', 'Departed Fowlerville', 'Request canceled']);
    }

    // Canceled before anything moved: the server publishes a plain source
    // report (physicalLocationAuthority has no physical event and no blocking
    // row). The canceled row must not turn that into an app-confirmed location
    // or an "at home" move.
    const early = canceledBeforeDepartureRecord();
    const earlyData = sourceData([early]);
    const stillReported = toInventoryVehicle(
      sourceVehicle({ ...sourceReported, newRequestBlocked: false }),
      earlyData,
      joinedByVin(earlyData, early.vin),
    );
    expect(stillReported.movement).toBeNull();
    expect(stillReported.location).toMatchObject({ appConfirmedLocation: null, appConfirmedStore: null, appConfirmedAt: null, custodian: null });
    expect(resolveCurrentLocation(stillReported)).toMatchObject({ label: 'Fowlerville', provenance: 'source-reported' });
    expect(movementTrackingPath(stillReported)).toBeNull();
    expect(canRequestVehicleMove(stillReported, 'sales', 'howell')).toBe(true);
    expect(stillReported.timeline?.map((event) => event.title)).toEqual(['Requested', 'Request canceled']);
    // Without the server's decision the fallback still reads "no open move".
    const legacy = toInventoryVehicle(sourceVehicle(sourceReported), earlyData, early);
    expect(legacy.movement).toBeNull();
    expect(canRequestVehicleMove(legacy, 'sales', 'howell')).toBe(true);
  });

  it('lets the transfer the server linked outrank the VIN join', () => {
    // Whatever row a caller's join hands the adapter — here the closed trip,
    // as the pre-fix InventoryPage join did — the transfer the server linked
    // must win.
    const closed = closedTransferRecord();
    const reopened: TransferRecord = {
      ...transferRecord(),
      id: 'move-2',
      requestingStore: 'Lincoln',
      currentLocation: 'Fowlerville',
      destination: 'Lincoln',
      requestStatus: 'requested',
      movementStatus: 'at_home',
      custodian: undefined,
      transportAssignee: undefined,
      nextAction: 'Check the vehicle is free, then approve this move',
      dueAt: '2026-09-02T12:00:00Z',
      events: [{ id: 'event-5', type: 'requested', label: 'Requested', occurredAt: '2026-09-01T09:00:00Z', actor: 'Demo Salesperson' }],
    };
    const data = sourceData([reopened, closed]);
    const mapped = toInventoryVehicle(
      sourceVehicle({ ...returnedHome, transferId: 'move-2', requestStatus: 'requested', nextAction: reopened.nextAction, dueAt: reopened.dueAt }),
      data,
      closed,
    );
    expect(mapped.movement).toMatchObject({ requestId: 'move-2', requestStatus: 'requested', withheld: false, lastEventLabel: 'Requested', customerOutcome: 'pending' });
    expect(movementTrackingPath(mapped)).toBe('/transfers?id=move-2');
    expect(mapped.timeline?.map((event) => event.title)).toEqual(['Requested']);
  });

  it('renders Request vehicle, not Track movement, for a canceled trip joined by a party store', async () => {
    const user = userEvent.setup();
    const onTrackMovement = vi.fn();
    const onRequestVehicle = vi.fn();
    const viewer = { id: 'howell', name: 'Howell' };
    const canceled = canceledAfterDepartureRecord();
    const data = sourceData([canceled]);
    const joined = toInventoryVehicle(sourceVehicle(canceledAfterDeparture), data, joinedByVin(data, canceled.vin));

    render(
      createElement(VehicleWorkspace, {
        vehicle: joined,
        homeStore: viewer,
        onClose: vi.fn(),
        canRequestVehicle: canRequestVehicleMove(joined, 'sales', viewer.id),
        onRequestVehicle,
        onTrackMovement,
      }),
    );
    await user.click(screen.getByRole('tab', { name: 'Holds & moves' }));
    const movement = screen.getByRole('region', { name: 'Location & movement' });
    expect(screen.queryByRole('button', { name: 'Track movement' })).not.toBeInTheDocument();
    expect(movement).toHaveTextContent('In transit');
    await user.click(screen.getByRole('button', { name: 'Request vehicle' }));
    expect(onRequestVehicle).toHaveBeenCalledExactlyOnceWith(joined);
    expect(onTrackMovement).not.toHaveBeenCalled();
  });
});

describe('server-published new-request decision', () => {
  it('lets the server say a stale physical shape is requestable, without touching the movement signal', () => {
    // Under the client-only rule, movement non-null meant "cannot request";
    // the server knows the blocking row is canceled.
    const mapped = toInventoryVehicle(sourceVehicle(canceledAfterDeparture), sourceData());
    expect(mapped.moveRequestBlocked).toBe(false);
    // The pill, quick view and app-confirmed location keep their precedence.
    expect(mapped.movement).toMatchObject({ state: 'picked_up', withheld: true, requestId: null });
    expect(mapped.location).toMatchObject({ appConfirmedLocation: 'In transit', appConfirmedAt: '2026-08-30T11:20:00Z' });
    expect(isMoveRequestBlocked(mapped)).toBe(false);
    expect(canRequestVehicleMove(mapped, 'sales', 'lincoln')).toBe(true);
    expect(canRequestVehicleMove(mapped, 'manager', 'howell')).toBe(true);
    // Role and home-store rules still apply on top of the server's answer.
    expect(canRequestVehicleMove(mapped, 'sales', 'fowlerville')).toBe(false);
    expect(canRequestVehicleMove(mapped, 'porter', 'lincoln')).toBe(false);
    expect(movementTrackingPath(mapped)).toBeNull();
  });

  it('lets the server say a received-home vehicle is blocked by a request this store cannot see', () => {
    const mapped = toInventoryVehicle(sourceVehicle({ ...returnedHome, newRequestBlocked: true }), sourceData());
    expect(mapped.moveRequestBlocked).toBe(true);
    // Still not "being moved": the receipt is location evidence, not a pill.
    expect(mapped.movement).toBeNull();
    expect(isMoveRequestBlocked(mapped)).toBe(true);
    expect(canRequestVehicleMove(mapped, 'sales', 'lincoln')).toBe(false);
    expect(canRequestVehicleMove(mapped, 'manager', 'howell')).toBe(false);
    // The same is true of a source-only vehicle and of a location conflict.
    expect(canRequestVehicleMove(toInventoryVehicle(sourceVehicle({ ...sourceReported, newRequestBlocked: true }), sourceData()), 'sales', 'lincoln')).toBe(false);
    expect(canRequestVehicleMove(toInventoryVehicle(sourceVehicle({ ...conflicting, newRequestBlocked: true }), sourceData()), 'sales', 'lincoln')).toBe(false);
    // An explicit false is carried as false, not collapsed into null.
    expect(toInventoryVehicle(sourceVehicle({ ...sourceReported, newRequestBlocked: false }), sourceData()).moveRequestBlocked).toBe(false);
    expect(toInventoryVehicle(sourceVehicle({ ...withheldInTransit, newRequestBlocked: true }), sourceData()).moveRequestBlocked).toBe(true);
  });

  it('falls back to the open-move rule when the server did not publish a decision', () => {
    // Older servers and the advanced engine omit the field; the client must
    // never read absence as "allowed".
    for (const movement of [withheldInTransit, returnedHome, sourceReported, conflicting, { ...canceledAfterDeparture, newRequestBlocked: undefined }]) {
      const mapped = toInventoryVehicle(sourceVehicle(movement), sourceData());
      expect(mapped.moveRequestBlocked).toBeNull();
      expect(isMoveRequestBlocked(mapped)).toBe(Boolean(mapped.movement));
      expect(canRequestVehicleMove(mapped, 'sales', 'lincoln')).toBe(!mapped.movement);
    }
    // A joined open transfer without the field still blocks.
    const transfer = transferRecord();
    const joined = toInventoryVehicle(sourceVehicle({ ...withheldInTransit, transferId: transfer.id }), sourceData([transfer]), transfer);
    expect(joined.moveRequestBlocked).toBeNull();
    expect(canRequestVehicleMove(joined, 'sales', 'lincoln')).toBe(false);
  });

  it('offers Request vehicle for a canceled-after-departure vehicle and hides it when the server blocks', async () => {
    const user = userEvent.setup();
    const onTrackMovement = vi.fn();
    const onRequestVehicle = vi.fn();
    const viewer = { id: 'lincoln', name: 'Lincoln' };
    const stale = toInventoryVehicle(sourceVehicle(canceledAfterDeparture), sourceData());

    const view = render(
      createElement(VehicleWorkspace, {
        vehicle: stale,
        homeStore: viewer,
        onClose: vi.fn(),
        canRequestVehicle: canRequestVehicleMove(stale, 'sales', viewer.id),
        onRequestVehicle,
        onTrackMovement,
      }),
    );
    await user.click(screen.getByRole('tab', { name: 'Holds & moves' }));
    const movement = screen.getByRole('region', { name: 'Location & movement' });
    expect(screen.queryByRole('button', { name: 'Track movement' })).not.toBeInTheDocument();
    // The stale physical fact is still shown truthfully.
    expect(movement).toHaveTextContent('In transit');
    await user.click(screen.getByRole('button', { name: 'Request vehicle' }));
    expect(onRequestVehicle).toHaveBeenCalledExactlyOnceWith(stale);
    expect(onTrackMovement).not.toHaveBeenCalled();

    // A caller that wrongly allows requests is still overruled by the server's word.
    const blocked = toInventoryVehicle(sourceVehicle({ ...returnedHome, newRequestBlocked: true }), sourceData());
    view.rerender(
      createElement(VehicleWorkspace, {
        vehicle: blocked,
        homeStore: viewer,
        onClose: vi.fn(),
        canRequestVehicle: true,
        onRequestVehicle,
        onTrackMovement,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Track movement' })).not.toBeInTheDocument();
  });
});

describe('withheld custody navigation guards', () => {
  it('offers no transfer link and no duplicate request for withheld custody', () => {
    const withheld = toInventoryVehicle(sourceVehicle(withheldInTransit), sourceData());
    const reported = toInventoryVehicle(sourceVehicle(sourceReported), sourceData());

    expect(movementTrackingPath(withheld)).toBeNull();
    expect(movementTrackingPath(reported)).toBeNull();
    // Already in app custody: the server would reject a second request.
    expect(canRequestVehicleMove(withheld, 'sales', 'lincoln')).toBe(false);
    expect(canRequestVehicleMove(reported, 'sales', 'lincoln')).toBe(true);
    expect(canRequestVehicleMove(reported, 'manager', 'howell')).toBe(true);
    expect(canRequestVehicleMove(reported, 'sales', 'fowlerville')).toBe(false);
    expect(canRequestVehicleMove(reported, 'porter', 'lincoln')).toBe(false);
  });

  it('selects nothing for an id or VIN deep link the moves queue cannot see', () => {
    const entries = [
      { record: { id: 'move-a', vin: 'TESTDATAHWELL0001' } },
      { record: { id: 'move-b', vin: 'TESTDATAFOWL00002' } },
    ];
    expect(selectRequestedTransfer(entries, null, 'TESTDATAFOWL00001')).toBeNull();
    expect(selectRequestedTransfer(entries, null, 'TESTDATAFOWL00002')).toBe(entries[1]);
    expect(selectRequestedTransfer(entries, 'move-b', undefined)).toBe(entries[1]);
    expect(selectRequestedTransfer(entries, 'move-b', 'TESTDATAHWELL0001')).toBe(entries[1]);
    expect(selectRequestedTransfer(entries, null, undefined)).toBe(entries[0]);
    // A withheld, filtered-out or deleted transfer must not be replaced by
    // another vehicle's move; a VIN on the same link still resolves.
    expect(selectRequestedTransfer(entries, 'missing', undefined)).toBeNull();
    expect(selectRequestedTransfer(entries, 'missing', 'TESTDATAFOWL00002')).toBe(entries[1]);
    expect(selectRequestedTransfer(entries, 'missing', 'TESTDATAFOWL00001')).toBeNull();
    expect(selectRequestedTransfer([], null, undefined)).toBeNull();
  });

  it('renders Track movement only when the workspace has a transfer to open', async () => {
    const user = userEvent.setup();
    const onTrackMovement = vi.fn();
    const onRequestVehicle = vi.fn();
    const viewer = { id: 'lincoln', name: 'Lincoln' };
    const withheld = toInventoryVehicle(sourceVehicle(withheldInTransit), sourceData());

    const view = render(
      createElement(VehicleWorkspace, {
        vehicle: withheld,
        homeStore: viewer,
        onClose: vi.fn(),
        canRequestVehicle: canRequestVehicleMove(withheld, 'sales', viewer.id),
        onRequestVehicle,
        onTrackMovement,
      }),
    );
    await user.click(screen.getByRole('tab', { name: 'Holds & moves' }));
    const movement = screen.getByRole('region', { name: 'Location & movement' });
    expect(screen.queryByRole('button', { name: 'Track movement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();
    expect(movement).toHaveTextContent('Howell');
    // Withheld facts read as withheld, not as missing.
    expect(movement).toHaveTextContent('Move details are limited to the stores involved.');
    expect(movement).not.toHaveTextContent('Withheld for your role or store');

    // Even a caller that wrongly allows requests cannot re-request custody.
    view.rerender(
      createElement(VehicleWorkspace, {
        vehicle: withheld,
        homeStore: viewer,
        onClose: vi.fn(),
        canRequestVehicle: true,
        onRequestVehicle,
        onTrackMovement,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();

    const transfer = transferRecord();
    const visible = toInventoryVehicle(sourceVehicle({ ...withheldInTransit, transferId: transfer.id }), sourceData([transfer]), transfer);
    view.rerender(
      createElement(VehicleWorkspace, {
        vehicle: visible,
        homeStore: viewer,
        onClose: vi.fn(),
        canRequestVehicle: canRequestVehicleMove(visible, 'sales', viewer.id),
        onRequestVehicle,
        onTrackMovement,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Track movement' }));
    expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(visible);
    expect(onRequestVehicle).not.toHaveBeenCalled();
  });

  it('offers Request vehicle again once the vehicle is received home', async () => {
    const user = userEvent.setup();
    const onTrackMovement = vi.fn();
    const onRequestVehicle = vi.fn();
    const viewer = { id: 'lincoln', name: 'Lincoln' };
    const received = toInventoryVehicle(sourceVehicle(returnedHome), sourceData());

    render(
      createElement(VehicleWorkspace, {
        vehicle: received,
        homeStore: viewer,
        onClose: vi.fn(),
        canRequestVehicle: canRequestVehicleMove(received, 'sales', viewer.id),
        onRequestVehicle,
        onTrackMovement,
      }),
    );
    await user.click(screen.getByRole('tab', { name: 'Holds & moves' }));
    const movement = screen.getByRole('region', { name: 'Location & movement' });
    expect(screen.queryByRole('button', { name: 'Track movement' })).not.toBeInTheDocument();
    // The ledger's receipt is still what locates the vehicle.
    expect(movement).toHaveTextContent('Fowlerville');
    await user.click(screen.getByRole('button', { name: 'Request vehicle' }));
    expect(onRequestVehicle).toHaveBeenCalledExactlyOnceWith(received);
    expect(onTrackMovement).not.toHaveBeenCalled();
  });

  it('explains a server-blocked request when this store can see no move', async () => {
    // A completed receipt plus a request from a store this caller may not
    // see: the server publishes newRequestBlocked without any link.
    const user = userEvent.setup();
    const viewer = { id: 'lincoln', name: 'Lincoln' };
    const blocked = toInventoryVehicle(sourceVehicle({ ...returnedHome, newRequestBlocked: true }), sourceData());
    expect(blocked.movement).toBeNull();
    expect(blocked.moveRequestBlocked).toBe(true);
    expect(canRequestVehicleMove(blocked, 'sales', viewer.id)).toBe(false);

    render(
      createElement(VehicleWorkspace, {
        vehicle: blocked,
        homeStore: viewer,
        onClose: vi.fn(),
        canRequestVehicle: canRequestVehicleMove(blocked, 'sales', viewer.id),
        onRequestVehicle: vi.fn(),
        onTrackMovement: vi.fn(),
      }),
    );
    await user.click(screen.getByRole('tab', { name: 'Holds & moves' }));
    const movement = screen.getByRole('region', { name: 'Location & movement' });
    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Track movement' })).not.toBeInTheDocument();
    // Names no store, actor or request — the server does not either.
    expect(movement).toHaveTextContent('This vehicle already has an open move request.');
    expect(movement).not.toHaveTextContent('Howell');
  });
});

describe('InventoryPage transfer join', () => {
  it('prefers the newest open transfer per VIN over an older closed one, whatever the listing order', () => {
    const closed = closedTransferRecord();
    const reopened: TransferRecord = { ...transferRecord(), id: 'move-2', requestStatus: 'requested', movementStatus: 'at_home', requestedAt: '2026-09-01T09:00:00Z' };
    // bootstrap lists newest first; a plain Map kept the LAST row (the closed trip).
    expect(transferByVin([reopened, closed]).get(reopened.vin)?.id).toBe('move-2');
    expect(transferByVin([closed, reopened]).get(reopened.vin)?.id).toBe('move-2');
    // With nothing open the closed row is still handed over — history for the timeline.
    expect(transferByVin([closed]).get(closed.vin)?.id).toBe('move-1');
    // The oldest-row join used to hide the reopened request from the party store.
    const data = sourceData([reopened, closed]);
    const joined = toInventoryVehicle(sourceVehicle(returnedHome), data, joinedByVin(data, reopened.vin));
    expect(joined.movement).toMatchObject({ requestId: 'move-2', requestStatus: 'requested' });
  });
});
