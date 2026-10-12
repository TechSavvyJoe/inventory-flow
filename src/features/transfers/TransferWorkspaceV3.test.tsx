import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapData, TransferRecord, VehicleRecord } from '../../types';
import { clearWorkspaceMemory } from '../../lib/workspace-memory';
import { toTransferVehicle } from '../../app/transferAdapters';
import { TransferTracker } from './TransferTracker';
import { TransfersPage } from './TransfersPage';
import { TransferRequestWorkspace } from './TransferRequestWorkspace';
import type { TransferDetail } from './types';

const mocks = vi.hoisted(() => ({
  getTransfer: vi.fn(),
  useAppData: vi.fn(),
}));

vi.mock('../../app/AppDataContext', () => ({ useAppData: mocks.useAppData }));
vi.mock('../../lib/api', () => ({ getTransfer: mocks.getTransfer }));

function transfer(index: number): TransferRecord {
  const stock = `MOVE${index}`;
  return {
    id: `transfer-${index}`,
    vin: `1FTFW1E80RFA${String(index).padStart(5, '0')}`,
    stockNumber: stock,
    vehicleName: `2025 Ford F-150 ${index}`,
    homeStore: index % 2 ? 'Howell' : 'Fowlerville',
    requestingStore: 'Ford Detroit',
    currentLocation: index % 2 ? 'Howell' : 'Fowlerville',
    destination: 'Ford Detroit',
    requestStatus: index === 1 ? 'return_in_transit' : 'approved',
    movementStatus: index === 1 ? 'return in transit' : 'release approved',
    dealStatus: index === 1 ? 'shown not sold' : 'decision pending',
    deliveryStatus: 'not confirmed',
    dealerMailHoldState: 'primary',
    publicListingState: 'listed',
    cdkStatus: 'processing',
    priority: index === 1 ? 'high' : 'normal',
    requestedBy: `Salesperson ${index}`,
    requestedAt: '2026-08-29T14:00:00.000Z',
    custodian: `Custodian ${index}`,
    transportAssignee: `Driver ${index}`,
    nextAction: index === 1 ? 'Confirm the vehicle is back at Howell' : 'Assign a driver',
    nextActionOwner: `Manager ${index}`,
    dueAt: '2026-09-01T15:00:00.000Z',
    returnRequired: true,
    returnDueAt: '2026-09-02T15:00:00.000Z',
    lastConfirmedAt: '2026-08-30T12:00:00.000Z',
    locationConfidence: 'verified',
    allowedActions: index === 1
      ? ['confirm-return', 'report-condition', 'mark-exception']
      : ['assign-transport', 'report-condition', 'mark-exception'],
    privateEvidence: {
      requestReason: `Customer appointment ${index}`,
      customerReference: `Customer ${index}`,
    },
    events: [{
      id: `event-${index}`,
      type: 'location_confirmed',
      label: 'Location confirmed',
      occurredAt: '2026-08-30T12:00:00.000Z',
      actor: `Manager ${index}`,
      actorRole: 'manager',
      toLocation: index % 2 ? 'Howell' : 'Fowlerville',
      note: 'Vehicle and keys verified.',
    }],
  };
}

function bootstrap(count: number): BootstrapData {
  return {
    meta: {
      reportDate: '2026-08-30',
      completedAt: '2026-08-30T13:00:00.000Z',
      timezone: 'America/New_York',
      publicFreshness: 'current',
      dealerMailFreshness: 'current',
      publicCount: 0,
      crmCount: 0,
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
    transfers: Array.from({ length: count }, (_, index) => transfer(index + 1)),
    attention: [],
    publicChanges: [],
  };
}

function inventoryVehicle(homeStore: BootstrapData['vehicles'][number]['homeStore'], vin = 'TESTDATAOWNSTORE1', stockNumber = 'MOVE-TEST'): VehicleRecord {
  return {
    vin,
    stockNumber,
    year: 2023,
    make: 'Ford',
    model: 'Bronco',
    trim: 'Outer Banks',
    vehicleName: '2023 Ford Bronco Outer Banks',
    homeStore,
    publicStore: homeStore,
    homeStoreConfirmed: true,
    sourceReportedLocation: homeStore,
    websiteStatus: 'Available',
    publicListingState: 'Listed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'No current hold', backupCount: 0 },
    movement: { state: 'at_home', label: 'At home store', currentLocation: homeStore, locationConfidence: 'reported', newRequestBlocked: false },
  };
}

function detail(allowedActions: TransferDetail['allowedActions']): TransferDetail {
  return {
    id: 'transfer-return',
    vehicle: {
      vin: '1FTFW1E80RFA00001',
      stock: 'MOVE1',
      vehicleLabel: '2025 Ford F-150 Lariat',
      trimLabel: 'Lariat 4x4',
      homeStore: 'Howell',
      currentLocation: {
        label: 'Ford Detroit',
        confidence: 'verified',
        confirmedAt: '2026-08-30T12:00:00.000Z',
      },
      listedPriceLabel: '$52,500',
      mileageLabel: '12,345 mi',
      status: {
        dealerMail: { code: 'primary', label: 'Primary hold', tone: 'warning' },
        publicListing: { code: 'listed', label: 'Listed', tone: 'info' },
        cdk: { code: 'processing', label: 'Processing', tone: 'neutral' },
      },
    },
    requestingStore: 'Ford Detroit',
    destination: 'Howell',
    priority: 'high',
    requestedByLabel: 'Joe Gallant',
    approvalOwnerLabel: 'Ford Detroit manager',
    requestReason: 'Customer appointment',
    customerReference: 'Jane Customer',
    requestedAt: '2026-08-29T14:00:00.000Z',
    neededBy: '2026-09-01T15:00:00.000Z',
    custodianLabel: 'Joe Gallant',
    transportAssigneeLabel: 'Stacey Driver',
    returnRequired: true,
    returnDueAt: '2026-09-02T15:00:00.000Z',
    nextAction: {
      label: 'Confirm the vehicle returned home',
      ownerLabel: 'Howell manager',
      dueAt: '2026-09-01T15:00:00.000Z',
      sla: 'on-track',
    },
    status: {
      request: { code: 'approved', label: 'Home-store release confirmed', tone: 'success' },
      movement: { code: 'in-transit-return', label: 'Return in transit', tone: 'info' },
      deal: { code: 'shown-not-sold', label: 'Shown not sold', tone: 'warning' },
      delivery: { code: 'not-confirmed', label: 'Delivery not confirmed', tone: 'neutral' },
      dealerMail: { code: 'primary', label: 'Primary hold', tone: 'warning' },
      publicListing: { code: 'listed', label: 'Listed', tone: 'info' },
      cdk: { code: 'processing', label: 'Processing', tone: 'neutral' },
    },
    timeline: [{
      id: 'event-return',
      kind: 'return_in_transit',
      title: 'Return trip started',
      occurredAt: '2026-08-30T12:00:00.000Z',
      location: 'Ford Detroit',
      actorLabel: 'Stacey Driver',
      actorRole: 'driver',
      detail: 'Vehicle, keys, and condition report received.',
      source: 'app',
      custodianLabel: 'Joe Gallant',
      transportAssigneeLabel: 'Stacey Driver',
    }],
    allowedActions,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>;
}

function VehicleReturnLink() {
  const location = useLocation();
  return <Link to={new URLSearchParams(location.search).get('returnTo')!}>Back to move workspace</Link>;
}

function renderPage(data: BootstrapData, initialEntry = '/transfers', contextOverrides: Record<string, unknown> = {}, withLocation = false) {
  const submitTransfer = vi.fn().mockResolvedValue({ id: 'created-move-1' });
  mocks.useAppData.mockReturnValue({
    data,
    homeStore: 'Ford Detroit',
    role: 'manager',
    currentUser: 'Joe Manager',
    submitTransfer,
    ...contextOverrides,
  });
  mocks.getTransfer.mockImplementation((id: string) =>
    Promise.resolve(data.transfers.find((item) => item.id === id)),
  );
  return { ...render(<MemoryRouter initialEntries={[initialEntry]}><TransfersPage />{withLocation ? <LocationProbe /> : null}</MemoryRouter>), submitTransfer };
}

afterEach(() => { cleanup(); clearWorkspaceMemory(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('transfer workspace v3 layout', () => {
  beforeEach(() => {
    mocks.getTransfer.mockReset();
    mocks.useAppData.mockReset();
  });

  it('returns to the original task with a named link from a selected move', () => {
    const origin = '/attention?queue=service';
    renderPage(bootstrap(2), `/transfers?id=transfer-1&returnTo=${encodeURIComponent(origin)}`, {}, true);
    const back = screen.getByRole('link', { name: 'Back to Action center' });
    expect(back).toHaveAttribute('href', origin);
    fireEvent.click(back);
    expect(screen.getByTestId('router-location')).toHaveTextContent(origin);
  });

  it('keeps search, store scope and sorting when returning from a move to its queue', () => {
    renderPage(bootstrap(4), '/transfers', {}, true);
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search vehicle moves' }), { target: { value: 'MOVE2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort vehicle moves' }), { target: { value: 'stock' } });
    fireEvent.click(screen.getByRole('button', { name: /MOVE2.*Assign a driver/ }));
    expect(screen.getByTestId('router-location')).toHaveTextContent('returnTo=%2Ftransfers');
    fireEvent.click(screen.getByRole('link', { name: 'Back to vehicle moves' }));
    expect(screen.getByRole('textbox', { name: 'Search vehicle moves' })).toHaveValue('MOVE2');
    expect(screen.getByRole('combobox', { name: 'Sort vehicle moves' })).toHaveValue('stock');
    expect(screen.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens new phone details at the top and restores independent queue and per-move positions', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const y = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
    renderPage(bootstrap(4));
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }));
    y.mockReturnValue(200); fireEvent.scroll(window);
    fireEvent.click(screen.getByRole('button', { name: /MOVE2.*Assign a driver/ }));
    await waitFor(() => expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' }));
    y.mockReturnValue(392); fireEvent.scroll(window);
    y.mockReturnValue(92);
    fireEvent.click(screen.getByRole('button', { name: 'Back to vehicle moves' }));
    await waitFor(() => expect(scroll).toHaveBeenLastCalledWith({ top: 200, behavior: 'instant' }));
    fireEvent.click(screen.getByRole('button', { name: /MOVE2.*Assign a driver/ }));
    await waitFor(() => expect(scroll).toHaveBeenLastCalledWith({ top: 392, behavior: 'instant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to vehicle moves' }));
    await waitFor(() => expect(scroll).toHaveBeenLastCalledWith({ top: 200, behavior: 'instant' }));
    fireEvent.click(screen.getByRole('button', { name: /MOVE4.*Assign a driver/ }));
    await waitFor(() => expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' }));
  });

  it('preserves document position on a first desktop split-pane selection', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(200);
    renderPage(bootstrap(4));
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }));
    fireEvent.click(screen.getByRole('button', { name: /MOVE2.*Assign a driver/ }));
    await screen.findByRole('heading', { level: 2, name: '2025 Ford F-150 2' });
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(scroll).not.toHaveBeenCalled();
  });

  it('resets an empty persisted move view while preserving its sort', () => {
    renderPage(bootstrap(4));
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort vehicle moves' }), { target: { value: 'stock' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search vehicle moves' }), { target: { value: 'missing vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: /Completed/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter vehicle moves' }), { target: { value: 'issues' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(screen.getByRole('textbox', { name: 'Search vehicle moves' })).toHaveValue('');
    expect(screen.getByRole('button', { name: /Active/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Filter vehicle moves' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: 'Sort vehicle moves' })).toHaveValue('stock');
  });

  it('matches the move picker across vehicle and store fields and clears the query', () => {
    const data = bootstrap(0);
    data.vehicles = [inventoryVehicle('Howell')];
    renderPage(data, '/transfers/new', { role: 'group_manager' });
    const search = screen.getByRole('textbox', { name: 'Search inventory to move' });
    fireEvent.change(search, { target: { value: 'Bronco Howell' } });
    expect(screen.getAllByText('2023 Ford Bronco Outer Banks')).toHaveLength(2);
    fireEvent.change(search, { target: { value: 'missing vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear vehicle search' }));
    expect(search).toHaveValue('');
  });

  it('preserves the originating vehicle through the new-move picker and cancel', () => {
    const origin = '/inventory?scope=group&vin=TESTDATAOWNSTORE1&tab=hold';
    const data = bootstrap(0);
    data.vehicles = [inventoryVehicle('Howell')];
    renderPage(data, `/transfers/new?returnTo=${encodeURIComponent(origin)}`, { role: 'group_manager' }, true);
    fireEvent.click(screen.getByRole('button', { name: 'Move vehicle' }));
    expect(screen.getByTestId('router-location')).toHaveTextContent(`returnTo=${encodeURIComponent(origin)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('router-location')).toHaveTextContent(origin);
  });

  it('refuses an external return destination when tracking a move', () => {
    renderPage(bootstrap(2), '/transfers?id=transfer-1&returnTo=%2F%2Fevil.example');
    expect(screen.getByRole('link', { name: 'Back to vehicle moves' })).toHaveAttribute('href', '/transfers');
  });

  it.each([
    ['unknown', 'Waiting for service'],
    ['needs_service', 'Waiting for service'],
    ['in_service', 'In service'],
    ['serviced', 'Ready'],
  ] as const)('shows permissioned %s service status in the selected move without changing location or actions', (status, label) => {
    const current = detail(['confirm-return']);
    const source: VehicleRecord = {
      vin: current.vehicle.vin, stockNumber: current.vehicle.stock, year: 2025, make: 'Ford', model: 'F-150', trim: 'Lariat', vehicleName: current.vehicle.vehicleLabel,
      listedPrice: 51800, mileage: 12450, daysListed: 43, exteriorColor: 'Synthetic blue', engine: 'Synthetic 3.5L engine', drivetrain: '4WD',
      homeStore: 'Howell', publicStore: 'Howell', homeStoreConfirmed: true, sourceReportedLocation: 'Howell', websiteStatus: 'Available', publicListingState: 'Listed',
      dealerOn: { inStock: true, inTransit: false, inProduction: false }, hold: { state: 'none_observed', label: 'No current hold', backupCount: 0 },
      movement: { state: 'return_in_transit', label: 'Return in transit', currentLocation: 'Ford Detroit', locationConfidence: 'verified' },
      serviceReadiness: { vin: current.vehicle.vin, status, version: 2, serviceEnteredAt: '2026-09-13', completedAt: status === 'serviced' ? '2026-09-14' : null, updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: 'Howell', canManage: false },
    };
    const mapped = toTransferVehicle(source, bootstrap(0).meta);
    expect(mapped.serviceReadiness).toBe(source.serviceReadiness);
    expect(mapped).toMatchObject({ listedPriceLabel: '$51,800', mileageLabel: '12,450 mi', exteriorColor: 'Synthetic blue', engine: 'Synthetic 3.5L engine', drivetrain: '4WD', daysListed: 43 });
    const onAction = vi.fn();
    render(<TransferTracker transfer={{ ...current, workflowMode: 'simple', vehicle: mapped }} onAction={onAction} />);
    const support = screen.getByRole('region', { name: 'Vehicle reference facts' });
    const link = within(support).getByRole('link', { name: `${label}. Open service status for VIN ${source.vin}` });
    expect(link).toBeVisible();
    expect(link).toHaveAttribute('href', `/service?vin=${source.vin}`);
    expect(link).toHaveTextContent(label);
    expect(support).toHaveTextContent('$51,800');
    expect(support).toHaveTextContent('12,450 mi');
    expect(support).toHaveTextContent('Synthetic 3.5L engine');
    expect(support).toHaveTextContent('4WD');
    expect(support).toHaveTextContent('Synthetic blue');
    expect(within(support).getByRole('button', { name: 'Copy stock number: ' + source.stockNumber })).toBeVisible();
    expect(within(support).getByRole('button', { name: 'Copy VIN: ' + source.vin })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Vehicle location and time away' })).toHaveTextContent('Ford Detroit');
    expect(screen.getByRole('button', { name: 'Confirm back home' })).toBeVisible();
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(['simple', 'advanced'] as const)('places the %s move action before records and secondary history', (workflowMode) => {
    const current = detail(['confirm-return']);
    const { container } = render(<TransferTracker transfer={{ ...current, workflowMode }} onAction={vi.fn()} vehicleLinks={<nav aria-label="Vehicle reference"><a href={`/inventory?scope=group&vin=${current.vehicle.vin}`}>Vehicle details</a><a href={`/inventory?scope=group&vin=${current.vehicle.vin}&tab=data`}>Records</a></nav>} />);
    const action = screen.getByRole('region', { name: 'Next step' });
    const references = screen.getByRole('navigation', { name: 'Vehicle reference' });
    expect(action.compareDocumentPosition(references)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(action).toHaveTextContent(current.nextAction.ownerLabel!);
    expect(container.querySelector('.workflow-resource-row')).toBeNull();
    expect(screen.getByRole('link', { name: 'Records' })).toHaveAttribute('href', `/inventory?scope=group&vin=${current.vehicle.vin}&tab=data`);
  });

  it('links a selected current vehicle to its exact details and records without inline provider summaries', () => {
    const data = bootstrap(1);
    const current = data.transfers[0];
    data.vehicles = [{ vin: current.vin, stockNumber: current.stockNumber, vehicleName: current.vehicleName, homeStore: current.homeStore, publicListingState: 'Listed', movement: { state: 'return_in_transit', label: 'Return in transit', currentLocation: 'Ford Detroit', locationConfidence: 'reported' }, hold: { state: 'none_observed', label: 'No observed hold' } } as VehicleRecord];
    const { container } = renderPage(data);
    expect(screen.getByRole('link', { name: 'Vehicle details' })).toHaveAttribute('href', `/inventory?scope=group&vin=${current.vin}&returnTo=%2Ftransfers`);
    expect(screen.getByRole('link', { name: 'Records' })).toHaveAttribute('href', `/inventory?scope=group&vin=${current.vin}&tab=data&returnTo=%2Ftransfers`);
    expect(container.querySelector('.workflow-resource-row')).toBeNull();
  });

  it('does not infer service completion from a returned vehicle without a service record', () => {
    const current = detail([]);
    current.status.movement = { code: 'returned-home-confirmed', label: 'Back at home store' };
    render(<TransferTracker transfer={{ ...current, workflowMode: 'simple' }} />);
    expect(screen.getByRole('link', { name: /^Waiting for service\. Open service status/ })).toHaveTextContent(/^Waiting for service$/);
    expect(screen.getByRole('heading', { name: 'Back home · move complete' })).toBeVisible();
  });

  it('keeps a clear master-detail workspace even when only one or two moves are present', () => {
    const { container } = renderPage(bootstrap(2));

    const layout = container.querySelector('.transfers-layout');
    expect(layout).toHaveClass('transfers-layout--master-detail');
    expect(layout).not.toHaveClass('transfers-layout--short-queue');
    expect(layout).toHaveAttribute('data-queue-size', '2');
    expect(container.querySelector('.transfer-list')).not.toHaveClass('transfer-list--short');
    expect(container.querySelectorAll('.transfer-list-item')).toHaveLength(2);
    expect(container.querySelector('#transfer-detail-workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2025 Ford F-150 1' })).toBeInTheDocument();
  });

  it('keeps longer queues in the same comparison and detail layout', () => {
    const { container } = renderPage(bootstrap(4));

    const layout = container.querySelector('.transfers-layout');
    expect(layout).toHaveClass('transfers-layout--master-detail');
    expect(layout).toHaveAttribute('data-queue-size', '4');
    expect(container.querySelector('.transfer-list')).not.toHaveClass('transfer-list--short');
    expect(container.querySelectorAll('.transfer-list-item')).toHaveLength(4);
  });

  it('renders the queue-first mobile contract without placing the selected detail in the queue state', () => {
    const { container } = renderPage(bootstrap(4));

    const page = container.querySelector('.vehicle-moves-page');
    expect(page).toHaveAttribute('data-mobile-detail-open', 'false');
    expect(container.querySelectorAll('.transfer-list-copy--concise')).toHaveLength(4);
    expect(screen.getByRole('combobox', { name: 'Filter vehicle moves' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort vehicle moves' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a vehicle move' })).toHaveTextContent('Start a move');
    expect(screen.getByRole('button', { name: /2025 Ford F-150 1/i })).toHaveTextContent('MOVE1');
    expect(screen.getByRole('button', { name: /2025 Ford F-150 1/i })).toHaveTextContent('Manager 1');
  });

  it('opens an in-page searchable vehicle picker when no VIN is selected', () => {
    renderPage(bootstrap(0), '/transfers/new');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Start a move' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search inventory to move' })).toBeInTheDocument();
    expect(screen.getByText('No matching vehicles')).toBeInTheDocument();
  });

  it.each([
    ['manager', 'Ford Detroit', 'Move vehicle'],
    ['manager', 'Howell', 'Request to Ford Detroit'],
    ['sales', 'Ford Detroit', null],
    ['sales', 'Howell', 'Request to Ford Detroit'],
    ['group_manager', 'Ford Detroit', 'Move vehicle'],
    ['group_manager', 'Howell', 'Move vehicle'],
  ] as const)('offers the correct picker action for %s on %s inventory', (role, vehicleStore, expectedAction) => {
    const data = bootstrap(0);
    data.vehicles = [inventoryVehicle(vehicleStore)];
    renderPage(data, '/transfers/new', { role });
    if (expectedAction) expect(screen.getByRole('button', { name: expectedAction })).toBeInTheDocument();
    else expect(screen.getByText('No matching vehicles')).toBeInTheDocument();
  });

  it('opens a dedicated mobile detail state and returns to the queue', () => {
    const { container } = renderPage(bootstrap(4), '/transfers?id=transfer-2');

    const page = container.querySelector('.vehicle-moves-page');
    expect(page).toHaveAttribute('data-mobile-detail-open', 'true');
    const detailBar = container.querySelector('.transfer-mobile-detail-bar');
    expect(detailBar).toHaveTextContent('Vehicle move');
    expect(detailBar).toHaveTextContent('MOVE2');
    expect(detailBar).toHaveTextContent('Step 4 of 5');
    expect(detailBar).toHaveTextContent('Released · assign a driver');
    expect(within(detailBar as HTMLElement).getByRole('heading', { level: 1, name: 'Vehicle move' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '2025 Ford F-150 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to vehicle moves' }));

    expect(page).toHaveAttribute('data-mobile-detail-open', 'false');
  });

  it('filters the mobile move queue by actionable operating signals', () => {
    renderPage(bootstrap(4));

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter vehicle moves' }), {
      target: { value: 'driver-needed' },
    });

    expect(screen.getByText('No moves match this view and search.')).toBeInTheDocument();
  });

  it('shows the simple location workflow without dispatch stages or driver filters', () => {
    const data = bootstrap(2);
    data.transfers.forEach(record => {
      record.workflowMode = 'simple';
      record.allowedActions = ['record-outcome', 'schedule-return', 'report-condition'];
      record.nextAction = 'Show the vehicle, then start its return';
    });
    const { container } = renderPage(data);
    expect(container.querySelector('.simple-transfer-tracker')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Inter-store request approval and movement progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Driver needed' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update the showing outcome' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vehicle location and time away' })).toHaveTextContent('At home store');
    expect(screen.getByRole('button', { name: /My store Ford Detroit/ })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.transfer-list-item')).toHaveLength(2);
  });

  it('starts with moves connected to the employee store and deliberately expands to the group', () => {
    const data = bootstrap(2);
    data.transfers[1] = { ...data.transfers[1], requestingStore: 'Lincoln', destination: 'Lincoln' };
    const { container } = renderPage(data);
    expect(container.querySelectorAll('.transfer-list-item')).toHaveLength(1);
    expect(container.querySelector('.transfer-list-item')).toHaveTextContent('MOVE1');
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }));
    expect(container.querySelectorAll('.transfer-list-item')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Active/ })).toHaveTextContent('2');
  });

  it('opens an authorized completed deep link independently of active queue filters', () => {
    const data = bootstrap(2);
    data.transfers[1] = { ...data.transfers[1], workflowMode: 'simple', requestStatus: 'closed', movementStatus: 'returned_home', allowedActions: [] };
    const { container } = renderPage(data, '/transfers?id=transfer-2');
    expect(container.querySelectorAll('.transfer-list-item')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '2025 Ford F-150 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Back home · move complete' })).toBeInTheDocument();
  });

  it('keeps authorized return and issue actions directly available beside the primary move action', () => {
    const onAction = vi.fn();
    render(<TransferTracker transfer={{ ...detail(['record-outcome', 'schedule-return', 'report-condition']), workflowMode: 'simple' }} onAction={onAction} />);
    const actions = screen.getByLabelText('Available move actions');
    expect(within(actions).getAllByRole('button')).toHaveLength(3);
    expect(within(actions).getByRole('button', { name: 'Update the showing outcome' })).toBeInTheDocument();
    fireEvent.click(within(actions).getByRole('button', { name: 'Start return' }));
    expect(onAction).toHaveBeenCalledWith('schedule-return', expect.objectContaining({ id: 'transfer-return' }));
    expect(within(actions).getByRole('button', { name: 'Report a vehicle issue' })).toBeInTheDocument();
  });

  it('labels a direct move with its recorded movement time instead of a false needed-by time', () => {
    const direct = detail(['record-outcome']);
    direct.timeline = [{
      id: 'direct-1',
      kind: 'direct_move_recorded',
      title: 'Vehicle moved directly',
      occurredAt: '2026-09-18T21:30:00.000Z',
      location: 'Ford Detroit',
      actorLabel: 'Group Manager',
      actorRole: 'group_manager',
      source: 'app',
    }];
    render(<TransferTracker transfer={{ ...direct, workflowMode: 'simple' }} />);
    const summary = screen.getByRole('region', { name: 'Request and vehicle summary' });
    expect(within(summary).getByText('Move details')).toBeInTheDocument();
    expect(within(summary).getByText('Moved at')).toBeInTheDocument();
    expect(within(summary).getByText('09/18/2026, 5:30 PM')).toBeInTheDocument();
    expect(within(summary).queryByText('Needed by')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Requesting-store manager')).not.toBeInTheDocument();
    const progress = screen.getByRole('list', { name: 'Vehicle move progress' });
    expect(within(progress).getByText('At destination')).toBeInTheDocument();
    expect(within(progress).queryByText('Approval')).not.toBeInTheDocument();
  });

  it('shows a sold-pending vehicle waiting on its delivery, never on a return home', () => {
    const sold = detail(['record-outcome', 'report-condition']);
    sold.timeline = [{
      id: 'direct-sold',
      kind: 'direct_move_recorded',
      title: 'Vehicle moved to destination store',
      occurredAt: '2026-09-19T16:27:00.000Z',
      location: 'Howell',
      actorLabel: 'Group Manager',
      actorRole: 'group_manager',
      source: 'app',
    }];
    sold.status = {
      ...sold.status,
      request: { code: 'submitted', label: 'Sale confirmed', tone: 'info' },
      movement: { code: 'at-requesting-store-verified', label: 'At requesting store', tone: 'location' },
      deal: { code: 'sold-pending', label: 'Sold pending — delivery not confirmed', tone: 'info' },
      delivery: { code: 'not-confirmed', label: 'Delivery not confirmed', tone: 'neutral' },
    };
    sold.nextAction = { label: 'Confirm delivery, or record the deal fell through', ownerLabel: 'Howell manager', sla: 'on-track' };
    const onAction = vi.fn();
    render(<TransferTracker transfer={{ ...sold, workflowMode: 'simple' }} onAction={onAction} />);
    const progress = screen.getByRole('list', { name: 'Vehicle move progress' });
    expect(within(progress).queryByText('Return home')).not.toBeInTheDocument();
    expect(within(progress).getByText('Customer delivery').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(progress).getByText('At destination').closest('li')).toHaveClass('is-complete');
    const summary = screen.getByRole('region', { name: 'Request and vehicle summary' });
    expect(within(summary).getByText('Paused while sold pending')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Next step' })).not.toHaveTextContent(/return/i);
    fireEvent.click(within(screen.getByLabelText('Available move actions')).getByRole('button', { name: 'Confirm delivery or update the outcome' }));
    expect(onAction).toHaveBeenCalledWith('record-outcome', expect.objectContaining({ id: 'transfer-return' }));
  });

  it('marks a delivered vehicle complete with no return step', () => {
    const delivered = detail([]);
    delivered.status = {
      ...delivered.status,
      request: { code: 'closed', label: 'Complete', tone: 'success' },
      movement: { code: 'at-requesting-store-verified', label: 'At requesting store', tone: 'location' },
      deal: { code: 'sold-pending', label: 'Sold pending — delivery not confirmed', tone: 'info' },
      delivery: { code: 'confirmed', label: 'Delivery confirmed', tone: 'success' },
    };
    render(<TransferTracker transfer={{ ...delivered, workflowMode: 'simple' }} />);
    expect(screen.getByRole('heading', { name: 'Delivered · move complete' })).toBeInTheDocument();
    const progress = screen.getByRole('list', { name: 'Vehicle move progress' });
    expect(within(progress).queryByText('Return home')).not.toBeInTheDocument();
    expect(within(progress).getByText('Customer delivery').closest('li')).toHaveClass('is-complete');
    expect(within(screen.getByRole('region', { name: 'Request and vehicle summary' })).getByText('Not required · delivered')).toBeInTheDocument();
  });

  it('credits custody at the destination without claiming the vehicle was collected', () => {
    const outcome = detail(['schedule-return']);
    outcome.destination = 'Ford Detroit';
    outcome.timeline = [{
      id: 'outcome-1',
      kind: 'sale_confirmed',
      title: 'Sale confirmed',
      occurredAt: '2026-09-18T21:30:00.000Z',
      location: 'Ford Detroit',
      actorLabel: 'Joe Gallant',
      actorRole: 'sales',
      source: 'app',
    }];
    render(<TransferTracker transfer={{ ...outcome, workflowMode: 'simple' }} />);
    const timing = screen.getByRole('region', { name: 'Vehicle location and time away' });
    expect(within(timing).getByText(/^At Ford Detroit since /)).toBeInTheDocument();
    expect(within(timing).queryByText(/Collected/)).not.toBeInTheDocument();
    expect(within(timing).queryByText('Departure not recorded')).not.toBeInTheDocument();
  });

  it('keeps advanced direct-move records free of request approval and needed-by language', () => {
    const direct = detail(['record-outcome']);
    direct.timeline = [{
      id: 'direct-advanced-1',
      kind: 'direct_move_recorded',
      title: 'Vehicle moved directly',
      occurredAt: '2026-09-18T21:30:00.000Z',
      location: 'Ford Detroit',
      actorLabel: 'Group Manager',
      actorRole: 'group_manager',
      source: 'app',
    }];
    render(<TransferTracker transfer={direct} />);
    const summary = screen.getByRole('region', { name: 'Move and vehicle summary' });
    expect(within(summary).getByText('Move details')).toBeInTheDocument();
    expect(within(summary).getByText('Moved at')).toBeInTheDocument();
    expect(within(summary).queryByText('Needed by')).not.toBeInTheDocument();
    const accountability = screen.getByRole('region', { name: 'Location and accountability' });
    expect(within(accountability).getByText('Destination store')).toBeInTheDocument();
    expect(within(accountability).queryByText('Requesting-store approval owner')).not.toBeInTheDocument();
    expect(within(accountability).queryByText('Home-store release authority')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Inter-store request approval and movement progress' })).not.toBeInTheDocument();
  });

  it('lets a store manager directly move their own inventory and submits destination plus an ISO moved-at time', async () => {
    const data = bootstrap(0);
    data.vehicles = [inventoryVehicle('Ford Detroit')];
    data.stores = [
      { store: 'Ford Detroit' },
      { store: 'Howell' },
    ] as BootstrapData['stores'];
    const { submitTransfer } = renderPage(data, '/transfers/new?vin=TESTDATAOWNSTORE1&intent=request');
    expect(screen.getByRole('heading', { name: 'Move vehicle' })).toBeInTheDocument();
    expect(screen.queryByText('Requesting-store manager')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Destination store'), { target: { value: 'Howell' } });
    const localMovedAt = '2026-09-18T17:30';
    const localReturnAt = '2026-09-19T12:15';
    fireEvent.change(screen.getByLabelText('Moved at'), { target: { value: localMovedAt } });
    fireEvent.change(screen.getByLabelText('Why is it moving?'), { target: { value: 'Detroit picked it up for a customer showing' } });
    fireEvent.click(screen.getByText('Optional details: return timing and customer reference'));
    fireEvent.change(screen.getByLabelText(/Preferred return by/), { target: { value: localReturnAt } });
    fireEvent.click(screen.getByRole('button', { name: 'Move to Howell' }));
    await waitFor(() => expect(submitTransfer).toHaveBeenCalledTimes(1));
    expect(submitTransfer).toHaveBeenCalledWith(expect.objectContaining({
      vin: 'TESTDATAOWNSTORE1',
      intent: 'direct',
      requestingStore: 'Ford Detroit',
      destinationStore: 'Howell',
      movedAt: new Date(localMovedAt).toISOString(),
      returnDueAt: new Date(localReturnAt).toISOString(),
    }));
    expect(submitTransfer.mock.calls[0]?.[0]).not.toHaveProperty('neededBy');
    expect(await screen.findByRole('heading', { name: 'Vehicle move recorded' })).toBeInTheDocument();
  });

  it.each([
    ['/\\evil.example', '/transfers'],
    ['//evil.example', '/transfers'],
    ['/inventory?scope=group', '/inventory?scope=group'],
  ])('cancels a move back to %s only when it is a path this app made', (returnTo, expected) => {
    const data = bootstrap(0);
    data.vehicles = [inventoryVehicle('Ford Detroit')];
    data.stores = [{ store: 'Ford Detroit' }, { store: 'Howell' }] as BootstrapData['stores'];
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Ford Detroit', role: 'manager', currentUser: 'Joe Manager', submitTransfer: vi.fn() });
    render(
      <MemoryRouter initialEntries={[`/transfers/new?vin=TESTDATAOWNSTORE1&intent=request&returnTo=${encodeURIComponent(returnTo)}`]}>
        <TransfersPage />
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('router-location').textContent).toBe(expected);
  });

  it('keeps Track and Move again reachable for a server-authorized active direct move', () => {
    const data = bootstrap(1);
    const active = data.transfers[0];
    data.vehicles = [inventoryVehicle('Howell', active.vin, active.stockNumber)];
    data.vehicles[0].movement = {
      ...data.vehicles[0].movement,
      transferId: active.id,
      requestStatus: active.requestStatus,
      newRequestBlocked: true,
      canDirectReroute: true,
    };
    data.stores = [{ store: 'Ford Detroit' }, { store: 'Howell' }, { store: 'Lincoln' }] as BootstrapData['stores'];
    renderPage(data, '/transfers/new', { role: 'group_manager' });
    expect(screen.getByRole('button', { name: 'Track move' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move again' }));
    expect(screen.getByRole('heading', { name: 'Move vehicle' })).toBeInTheDocument();
  });

  it('keeps the home store available when an authorized direct move is currently In transit', () => {
    const data = bootstrap(0);
    const unit = inventoryVehicle('Howell', 'TESTDATAINTRANSIT1', 'MOVE-TRANSIT');
    unit.movement = {
      ...unit.movement,
      state: 'in_transit',
      currentLocation: 'In transit',
      locationConfidence: 'verified',
      canDirectReroute: true,
      newRequestBlocked: true,
    };
    data.vehicles = [unit];
    data.stores = [{ store: 'Howell' }, { store: 'Ford Detroit' }, { store: 'Lincoln' }] as BootstrapData['stores'];
    renderPage(data, '/transfers/new?vin=TESTDATAINTRANSIT1&intent=direct', { role: 'group_manager' });
    const destination = screen.getByLabelText('Destination store');
    expect(within(destination).getByRole('option', { name: 'Howell' })).toBeInTheDocument();
    expect(within(destination).getByRole('option', { name: 'Ford Detroit' })).toBeInTheDocument();
  });

  it('excludes the home store for an initial direct move when no movement location has been reported', () => {
    const data = bootstrap(0);
    const unit = inventoryVehicle('Howell', 'TESTDATAINITIALMOVE1', 'MOVE-INITIAL');
    delete (unit.movement as Partial<NonNullable<VehicleRecord['movement']>>).currentLocation;
    data.vehicles = [unit];
    data.stores = [{ store: 'Howell' }, { store: 'Ford Detroit' }, { store: 'Lincoln' }] as BootstrapData['stores'];
    renderPage(data, '/transfers/new?vin=TESTDATAINITIALMOVE1&intent=direct', { role: 'group_manager' });
    const destination = screen.getByLabelText('Destination store');
    expect(within(destination).queryByRole('option', { name: 'Howell' })).not.toBeInTheDocument();
    expect(within(destination).getByRole('option', { name: 'Ford Detroit' })).toBeInTheDocument();
  });

  it('uses second precision and starts a reroute strictly after the latest confirmed location event', async () => {
    const data = bootstrap(0);
    const confirmedAt = '2099-09-18T21:30:45.000Z';
    const unit = inventoryVehicle('Howell', 'TESTDATAREROUTETIME1', 'MOVE-TIME');
    unit.movement = {
      ...unit.movement,
      currentLocation: 'Ford Detroit',
      lastConfirmedAt: confirmedAt,
      locationConfidence: 'verified',
      canDirectReroute: true,
      newRequestBlocked: true,
    };
    data.vehicles = [unit];
    data.stores = [{ store: 'Howell' }, { store: 'Ford Detroit' }, { store: 'Lincoln' }] as BootstrapData['stores'];
    const { submitTransfer } = renderPage(data, '/transfers/new?vin=TESTDATAREROUTETIME1&intent=direct', { role: 'group_manager' });
    const movedAt = screen.getByLabelText('Moved at');
    expect(movedAt).toHaveAttribute('step', '1');
    expect(new Date((movedAt as HTMLInputElement).value).getTime()).toBeGreaterThan(new Date(confirmedAt).getTime());

    const confirmed = new Date(confirmedAt);
    const equalLocal = new Date(confirmed.getTime() - confirmed.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    fireEvent.change(movedAt, { target: { value: equalLocal } });
    fireEvent.change(screen.getByLabelText('Destination store'), { target: { value: 'Howell' } });
    fireEvent.change(screen.getByLabelText('Why is it moving?'), { target: { value: 'Same-minute reroute correction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move to Howell' }));
    expect(movedAt).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findAllByText('Moved at must be after the latest confirmed location update.')).toHaveLength(2);
    expect(submitTransfer).not.toHaveBeenCalled();
  });

  it('labels another store vehicle as an inbound request for a store manager', () => {
    const data = bootstrap(0);
    data.vehicles = [inventoryVehicle('Howell', 'TESTDATAOTHERSTORE1', 'H-OTHER')];
    data.stores = [{ store: 'Ford Detroit' }, { store: 'Howell' }] as BootstrapData['stores'];
    renderPage(data, '/transfers/new');
    expect(screen.getByRole('button', { name: 'Request to Ford Detroit' })).toBeInTheDocument();
  });

  it('keeps the actual next step in the row while the vehicle is away', () => {
    const data = bootstrap(1);
    data.transfers[0] = { ...data.transfers[0], workflowMode: 'simple', currentLocation: 'Ford Detroit', nextAction: 'Confirm the vehicle is back at Howell' };
    renderPage(data);
    expect(screen.getByRole('button', { name: /2025 Ford F-150 1/ })).toHaveTextContent('NextConfirm the vehicle is back at Howell');
  });

  it('reads a legacy stored next step with the same store name a new row carries', () => {
    const data = bootstrap(1);
    data.transfers[0] = { ...data.transfers[0], workflowMode: 'simple', currentLocation: 'In transit', nextAction: 'Home manager confirms receipt' };
    renderPage(data);
    expect(screen.getByRole('button', { name: /2025 Ford F-150 1/ })).toHaveTextContent('NextConfirm the vehicle is back at Howell');
  });

  it('refreshes same-ID move details after an event without cancelling the current read', async () => {
    const data = bootstrap(1);
    data.transfers[0] = { ...data.transfers[0], workflowMode: 'simple', requestStatus: 'requested', allowedActions: ['approve'], privateEvidence: undefined, nextAction: 'Check availability and approve' };
    const initialPrivate = { ...data.transfers[0], privateEvidence: { requestReason: 'Previous private detail' } };
    let resolveCurrent!: (record: TransferRecord) => void;
    mocks.getTransfer.mockResolvedValueOnce(initialPrivate).mockImplementationOnce(() => new Promise<TransferRecord>(resolve => { resolveCurrent = resolve; }));
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    const { rerender } = render(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    expect(await screen.findByText('Previous private detail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve this move' })).toBeInTheDocument();

    const updated = { ...data.transfers[0], requestStatus: 'approved', allowedActions: ['record-outcome', 'schedule-return'], nextAction: 'Show the vehicle, then start its return' };
    const currentData = { ...data, transfers: [updated] };
    mocks.useAppData.mockReturnValue({ data: currentData, homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    rerender(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    expect(screen.queryByText('Previous private detail')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve this move' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update the showing outcome' })).toBeInTheDocument();
    expect(mocks.getTransfer).toHaveBeenCalledTimes(2);
    expect(mocks.getTransfer).toHaveBeenNthCalledWith(1, 'transfer-1', 'manager', 'Howell');
    expect(mocks.getTransfer).toHaveBeenNthCalledWith(2, 'transfer-1', 'manager', 'Howell');
    await act(async () => { resolveCurrent({ ...updated, privateEvidence: { requestReason: 'Current private detail' } }); });
    expect(screen.getByText('Current private detail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update the showing outcome' })).toBeInTheDocument();
  });

  it('does not abort a healthy detail request when an unchanged bootstrap response is replayed', async () => {
    const data = bootstrap(1);
    mocks.getTransfer.mockImplementation(() => new Promise<TransferRecord>(() => {}));
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    const { rerender } = render(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.getTransfer).toHaveBeenCalledTimes(1));

    // This mirrors a React replay or a fresh bootstrap response with the same
    // server values but new JavaScript object identities.
    const replayedData = {
      ...data,
      transfers: data.transfers.map((record) => ({
        ...record,
        allowedActions: record.allowedActions ? [...record.allowedActions] : undefined,
        events: record.events.map((event) => ({ ...event })),
      })),
    };
    mocks.useAppData.mockReturnValue({ data: replayedData, homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    rerender(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);

    await waitFor(() => expect(mocks.getTransfer).toHaveBeenCalledTimes(1));
    expect(mocks.getTransfer).toHaveBeenCalledWith('transfer-1', 'manager', 'Howell');
  });

  it('keeps the move summary readable after a failed detail read and restores full evidence on retry', async () => {
    const data = bootstrap(1);
    data.transfers[0] = { ...data.transfers[0], workflowMode: 'simple', privateEvidence: undefined };
    let resolveRetry!: (record: TransferRecord) => void;
    mocks.getTransfer.mockRejectedValueOnce(new Error('Temporary failure'))
      .mockImplementationOnce(() => new Promise<TransferRecord>(resolve => { resolveRetry = resolve; }));
    mocks.useAppData.mockReturnValue({ data, currentUser: 'Employee one', homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    render(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    const retry = await screen.findByRole('button', { name: 'Retry move details' });
    expect(screen.getByRole('alert')).toHaveTextContent('The summary remains available');
    expect(screen.getAllByText('2025 Ford F-150 1').length).toBeGreaterThan(0);
    fireEvent.click(retry);
    expect(screen.getByRole('status')).toHaveTextContent('Loading full move record');
    await act(async () => { resolveRetry({ ...data.transfers[0], privateEvidence: { requestReason: 'Recovered authorized details' } }); });
    expect(screen.getByText('Recovered authorized details')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry move details' })).not.toBeInTheDocument();
    expect(mocks.getTransfer).toHaveBeenCalledTimes(2);
  });

  it.each(['success', 'failure'] as const)('ignores a late %s from a retried move detail after access changes', async (outcome) => {
    const data = bootstrap(1);
    data.transfers[0] = { ...data.transfers[0], workflowMode: 'simple', privateEvidence: undefined };
    let resolveRetry!: (record: TransferRecord) => void;
    let rejectRetry!: (error: Error) => void;
    const restricted = { ...data.transfers[0], allowedActions: [], nextAction: 'Waiting for requesting-store manager' };
    mocks.getTransfer.mockRejectedValueOnce(new Error('Temporary failure'))
      .mockImplementationOnce(() => new Promise<TransferRecord>((resolve, reject) => { resolveRetry = resolve; rejectRetry = reject; }))
      .mockResolvedValueOnce(restricted);
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    const { rerender } = render(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry move details' }));
    mocks.useAppData.mockReturnValue({ data: { ...data, transfers: [restricted] }, homeStore: 'Ford Detroit', role: 'sales', submitTransfer: vi.fn() });
    rerender(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.getTransfer).toHaveBeenCalledTimes(3));
    await act(async () => {
      if (outcome === 'success') resolveRetry({ ...data.transfers[0], privateEvidence: { requestReason: 'Previous access retry evidence' } });
      else rejectRetry(new Error('Previous access failure'));
    });
    expect(screen.queryByText('Previous access retry evidence')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry move details' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waiting for requesting-store manager' })).toBeInTheDocument();
  });

  it('withdraws cached move details when the employee changes within the same role and store', async () => {
    const data = bootstrap(1);
    data.transfers[0] = { ...data.transfers[0], workflowMode: 'simple', privateEvidence: undefined };
    mocks.getTransfer.mockResolvedValueOnce({ ...data.transfers[0], privateEvidence: { requestReason: 'Previous employee detail' } })
      .mockImplementationOnce(() => new Promise(() => {}));
    mocks.useAppData.mockReturnValue({ data, currentUser: 'Employee one', homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    const { rerender } = render(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    expect(await screen.findByText('Previous employee detail')).toBeInTheDocument();
    mocks.useAppData.mockReturnValue({ data, currentUser: 'Employee two', homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    rerender(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    expect(screen.queryByText('Previous employee detail')).not.toBeInTheDocument();
    expect(mocks.getTransfer).toHaveBeenCalledTimes(2);
  });

  it('does not let a previous role/store detail response overwrite the current access view', async () => {
    const data = bootstrap(1);
    data.transfers[0] = { ...data.transfers[0], workflowMode: 'simple', requestStatus: 'requested', allowedActions: ['approve'], privateEvidence: undefined };
    let resolvePrevious!: (record: TransferRecord) => void;
    const restricted = { ...data.transfers[0], allowedActions: [], nextAction: 'Waiting for requesting-store manager', privateEvidence: undefined };
    mocks.getTransfer.mockImplementationOnce(() => new Promise<TransferRecord>(resolve => { resolvePrevious = resolve; })).mockResolvedValueOnce(restricted);
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    const { rerender } = render(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    mocks.useAppData.mockReturnValue({ data: { ...data, transfers: [restricted] }, homeStore: 'Ford Detroit', role: 'sales', submitTransfer: vi.fn() });
    rerender(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.getTransfer).toHaveBeenLastCalledWith('transfer-1', 'sales', 'Ford Detroit'));
    expect(mocks.getTransfer.mock.calls[0]).toHaveLength(3);
    expect(mocks.getTransfer.mock.calls[1]).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Approve this move' })).not.toBeInTheDocument();
    await act(async () => { resolvePrevious({ ...data.transfers[0], privateEvidence: { requestReason: 'Other access private reason' } }); });
    expect(screen.queryByText('Other access private reason')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve this move' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waiting for requesting-store manager' })).toBeInTheDocument();
  });

  it('hides cached private data immediately when the access context changes with the same bootstrap record', async () => {
    const data = bootstrap(1);
    data.transfers[0] = { ...data.transfers[0], workflowMode: 'simple', requestStatus: 'requested', allowedActions: [], privateEvidence: undefined };
    mocks.getTransfer.mockResolvedValueOnce({ ...data.transfers[0], allowedActions: ['approve'], privateEvidence: { requestReason: 'Manager-only private reason' } }).mockImplementationOnce(() => new Promise(() => {}));
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Howell', role: 'manager', submitTransfer: vi.fn() });
    const { rerender } = render(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    expect(await screen.findByText('Manager-only private reason')).toBeInTheDocument();
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Ford Detroit', role: 'sales', submitTransfer: vi.fn() });
    rerender(<MemoryRouter initialEntries={['/transfers?id=transfer-1']}><TransfersPage /></MemoryRouter>);
    expect(screen.queryByText('Manager-only private reason')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve this move' })).not.toBeInTheDocument();
    expect(mocks.getTransfer).toHaveBeenLastCalledWith('transfer-1', 'sales', 'Ford Detroit');
  });

  it('does not attach cancellation signals to selected-detail reads', () => {
    const data = bootstrap(1);
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Ford Detroit', role: 'manager', submitTransfer: vi.fn() });
    mocks.getTransfer.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<MemoryRouter><TransfersPage /></MemoryRouter>);
    expect(mocks.getTransfer).toHaveBeenCalledWith('transfer-1', 'manager', 'Ford Detroit');
    expect(mocks.getTransfer.mock.calls[0]).toHaveLength(3);
    unmount();
  });

  it('moves received simple vehicles into history without another close step', () => {
    const data = bootstrap(2);
    data.transfers[0].workflowMode = 'simple';
    data.transfers[0].requestStatus = 'closed';
    data.transfers[0].movementStatus = 'returned_home';
    data.transfers[0].allowedActions = ['open-source'];
    data.transfers[1].workflowMode = 'simple';
    renderPage(data);
    expect(screen.queryByRole('button', { name: /2025 Ford F-150 1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Completed\s*1/ }));
    expect(screen.getByRole('button', { name: /2025 Ford F-150 1/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Back home · move complete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close the move' })).not.toBeInTheDocument();
  });

  it.each([
    ['TESTDATAHWELL0001', false],
    ['1FTFW1E80RFA00001', true],
  ])('opens a transfer source only when its adapted listing URL is available for VIN %s', async (vin, canOpenSource) => {
    const data = bootstrap(1);
    const record = data.transfers[0];
    record.vin = vin;
    record.allowedActions = ['confirm-return', 'open-source'];
    const vehicle = inventoryVehicle('Howell', vin);
    vehicle.listingUrl = 'https://www.bobmaxeyfordhowell.com/used-synthetic-reference';
    data.vehicles = [vehicle];
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderPage(data, '/transfers?id=transfer-1');
    const actions = await screen.findByRole('contentinfo', { name: 'Available move actions' });

    if (canOpenSource) {
      fireEvent.click(within(actions).getByText('More actions'));
      const sourceAction = within(actions).queryByRole('button', { name: 'Open original record' });
      expect(sourceAction).toBeInTheDocument();
      fireEvent.click(sourceAction!);
      expect(open).toHaveBeenCalledWith(vehicle.listingUrl, '_blank', 'noopener,noreferrer');
    } else {
      expect(within(actions).queryByText('More actions')).not.toBeInTheDocument();
      expect(open).not.toHaveBeenCalled();
    }
  });

  it('shows one requesting-manager check and no second-store approval in a simple request', () => {
    const vehicle = { ...detail([]).vehicle, exteriorColor: 'Synthetic blue', engine: 'Synthetic engine', drivetrain: '4WD', daysListed: 12 };
    render(<TransferRequestWorkspace workflowMode="simple" vehicle={vehicle} stores={[{ value: 'Ford Detroit', label: 'Ford Detroit' }]} requesters={[{ value: 'sales', label: 'Demo Sales' }]} managerApprovers={[{ value: 'manager', label: 'Ford Detroit manager' }]} defaultRequestingStore="Ford Detroit" defaultRequesterId="sales" defaultManagerApproverId="manager" onSubmit={vi.fn()} />);
    const header = screen.getByRole('heading', { name: vehicle.vehicleLabel }).closest('header');
    expect(header).toHaveTextContent('$52,500 · 12,345 mi · 12 days listed');
    expect(header).toHaveTextContent('Synthetic blue · Synthetic engine · 4WD');
    expect(within(header!).getByRole('link', { name: /^Waiting for service\. Open service status/ })).toHaveTextContent(/^Waiting for service$/);
    expect(document.querySelector('.move-request-current-location')).toHaveTextContent('Ford Detroit');
    const preview = screen.getByRole('complementary', { name: 'Request accountability preview' });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
    expect(preview).toHaveTextContent('Your manager checks and approves');
    expect(preview).toHaveTextContent('They confirm availability with Howell and approve this move.');
    expect(preview).not.toHaveTextContent('assign a driver');
    expect(screen.queryByText('Customer is waiting now')).not.toBeInTheDocument();
  });

  it('opens the exact saved simple request from its confirmation', async () => {
    const onViewRequest = vi.fn();
    render(<TransferRequestWorkspace workflowMode="simple" vehicle={detail([]).vehicle} stores={[{ value: 'Ford Detroit', label: 'Ford Detroit' }]} requesters={[{ value: 'sales', label: 'Demo Sales' }]} managerApprovers={[{ value: 'manager', label: 'Ford Detroit manager' }]} defaultRequestingStore="Ford Detroit" defaultRequesterId="sales" defaultManagerApproverId="manager" onSubmit={vi.fn().mockResolvedValue({ requestId: 'saved-move-123' })} onViewRequest={onViewRequest} />);
    fireEvent.change(screen.getByLabelText('Needed by'), { target: { value: '2026-09-15T10:00' } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Synthetic customer visit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask my manager' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View this move' }));
    expect(onViewRequest).toHaveBeenCalledWith('saved-move-123');
  });

  it('keeps an edited move request when Cancel is declined and protects browser refresh', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onCancel = vi.fn();
    render(<TransferRequestWorkspace workflowMode="simple" vehicle={detail([]).vehicle} stores={[{ value: 'Ford Detroit', label: 'Ford Detroit' }]} requesters={[{ value: 'sales', label: 'Demo Sales' }]} managerApprovers={[{ value: 'manager', label: 'Ford Detroit manager' }]} defaultRequestingStore="Ford Detroit" defaultRequesterId="sales" defaultManagerApproverId="manager" onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Synthetic appointment note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByLabelText('What do you need?')).toHaveValue('Synthetic appointment note');
    const refresh = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(refresh);
    expect(refresh.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('protects a submitted move request until the server confirms the save', async () => {
    let finish!: (value: { requestId: string }) => void;
    const onSubmit = vi.fn(() => new Promise<{ requestId: string }>(resolve => { finish = resolve; }));
    render(<TransferRequestWorkspace workflowMode="simple" vehicle={detail([]).vehicle} stores={[{ value: 'Ford Detroit', label: 'Ford Detroit' }]} requesters={[{ value: 'sales', label: 'Demo Sales' }]} managerApprovers={[{ value: 'manager', label: 'Ford Detroit manager' }]} defaultRequestingStore="Ford Detroit" defaultRequesterId="sales" defaultManagerApproverId="manager" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Needed by'), { target: { value: '2026-09-15T10:00' } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Synthetic customer visit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask my manager' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('What do you need?')).toBeDisabled();
    expect(screen.getByLabelText('Needed by')).toBeDisabled();
    fireEvent.submit(screen.getByLabelText('What do you need?').closest('form')!);
    expect(onSubmit).toHaveBeenCalledOnce();
    const pending = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pending);
    expect(pending.defaultPrevented).toBe(true);
    await act(async () => finish({ requestId: 'confirmed-move' }));
    expect(screen.getByRole('heading', { name: 'Request sent to your manager' })).toBeInTheDocument();
    const saved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });

  it('filters sold-pending separately from delivery and sorts by an operational route', () => {
    const data = bootstrap(4);
    data.transfers[1].dealStatus = 'sold pending';
    data.transfers[1].deliveryStatus = 'not confirmed';
    data.transfers[1].requestStatus = 'sale_confirmed';
    data.transfers[1].currentLocation = 'Ford Detroit';
    data.transfers[1].dueAt = '2099-01-01T15:00:00.000Z';
    data.transfers[2].dealStatus = 'sold pending';
    data.transfers[2].deliveryStatus = 'delivery_confirmed';
    const { container } = renderPage(data);

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter vehicle moves' }), {
      target: { value: 'sold-pending' },
    });
    expect(container.querySelectorAll('.transfer-list-item')).toHaveLength(1);
    expect(container.querySelector('.transfer-list-item')).toHaveTextContent('MOVE2');
    // A sold vehicle away from home is waiting on its delivery, not on a return.
    expect(container.querySelector('.transfer-list-item')).toHaveTextContent('Sold pending · awaiting delivery');
    expect(container.querySelector('.transfer-list-item')).toHaveTextContent('Sold pending · return paused');
    expect(container.querySelector('.transfer-list-item')).not.toHaveTextContent('Return required');

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter vehicle moves' }), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort vehicle moves' }), {
      target: { value: 'route' },
    });
    expect(container.querySelector('.transfer-list-item')).toHaveTextContent('MOVE2');
  });

  it('keeps the automatic return rule while carrying an optional preferred return time', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ requestId: 'new-move' });
    render(
      <TransferRequestWorkspace
        vehicle={detail([]).vehicle}
        stores={[{ value: 'Ford Detroit', label: 'Ford Detroit' }]}
        requesters={[{ value: 'joe', label: 'Joe Gallant' }]}
        managerApprovers={[{ value: 'manager', label: 'Ford Detroit manager' }]}
        defaultRequestingStore="Ford Detroit"
        defaultRequesterId="joe"
        defaultManagerApproverId="manager"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '2025 Ford F-150 Lariat' })).toBeInTheDocument();
    const approvalPath = screen.getByRole('complementary', { name: 'Request accountability preview' });
    expect(approvalPath).toHaveTextContent('Salesperson submits the request');
    expect(approvalPath).toHaveTextContent('Requesting-store manager approves');
    expect(approvalPath).toHaveTextContent('Manager contacts Home Store and records its decision');
    expect(approvalPath).toHaveTextContent('manager grants or declines release');
    expect(approvalPath).toHaveTextContent('Only after release: assign a driver');
    expect(approvalPath).toHaveTextContent('Record sale outcome or return');

    fireEvent.change(screen.getByLabelText('Needed by'), { target: { value: '2026-09-01T14:00' } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Customer appointment' } });
    fireEvent.click(screen.getByText('Customer reference and preferred return timing'));
    fireEvent.change(screen.getByLabelText(/Preferred return by/), { target: { value: '2026-09-02T16:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask my manager' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { level: 1, name: 'Movement request submitted' })).toBeInTheDocument();
    expect(screen.getByText(/No availability or release is confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/requesting-store manager must approve/i)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      priority: 'normal',
      returnRequired: true,
      targetReturnAt: '2026-09-02T16:00',
    }));
  });

  it('rejects a preferred return time that is not after the requested movement time', async () => {
    const onSubmit = vi.fn();
    render(
      <TransferRequestWorkspace
        vehicle={detail([]).vehicle}
        stores={[{ value: 'Ford Detroit', label: 'Ford Detroit' }]}
        requesters={[{ value: 'joe', label: 'Joe Gallant' }]}
        managerApprovers={[{ value: 'manager', label: 'Ford Detroit manager' }]}
        defaultRequestingStore="Ford Detroit"
        defaultRequesterId="joe"
        defaultManagerApproverId="manager"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText('Needed by'), { target: { value: '2026-09-02T14:00' } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Customer appointment' } });
    fireEvent.click(screen.getByText('Customer reference and preferred return timing'));
    const preferredReturn = screen.getByLabelText(/Preferred return by/);
    expect(preferredReturn).toHaveAttribute('min', '2026-09-02T14:00');
    fireEvent.change(preferredReturn, { target: { value: '2026-09-01T16:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask my manager' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(preferredReturn).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findAllByText('Preferred return must be after the vehicle is needed.')).toHaveLength(2);
  });

  it('announces request errors, links them to fields, and focuses the first fixable field', async () => {
    render(
      <TransferRequestWorkspace
        vehicle={detail([]).vehicle}
        stores={[{ value: 'Ford Detroit', label: 'Ford Detroit' }]}
        requesters={[{ value: 'joe', label: 'Joe Gallant' }]}
        managerApprovers={[{ value: 'manager', label: 'Ford Detroit manager' }]}
        defaultRequestingStore="Ford Detroit"
        defaultRequesterId="joe"
        defaultManagerApproverId="manager"
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ask my manager' }));

    const alert = await screen.findByRole('alert');
    const neededBy = screen.getByLabelText(/^Needed by/);
    expect(alert).toHaveTextContent('Complete the highlighted request details');
    expect(neededBy).toHaveAttribute('aria-invalid', 'true');
    expect(neededBy).toHaveAttribute('aria-describedby');
    await waitFor(() => expect(neededBy).toHaveFocus());
  });

  it.each([
    ['Howell', 'Overdue · waiting on Ford Detroit manager', 'is-none'],
    ['Ford Detroit', 'Overdue', 'is-overdue'],
    [undefined, 'Overdue', 'is-overdue'],
  ])('keeps overdue ownership consistent in move details for %s', (viewerStore, label, tone) => {
    const current = detail([])
    render(<TransferTracker transfer={{ ...current, nextAction: {
      ...current.nextAction, ownerStore: 'Ford Detroit', ownerLabel: 'Ford Detroit manager', sla: 'overdue',
    } }} viewerStore={viewerStore} mode="page" />)
    const nextStep = screen.getByRole('region', { name: 'Next step' })
    expect(within(nextStep).getByText(label)).toBeInTheDocument()
    expect(nextStep).toHaveClass(tone)
  })

  it('keeps issue and return actions authorized, visible, and wired to their exact action kinds', () => {
    const onAction = vi.fn();
    render(
      <TransferTracker
        transfer={detail(['approve', 'confirm-return', 'schedule-return', 'report-condition', 'mark-exception', 'open-source'])}
        mode="page"
        onAction={onAction}
      />,
    );

    expect(screen.getByRole('region', { name: 'Request and vehicle summary' })).toBeInTheDocument();
    const accountability = screen.getByRole('region', { name: 'Location and accountability' });
    expect(accountability).toHaveTextContent('Requesting-store approval owner');
    expect(accountability).toHaveTextContent('Ford Detroit manager');
    expect(accountability).toHaveTextContent('Home-store release authority');
    expect(accountability).toHaveTextContent('Howell used-car manager');
    expect(accountability).toHaveTextContent('Availability is not inferred');
    const outcome = screen.getByRole('region', { name: 'Deal, delivery, movement, and return status' });
    expect(outcome).toHaveTextContent('Shown not sold');
    expect(outcome).toHaveTextContent('Delivery not confirmed');
    expect(outcome).toHaveTextContent('Return in transit');
    const actions = screen.getByRole('contentinfo', { name: 'Available move actions' });
    expect(within(actions).getByRole('button', { name: 'Confirm back home' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Report a vehicle issue' })).toBeInTheDocument();
    expect(within(actions).getByText('More actions')).toBeInTheDocument();

    fireEvent.click(within(actions).getByText('More actions'));
    expect(within(actions).getByRole('button', { name: 'Schedule return' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Open original record' })).toHaveAttribute('title', 'Open the original dealership record in a new tab');

    fireEvent.click(within(actions).getByRole('button', { name: 'Report a vehicle issue' }));
    fireEvent.click(within(actions).getByRole('button', { name: 'Confirm back home' }));

    expect(onAction).toHaveBeenNthCalledWith(1, 'report-condition', expect.objectContaining({ id: 'transfer-return' }));
    expect(onAction).toHaveBeenNthCalledWith(2, 'confirm-return', expect.objectContaining({ id: 'transfer-return' }));
    const timeline = screen.getByRole('list', { name: 'Custody timeline' });
    expect(timeline).toHaveTextContent('Return trip started');
    expect(timeline).toHaveTextContent('Custodian: Joe Gallant');
    expect(timeline).toHaveTextContent('Driver: Stacey Driver');
  });

  it('does not invent actions when the server-authorized action list is empty', () => {
    render(<TransferTracker transfer={detail([])} mode="page" onAction={vi.fn()} />);

    expect(screen.queryByRole('contentinfo', { name: 'Available move actions' })).not.toBeInTheDocument();
    expect(screen.getByText('Confirm the vehicle is back at Howell')).toBeInTheDocument();
    expect(screen.getByText('Return in transit')).toBeInTheDocument();
  });

  it('uses source-system evidence without exposing technical jargon in the move workflow', () => {
    const { container } = render(<TransferTracker transfer={detail([])} mode="page" onAction={vi.fn()} />);

    expect(screen.queryByText(/website listing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/inventory-feed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^CDK$/i)).not.toBeInTheDocument();
    expect(container.querySelector('.mif-technical-status-details')).not.toBeInTheDocument();
    expect(screen.getByText('Hold')).toBeInTheDocument();
  });

  it('colors an overdue step red only for the store that owns it and names who another store waits on', () => {
    const data = bootstrap(2);
    data.transfers[0] = { ...data.transfers[0], nextActionStore: 'Ford Detroit', nextActionOwner: 'Ford Detroit manager' };
    data.transfers[1] = { ...data.transfers[1], nextActionStore: 'Fowlerville', nextActionOwner: 'Fowlerville sales' };
    renderPage(data);
    const own = screen.getByRole('button', { name: /MOVE1/ });
    const other = screen.getByRole('button', { name: /MOVE2/ });
    expect(within(own).getByText(/^Overdue 09\/01\/2026/)).toHaveClass('is-overdue');
    const waiting = within(other).getByText('Overdue · waiting on Fowlerville salesperson');
    expect(waiting).not.toHaveClass('is-overdue');
    expect(within(other).queryByText(/^Overdue 09\/01\/2026/)).not.toBeInTheDocument();
  });

  it('counts one move in the singular', () => {
    renderPage(bootstrap(2));
    expect(screen.getByText('2 moves shown')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search vehicle moves' }), { target: { value: 'MOVE2' } });
    expect(screen.getByText('1 move shown')).toBeInTheDocument();
  });

  it('offers the Group operations manager views only to managers on Moves > All stores', () => {
    // Judged at the current time, as the server's rule is: the clock is 08/30/2026
    // 1:00 PM UTC, so an active return due at noon is overdue, an approved move due
    // 09/02 is not, and a sold-pending deal's return clock is paused as the server pauses it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-30T13:00:00.000Z'));
    const data = bootstrap(3);
    data.transfers[0] = { ...data.transfers[0], returnDueAt: '2026-08-30T12:00:00.000Z' };
    data.transfers[2] = { ...data.transfers[2], requestStatus: 'sale_confirmed', dealStatus: 'sold_pending', returnDueAt: '2026-08-30T12:00:00.000Z' };
    data.transfers[1] = { ...data.transfers[1], locationConfidence: 'conflicting' };
    renderPage(data);
    const filter = screen.getByRole('combobox', { name: 'Filter vehicle moves' });
    expect(within(filter).queryByRole('option', { name: 'Overdue returns' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }));
    expect(within(filter).getByRole('option', { name: 'Location exceptions' })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: 'overdue-returns' } });
    expect(screen.getByRole('button', { name: /MOVE1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MOVE2/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MOVE3/ })).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: 'location-exceptions' } });
    expect(screen.getByText('1 move shown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MOVE2/ })).toBeInTheDocument();
    // Back in My store the manager view never silently narrows the queue.
    fireEvent.click(screen.getByRole('button', { name: /My store/ }));
    expect(filter).toHaveValue('all');
    expect(screen.getByText('3 moves shown')).toBeInTheDocument();
    cleanup();

    renderPage(data, '/transfers', { role: 'sales' });
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }));
    expect(within(screen.getByRole('combobox', { name: 'Filter vehicle moves' })).queryByRole('option', { name: 'Overdue returns' })).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('opens an Overview return-overdue count as exactly that store\'s overdue returns, once, for managers and sales', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-30T13:00:00.000Z'));
    const data = bootstrap(3);
    data.transfers[0] = { ...data.transfers[0], returnDueAt: '2026-08-30T12:00:00.000Z' };
    data.transfers[1] = { ...data.transfers[1], returnDueAt: '2026-08-30T12:00:00.000Z' };
    for (const role of ['manager', 'sales']) {
      renderPage(data, '/transfers?view=return-overdue&store=Howell', { role }, true);
      expect(screen.getByTestId('router-location')).toHaveTextContent(/^\/transfers$/);
      expect(screen.getByRole('button', { name: /^Active/ })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('combobox', { name: 'Filter vehicle moves' })).toHaveValue('overdue-returns');
      expect(screen.getByRole('button', { name: /MOVE1/ })).toBeInTheDocument();
      // MOVE2 is overdue but belongs to Fowlerville; MOVE3 is not overdue.
      expect(screen.queryByRole('button', { name: /MOVE2/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /MOVE3/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear home store filter: Howell' }));
      expect(screen.getByRole('button', { name: /MOVE2/ })).toBeInTheDocument();
      cleanup();
    }
    vi.useRealTimers();
  });

  it.each([
    ['store', 'Vehicle details'], ['store', 'Records'],
    ['route', 'Vehicle details'], ['route', 'Records'],
  ])('restores the selected move and %s queue filter after a %s round trip', async (filter, action) => {
    const data = bootstrap(3);
    data.transfers[0] = { ...data.transfers[0], homeStore: 'Howell', currentLocation: 'Ford Detroit', requestStatus: 'arrived', movementStatus: 'at_requesting_store' };
    data.transfers[1] = { ...data.transfers[1], homeStore: 'Howell', currentLocation: 'Howell' };
    data.transfers[2] = { ...data.transfers[2], homeStore: 'Fowlerville' };
    data.vehicles = [inventoryVehicle('Howell', data.transfers[0].vin, 'MOVE1')];
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Lincoln', role: 'manager', currentUser: 'Joe Manager', submitTransfer: vi.fn() });
    mocks.getTransfer.mockImplementation((id: string) => Promise.resolve(data.transfers.find(record => record.id === id)));
    const initial = filter === 'store' ? '/transfers?store=Howell' : '/transfers?from=Howell&to=Ford+Detroit&leg=outbound';
    render(<MemoryRouter initialEntries={[initial]}><Routes>
      <Route path="/transfers" element={<TransfersPage />} />
      <Route path="/inventory" element={<VehicleReturnLink />} />
    </Routes><LocationProbe /></MemoryRouter>);
    const filterName = filter === 'store' ? 'Clear home store filter: Howell' : 'Clear route filter: Howell to Ford Detroit, outbound';
    await screen.findByRole('button', { name: filterName });
    fireEvent.click(screen.getByRole('button', { name: /MOVE1/ }));
    const reference = screen.getByRole('navigation', { name: 'Vehicle reference' });
    const link = within(reference).getByRole('link', { name: action });
    const target = new URL(link.getAttribute('href')!, 'https://inventory.invalid');
    const returnUrl = new URL(target.searchParams.get('returnTo')!, 'https://inventory.invalid');
    expect(returnUrl.searchParams.get('id')).toBe('transfer-1');
    expect(returnUrl.searchParams.get(filter === 'store' ? 'store' : 'from')).toBe('Howell');
    fireEvent.click(link);
    fireEvent.click(screen.getByRole('link', { name: 'Back to move workspace' }));
    await screen.findByRole('button', { name: filterName });
    expect(screen.getByRole('button', { name: /MOVE1/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: /MOVE3/ })).not.toBeInTheDocument();
    if (filter === 'route') expect(screen.queryByRole('button', { name: /MOVE2/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('link', { name: 'Back to vehicle moves' })[0]);
    await screen.findByRole('button', { name: filterName });
    expect(screen.getByTestId('router-location')).not.toHaveTextContent('id=transfer-1');
    expect(screen.queryByRole('button', { name: /MOVE3/ })).not.toBeInTheDocument();
  });

  it.each([
    ['store', 'history', 'Completed', 'all'],
    ['store', 'needs-action', 'Your next steps', 'return-due'],
    ['route', 'history', 'Completed', 'all'],
    ['route', 'needs-action', 'Your next steps', 'return-due'],
  ])('preserves the chosen %s queue %s view and filter through Records', async (hint, view, label, filter) => {
    const data = bootstrap(2);
    data.transfers[0] = { ...data.transfers[0], currentLocation: 'Ford Detroit', requestStatus: view === 'history' ? 'closed' : 'arrived', movementStatus: 'at_requesting_store' };
    data.vehicles = [inventoryVehicle('Howell', data.transfers[0].vin, 'MOVE1')];
    mocks.useAppData.mockReturnValue({ data, homeStore: 'Lincoln', role: 'manager', currentUser: 'Joe Manager', submitTransfer: vi.fn() });
    mocks.getTransfer.mockImplementation((id: string) => Promise.resolve(data.transfers.find(record => record.id === id)));
    const initial = hint === 'store' ? '/transfers?store=Howell&id=transfer-1' : '/transfers?from=Howell&to=Ford+Detroit&leg=outbound&id=transfer-1';
    render(<MemoryRouter initialEntries={[initial]}><Routes>
      <Route path="/transfers" element={<TransfersPage />} />
      <Route path="/inventory" element={<VehicleReturnLink />} />
    </Routes></MemoryRouter>);
    const filterName = hint === 'store' ? 'Clear home store filter: Howell' : 'Clear route filter: Howell to Ford Detroit, outbound';
    await screen.findByRole('button', { name: filterName });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter vehicle moves' }), { target: { value: filter } });
    const records = within(screen.getByRole('navigation', { name: 'Vehicle reference' })).getByRole('link', { name: 'Records' });
    const target = new URL(records.getAttribute('href')!, 'https://inventory.invalid');
    const returnUrl = new URL(target.searchParams.get('returnTo')!, 'https://inventory.invalid');
    expect(returnUrl.searchParams.get('queueView')).toBe(view);
    expect(returnUrl.searchParams.get('queueFilter')).toBe(filter);
    fireEvent.click(records);
    fireEvent.click(screen.getByRole('link', { name: 'Back to move workspace' }));
    await screen.findByRole('button', { name: filterName });
    expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Filter vehicle moves' })).toHaveValue(filter);
    expect(screen.getByRole('navigation', { name: 'Vehicle reference' })).toBeInTheDocument();
  });

  it('opens a store-board arrow as exactly that leg\'s moves across all stores, once', () => {
    const data = bootstrap(3);
    data.transfers[0] = { ...data.transfers[0], homeStore: 'Howell', destination: 'Ford Detroit', currentLocation: 'Ford Detroit', requestStatus: 'arrived', movementStatus: 'at_requesting_store' };
    data.transfers[1] = { ...data.transfers[1], homeStore: 'Howell', destination: 'Ford Detroit', currentLocation: 'Howell', requestStatus: 'approved', movementStatus: 'release approved' };
    data.transfers[2] = { ...data.transfers[2], homeStore: 'Fowlerville', destination: 'Ford Detroit', currentLocation: 'In transit', requestStatus: 'return_in_transit', movementStatus: 'return_in_transit' };
    renderPage(data, '/transfers?from=Howell&to=Ford+Detroit&leg=outbound', { homeStore: 'Lincoln' }, true);
    expect(screen.getByTestId('router-location')).toHaveTextContent(/^\/transfers$/);
    expect(screen.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /MOVE1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MOVE2/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MOVE3/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear route filter: Howell to Ford Detroit, outbound' }));
    expect(screen.getByRole('button', { name: /MOVE2/ })).toBeInTheDocument();
    cleanup();

    renderPage(data, '/transfers?from=Ford+Detroit&to=Fowlerville&leg=return', { homeStore: 'Lincoln' });
    expect(screen.getByRole('button', { name: /MOVE3/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MOVE1/ })).not.toBeInTheDocument();
    cleanup();

    renderPage(data, '/transfers?from=Howell&to=Ford+Detroit&leg=planned', { homeStore: 'Lincoln' });
    expect(screen.getByRole('button', { name: /MOVE2/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MOVE1/ })).not.toBeInTheDocument();
  });

  it('shows the exact inter-store approval chain before driver assignment', () => {
    const waiting = detail(['review-request']);
    waiting.status.request = { code: 'submitted', label: 'Waiting on my manager', tone: 'info' };
    waiting.status.movement = { code: 'at-home-verified', label: 'At home', tone: 'neutral' };
    waiting.status.deal = { code: 'no-outcome', label: 'Not confirmed', tone: 'neutral' };
    waiting.nextAction = {
      label: 'Requesting manager confirms availability and release with Howell used-car manager',
      ownerLabel: 'Ford Detroit manager',
      ownerRole: 'Requesting-store manager',
      sla: 'on-track',
    };

    render(<TransferTracker transfer={waiting} mode="page" onAction={vi.fn()} />);

    const progress = screen.getByRole('list', { name: 'Inter-store request approval and movement progress' });
    expect(progress).toHaveTextContent('Request');
    expect(progress).toHaveTextContent('Requesting manager');
    expect(progress).toHaveTextContent('Home-store contact & release');
    expect(progress).toHaveTextContent('Driver & move');
    expect(progress).toHaveTextContent('Outcome / return');
    expect(within(progress).getByText('Requesting manager').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Approve, then call the home store')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeInTheDocument();
  });
});
