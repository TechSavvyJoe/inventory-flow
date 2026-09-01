import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapData, TransferRecord } from '../../types';
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
    nextAction: index === 1 ? 'Confirm home receipt' : 'Assign a driver',
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

function renderPage(data: BootstrapData, initialEntry = '/transfers') {
  mocks.useAppData.mockReturnValue({
    data,
    homeStore: 'Howell',
    role: 'manager',
    submitTransfer: vi.fn(),
  });
  mocks.getTransfer.mockImplementation((id: string) =>
    Promise.resolve(data.transfers.find((item) => item.id === id)),
  );
  return render(<MemoryRouter initialEntries={[initialEntry]}><TransfersPage /></MemoryRouter>);
}

afterEach(() => cleanup());

describe('transfer workspace v3 layout', () => {
  beforeEach(() => {
    mocks.getTransfer.mockReset();
    mocks.useAppData.mockReset();
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

  it('uses the independently scrolling master-detail layout for longer queues', () => {
    const { container } = renderPage(bootstrap(4));

    const layout = container.querySelector('.transfers-layout');
    expect(layout).toHaveClass('transfers-layout--master-detail');
    expect(layout).toHaveAttribute('data-queue-size', '4');
    expect(container.querySelector('.transfer-list')).not.toHaveClass('transfer-list--short');
    expect(container.querySelectorAll('.transfer-list-item')).toHaveLength(4);
  });

  it('renders the queue-first mobile contract without placing the selected detail in the queue state', () => {
    const { container } = renderPage(bootstrap(4));

    const page = container.querySelector('.transfer-workspace-v3');
    expect(page).toHaveAttribute('data-mobile-detail-open', 'false');
    expect(container.querySelectorAll('.transfer-list-copy--concise')).toHaveLength(4);
    expect(screen.getByRole('combobox', { name: 'Filter vehicle moves' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort vehicle moves' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request a vehicle' })).toHaveTextContent('Request vehicle');
    expect(screen.getByRole('button', { name: /2025 Ford F-150 1/i })).toHaveTextContent('MOVE1');
    expect(screen.getByRole('button', { name: /2025 Ford F-150 1/i })).toHaveTextContent('Manager 1');
  });

  it('gives the request route one accessible primary heading when no vehicle is selected', () => {
    renderPage(bootstrap(0), '/transfers/new');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Select a vehicle to request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose vehicle in Inventory' })).toBeInTheDocument();
  });

  it('opens a dedicated mobile detail state and returns to the queue', () => {
    const { container } = renderPage(bootstrap(4), '/transfers?id=transfer-2');

    const page = container.querySelector('.transfer-workspace-v3');
    expect(page).toHaveAttribute('data-mobile-detail-open', 'true');
    const detailBar = container.querySelector('.transfer-mobile-detail-bar');
    expect(detailBar).toHaveTextContent('Vehicle move');
    expect(detailBar).toHaveTextContent('MOVE2');
    expect(detailBar).toHaveTextContent('Step 4 of 5');
    expect(detailBar).toHaveTextContent('Released · driver can be assigned');
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

  it('filters sold-pending separately from delivery and sorts by an operational route', () => {
    const data = bootstrap(4);
    data.transfers[1].dealStatus = 'sold pending';
    data.transfers[1].deliveryStatus = 'not confirmed';
    data.transfers[2].dealStatus = 'sold pending';
    data.transfers[2].deliveryStatus = 'delivery_confirmed';
    const { container } = renderPage(data);

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter vehicle moves' }), {
      target: { value: 'sold-pending' },
    });
    expect(container.querySelectorAll('.transfer-list-item')).toHaveLength(1);
    expect(container.querySelector('.transfer-list-item')).toHaveTextContent('MOVE2');

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
    expect(screen.getByText(/before a driver can be assigned/i)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      returnRequired: true,
      targetReturnAt: '2026-09-02T16:00',
    }));
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
    expect(within(actions).getByRole('button', { name: 'Confirm home receipt' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Report vehicle issue' })).toBeInTheDocument();
    expect(within(actions).getByText('More actions')).toBeInTheDocument();

    fireEvent.click(within(actions).getByText('More actions'));
    expect(within(actions).getByRole('button', { name: 'Schedule return' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Open original record' })).toHaveAttribute('title', 'Open the original dealership record in a new tab');

    fireEvent.click(within(actions).getByRole('button', { name: 'Report vehicle issue' }));
    fireEvent.click(within(actions).getByRole('button', { name: 'Confirm home receipt' }));

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
    expect(screen.getByText('Confirm home receipt')).toBeInTheDocument();
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
    expect(screen.getByText('Requesting manager: approve, then contact Home Store')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeInTheDocument();
  });
});
