import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupOperations } from './GroupOperations';
import type { GroupOperationRecord } from './types';

const record: GroupOperationRecord = {
  id: 'manager-move-1',
  vehicle: {
    vin: '1FTFW1E80RFA00001',
    stock: 'MGR100',
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
  destination: 'Ford Detroit',
  priority: 'high',
  requestedByLabel: 'Joe Gallant',
  approvalOwnerLabel: 'Howell used-car manager',
  requestedAt: '2026-08-29T14:00:00.000Z',
  neededBy: '2026-09-01T15:00:00.000Z',
  custodianLabel: 'Joe Gallant',
  salespersonLabel: 'Salesperson One',
  nextAction: {
    label: 'Confirm home-store release',
    ownerLabel: 'Howell manager',
    ownerRole: 'Manager',
    ownerId: 'manager-one',
    dueAt: '2026-09-01T15:00:00.000Z',
    sla: 'due-soon',
  },
  status: {
    request: { code: 'submitted', label: 'Approval requested', tone: 'warning' },
    movement: { code: 'at-home-verified', label: 'At home verified', tone: 'info' },
    deal: { code: 'no-outcome', label: 'No outcome recorded', tone: 'neutral' },
    delivery: { code: 'not-confirmed', label: 'Delivery not confirmed', tone: 'neutral' },
    dealerMail: { code: 'primary', label: 'Primary hold', tone: 'warning' },
    publicListing: { code: 'listed', label: 'Listed', tone: 'info' },
    cdk: { code: 'processing', label: 'Processing', tone: 'neutral' },
  },
  timeline: [],
  allowedActions: ['review-request'],
};

afterEach(() => cleanup());

describe('GroupOperations manager table', () => {
  it('distinguishes the current location, requesting store, and return destination', () => {
    const { container } = render(<GroupOperations records={[{ ...record, destination: 'Howell' }]} storeOptions={[]} />);
    const mobile = within(container.querySelector('.mif-operations-mobile-list') as HTMLElement);
    expect(mobile.getByText('Current').parentElement).toHaveTextContent('Ford Detroit');
    expect(mobile.getByText('Requested').parentElement).toHaveTextContent('Ford Detroit');
    expect(mobile.getByText('Destination: Howell')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Location / destination' })).toBeInTheDocument();
  });

  it('keeps exceptions with the current step and exposes copy controls for vehicle identifiers', () => {
    const { container } = render(
      <GroupOperations
        records={[{ ...record, exception: { kind: 'location', label: 'Location needs review', severity: 'warning' } }]}
        storeOptions={[]}
      />,
    );
    const row = container.querySelector('.mif-operations-table tbody tr') as HTMLTableRowElement;

    expect(screen.queryByRole('columnheader', { name: 'Issue' })).not.toBeInTheDocument();
    expect(within(row).getByText('Location needs review')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy stock number: MGR100' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy VIN: 1FTFW1E80RFA00001' })).toBeInTheDocument();
  });

  it('retains manager filters and sort rules only within the same access context', () => {
    const props = { records: [record], storeOptions: [{ value: 'Howell', label: 'Howell' }], persistenceContext: 'Manager One:manager:Howell' };
    const first = render(<GroupOperations {...props} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search movements' }), { target: { value: 'MGR100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort 1 field' }), { target: { value: 'vehicle' } });
    first.unmount();
    const second = render(<GroupOperations {...props} />);
    expect(screen.getByRole('searchbox', { name: 'Search movements' })).toHaveValue('MGR100');
    fireEvent.click(screen.getByRole('button', { name: /Sort/ }));
    expect(screen.getByRole('combobox', { name: 'Sort 1 field' })).toHaveValue('vehicle');
    second.rerender(<GroupOperations {...props} persistenceContext="Manager Two:manager:Howell" />);
    expect(screen.getByRole('searchbox', { name: 'Search movements' })).toHaveValue('');
  });

  it('matches Needs me against the signed-in manager when the source supplies an owner label', () => {
    const own = { ...record, nextAction: { ...record.nextAction, ownerId: undefined, ownerLabel: 'Synthetic Manager' } };
    render(<GroupOperations records={[own]} storeOptions={[]} currentUserId="Synthetic Manager" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Manager quick views' }), { target: { value: 'needs-me' } });
    expect(screen.getByRole('button', { name: 'Review MGR100' })).toBeInTheDocument();
  });

  it('matches reordered search tokens and selects an authorized suggestion without opening a movement', () => {
    const onSelectTransfer = vi.fn();
    render(<GroupOperations records={[record]} storeOptions={[]} onSelectTransfer={onSelectTransfer} />);
    const input = screen.getByRole('searchbox', { name: 'Search movements' });
    fireEvent.change(input, { target: { value: 'Lariat Ford' } });
    expect(screen.getByRole('button', { name: 'Review MGR100' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('MGR100');
    expect(onSelectTransfer).not.toHaveBeenCalled();
  });

  it('starts compact, groups operational details, and makes every work-queue card explicit', () => {
    const onSelectTransfer = vi.fn();
    render(
      <GroupOperations
        currentUserId="manager-one"
        homeStore="Howell"
        now="2026-08-31T13:00:00.000Z"
        onSelectTransfer={onSelectTransfer}
        records={[record]}
        storeOptions={[
          { value: 'Howell', label: 'Howell' },
          { value: 'Ford Detroit', label: 'Ford Detroit' },
        ]}
      />,
    );

    expect(screen.queryByRole('combobox', { name: 'Home Store' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Vehicle / priority' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Current step' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Who acts next' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'When' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Custodian' })).not.toBeInTheDocument();

    const disclosure = screen.getByText('Work queues').closest('details')!;
    expect(disclosure).not.toHaveAttribute('open');
    fireEvent.click(disclosure.querySelector('summary')!);
    expect(disclosure).toHaveAttribute('open');
    const queueButtons = within(screen.getByLabelText('Manager work queues')).getAllByRole('button');
    expect(queueButtons).toHaveLength(6);
    expect(queueButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/Show needs approval queue/i),
      expect.stringMatching(/Show pickup due queue/i),
      expect.stringMatching(/Show in transit queue/i),
      expect.stringMatching(/Show outcome due queue/i),
      expect.stringMatching(/Show return due queue/i),
      expect.stringMatching(/Show location exception queue/i),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('combobox', { name: 'Home Store' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review MGR100' }));
    expect(onSelectTransfer).toHaveBeenCalledWith(record);
  });

  it('names the request lane filter as move status and reads stored codes as words', () => {
    const fellThrough = {
      ...record,
      id: 'transfer-2',
      vehicle: { ...record.vehicle, stock: 'MGR200', vin: 'TESTDATAMGR00002' },
      status: { ...record.status, request: { code: 'submitted', label: 'not_sold', tone: 'neutral' } },
    } as GroupOperationRecord;
    render(
      <GroupOperations
        currentUserId="manager-one"
        homeStore="Howell"
        now="2026-08-31T13:00:00.000Z"
        onSelectTransfer={vi.fn()}
        records={[record, fellThrough]}
        storeOptions={[{ value: 'Howell', label: 'Howell' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const moveStatus = screen.getByRole('combobox', { name: 'Move status' });
    expect(screen.queryByRole('combobox', { name: 'Request status' })).not.toBeInTheDocument();
    expect(within(moveStatus).getAllByRole('option').map((option) => option.textContent)).toEqual(['All', 'Approval requested', 'Not sold']);
  });

  it('filters from a summary card, exposes its selected state, and can clear the queue', () => {
    const pickupRecord: GroupOperationRecord = {
      ...record,
      id: 'manager-move-2',
      vehicle: { ...record.vehicle, stock: 'MGR200', vin: '1FTFW1E80RFA00002' },
      status: {
        ...record.status,
        request: { code: 'approved', label: 'Release approved', tone: 'success' },
        movement: { code: 'release-approved', label: 'Release approved', tone: 'success' },
      },
    };

    render(
      <GroupOperations
        currentUserId="manager-one"
        homeStore="Howell"
        now="2026-08-31T13:00:00.000Z"
        records={[record, pickupRecord]}
        storeOptions={[
          { value: 'Howell', label: 'Howell' },
          { value: 'Ford Detroit', label: 'Ford Detroit' },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('Work queues').closest('summary')!);
    const approvalQueue = screen.getByRole('button', { name: /Show needs approval queue/i });
    fireEvent.click(approvalQueue);

    expect(approvalQueue).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Review MGR100' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review MGR200' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear summary queue' })).toHaveTextContent('Needs approval');

    fireEvent.click(screen.getByRole('button', { name: 'Clear summary queue' }));

    expect(approvalQueue).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Review MGR200' })).toBeInTheDocument();
  });
});
