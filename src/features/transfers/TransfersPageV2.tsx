import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  CarFront,
  ChevronDown,
  CircleAlert,
  Clock,
  ListFilter,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  Truck,
  User,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppData } from '../../app/AppDataContext';
import { toTransferDetail, toTransferVehicle } from '../../app/transferAdapters';
import { CopyableValue } from '../../components/CopyableValue';
import { SourceWarning } from '../../components/SourceWarning';
import { getTransfer } from '../../lib/api';
import type { BootstrapData, StoreName, TransferRecord, UserRole } from '../../types';
import { formatDateTime, humanizeStatusLabel } from './presentation';
import { TransferActionDialog } from './TransferActionDialog';
import { TransferEmptyState } from './TransferEmptyState';
import { TransferRequestWorkspace } from './TransferRequestWorkspace';
import { TransferTracker } from './TransferTracker';
import { simpleTransferActions, simpleTransferActionLabel } from './SimpleTransferTracker';
import type { SelectOption, TransferActionKind, TransferDetail, TransferRequestDraft } from './types';
import { awayFromHomeSummary } from './moveSummary';
import { selectRequestedTransfer } from './transfer-selection';
import { VehicleLocationOverview } from './VehicleLocationOverview';
import './TransfersPageV2.css';

const REASON_LABELS: Record<TransferRequestDraft['reasonCode'], string> = {
  'customer-need': 'Customer need',
  'manager-request': 'Manager / store need',
  other: 'Other reason',
};

type TransferQueueView = 'active' | 'needs-action' | 'history';

type TransferQueueFilter =
  | 'all'
  | 'my-location'
  | 'my-home-inventory'
  | 'requested-by-my-store'
  | 'away-from-home'
  | 'awaiting-approval'
  | 'ready-to-collect'
  | 'at-requesting-store'
  | 'driver-needed'
  | 'moving'
  | 'return-due'
  | 'sold-pending'
  | 'issues';

type TransferQueueSort = 'urgency' | 'needed-by' | 'recent' | 'stock' | 'route';

const TERMINAL_TRANSFER_STATES = new Set(['closed', 'declined', 'canceled', 'expired']);
const PASSIVE_TRANSFER_ACTIONS = new Set<TransferActionKind>([
  'open-source',
  'report-condition',
  'mark-exception',
  'escalate',
]);

const SIMPLE_ACTION_ORDER: TransferActionKind[] = [
  'approve',
  'confirm-pickup',
  'confirm-arrival',
  'confirm-return',
  'record-outcome',
  'schedule-return',
  'decline',
  'close',
];

function normalizedStatus(value?: string): string {
  return (value ?? '').toLowerCase().trim().replace(/[_\s/]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function isTerminalTransfer(record: TransferRecord): boolean {
  return (
    TERMINAL_TRANSFER_STATES.has(normalizedStatus(record.requestStatus)) ||
    (record.workflowMode === 'simple' && normalizedStatus(record.requestStatus) === 'returned-home')
  );
}

function needsTransferAction(detail: TransferDetail): boolean {
  const actions = detail.workflowMode === 'simple' ? simpleTransferActions(detail) : detail.allowedActions;
  return actions.some((action) => !PASSIVE_TRANSFER_ACTIONS.has(action));
}

function transferIssueLabel(detail: TransferDetail): string | null {
  if (detail.exception) return detail.exception.label;
  if (detail.timeline.some((event) => event.exception)) return 'Vehicle issue reported';
  if (detail.nextAction.sla === 'breached' || detail.nextAction.sla === 'overdue') return 'Action overdue';
  return null;
}

function dueLabel(detail: TransferDetail): string {
  if (!detail.nextAction.dueAt) return 'No due time';
  const prefix =
    detail.nextAction.sla === 'breached' || detail.nextAction.sla === 'overdue' ? 'Overdue' : 'Due';
  return `${prefix} ${formatDateTime(detail.nextAction.dueAt)}`;
}

function workflowStep(status: string): number {
  const normalized = normalizedStatus(status);
  if (normalized === 'draft') return 1;
  if (['requested', 'submitted'].includes(normalized)) return 2;
  if (['manager-reviewed', 'needs-information', 'declined'].includes(normalized)) return 3;
  if (
    [
      'approved',
      'driver-requested',
      'transport-assigned',
      'pickup-scheduled',
      'picked-up',
      'in-transit',
    ].includes(normalized)
  )
    return 4;
  return 5;
}

function compactNextAction(value?: string): string {
  const action = value?.trim() || 'No next action recorded';
  if (/requesting manager confirms availability and release/i.test(action)) {
    return 'Requesting manager: approve, then contact Home Store';
  }
  if (/contact .*used-car manager.*release decision/i.test(action)) {
    return 'Contact Home Store and record its decision';
  }
  if (/home-store.*availability.*release/i.test(action)) {
    return 'Record the Home Store’s release decision';
  }
  if (/confirm.*returned home|confirm home receipt/i.test(action)) {
    return 'Confirm home receipt';
  }
  if (/record call for a driver|request.*driver/i.test(action)) {
    return 'Request a driver';
  }
  return action;
}

function compactRequestStatus(value: string, simple = false): string {
  const status = normalizedStatus(value);
  if (simple) {
    if (status === 'closed') return 'Complete';
    if (['requested', 'submitted', 'manager-reviewed', 'needs-information'].includes(status)) {
      return 'Checking availability';
    }
    if (status === 'approved') return 'Approved for collection';
    if (['transport-assigned', 'pickup-scheduled'].includes(status)) return 'Ready to collect';
    if (['picked-up', 'in-transit'].includes(status)) return 'In transit';
    if (['arrived', 'customer-showing', 'sale-outcome-pending'].includes(status)) {
      return 'At requesting store';
    }
    if (status === 'returned-home') return 'Back home';
    if (status.includes('return')) return 'Returning home';
    return humanizeStatusLabel(value);
  }
  if (status === 'draft') return 'Draft request';
  if (['requested', 'submitted'].includes(status)) return 'Manager approval';
  if (['manager-reviewed', 'needs-information'].includes(status)) {
    return 'Home Store decision';
  }
  if (status === 'approved') return 'Released';
  if (status === 'driver-requested') return 'Driver requested';
  if (/transport-assigned|pickup-scheduled/.test(status)) return 'Driver assigned';
  if (/picked-up|in-transit/.test(status)) return 'In transit';
  if (/arrived|customer-showing/.test(status)) return 'At requesting store';
  if (/return/.test(status)) return 'Return in progress';
  return humanizeStatusLabel(value);
}

function returnTimingLabel(record: TransferRecord): string {
  if (!record.returnRequired) return 'Return not required';
  if (record.returnDueAt) return `Return due ${formatDateTime(record.returnDueAt)}`;
  return 'Return required';
}

interface CountdownResult {
  label: string;
  isOverdue: boolean;
  isDueSoon: boolean;
}

export function calculateCountdown(
  dueAt?: string | null,
  sla?: string,
  overdueFlag?: boolean,
): CountdownResult {
  const isFlaggedOverdue = overdueFlag || sla === 'breached' || sla === 'overdue';

  if (!dueAt) {
    if (isFlaggedOverdue) {
      return { label: 'Action Overdue', isOverdue: true, isDueSoon: false };
    }
    return { label: 'No deadline', isOverdue: false, isDueSoon: false };
  }

  const target = new Date(dueAt).getTime();
  if (Number.isNaN(target)) {
    if (isFlaggedOverdue) {
      return { label: 'Action Overdue', isOverdue: true, isDueSoon: false };
    }
    return { label: 'No deadline', isOverdue: false, isDueSoon: false };
  }

  const now = Date.now();
  const diffMs = target - now;

  if (isFlaggedOverdue || diffMs <= 0) {
    const overdueMs = Math.abs(diffMs);
    const hours = Math.floor(overdueMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    const mins = Math.floor((overdueMs % (1000 * 60 * 60)) / (1000 * 60));
    const timeStr = days > 0 ? `${days}d ${remHours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    return { label: `Overdue by ${timeStr}`, isOverdue: true, isDueSoon: false };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const timeStr = days > 0 ? `${days}d ${remHours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const isDueSoon = diffMs <= 4 * 60 * 60 * 1000 || sla === 'due-soon';

  return { label: `Due in ${timeStr}`, isOverdue: false, isDueSoon };
}

function dateScore(value?: string, fallback = Number.POSITIVE_INFINITY): number {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
}

function transferPriorityScore(record: TransferRecord): number {
  return { urgent: 4, high: 3, normal: 2, low: 1 }[record.priority] ?? 0;
}

function TransferDetailLoader({
  selected,
  data,
  role,
  homeStore,
  onAction,
}: {
  selected: { record: TransferRecord; detail: TransferDetail } | null;
  data: BootstrapData;
  role: UserRole;
  homeStore: StoreName;
  onAction: (action: TransferActionKind, detail: TransferDetail) => void;
}) {
  const selectedRecord = selected?.record;
  const selectedRecordRefreshKey = selectedRecord ? JSON.stringify(selectedRecord) : '';
  const requestContext = useMemo(
    () => ({ id: selectedRecord?.id, refreshKey: selectedRecordRefreshKey, role, homeStore }),
    [selectedRecord?.id, selectedRecordRefreshKey, role, homeStore],
  );
  const [recordDetail, setRecordDetail] = useState<{
    context: typeof requestContext;
    record: TransferRecord;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const id = requestContext.id;
    if (!id) {
      setRecordDetail(null);
      return () => {
        active = false;
      };
    }
    getTransfer(id, requestContext.role, requestContext.homeStore)
      .then((record) => {
        if (active && record?.id === id) setRecordDetail({ context: requestContext, record });
      })
      .catch(() => {
        if (active) setRecordDetail(null);
      });
    return () => {
      active = false;
    };
  }, [requestContext]);

  const detail =
    recordDetail?.context === requestContext
      ? toTransferDetail(
          recordDetail.record,
          data.vehicles.find((vehicle) => vehicle.vin === recordDetail.record.vin),
          data.meta,
          role,
        )
      : selected?.detail ?? null;
  const vehicle = data.vehicles.find((v) => v.vin === selectedRecord?.vin);

  return (
    <TransferTracker
      transfer={detail}
      mode="page"
      onAction={onAction}
      vehicleLinks={
        vehicle ? (
          <nav className="move-vehicle-links" aria-label="Vehicle reference">
            <Link to={`/inventory?scope=group&vin=${encodeURIComponent(vehicle.vin)}`}>
              Vehicle details
            </Link>
            <Link to={`/inventory?scope=group&vin=${encodeURIComponent(vehicle.vin)}&tab=data`}>
              Records
            </Link>
          </nav>
        ) : null
      }
    />
  );
}

export function TransfersPageV2() {
  const { data, homeStore, role, currentUser, submitTransfer, refresh } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const [pendingAction, setPendingAction] = useState<{
    action: TransferActionKind;
    detail: TransferDetail;
    record: TransferRecord;
  } | null>(null);

  const [query, setQuery] = useState('');
  const [queueView, setQueueView] = useState<TransferQueueView>('active');
  const [queueFilter, setQueueFilter] = useState<TransferQueueFilter>('all');
  const [storeScope, setStoreScope] = useState<'home' | 'group'>('home');
  const [queueSort, setQueueSort] = useState<TransferQueueSort>('urgency');

  const requestMode = location.pathname.endsWith('/new');

  const details = useMemo(() => {
    if (!data) return [];
    const vehicles = new Map(data.vehicles.map((vehicle) => [vehicle.vin, vehicle]));
    return data.transfers.map((record) => ({
      record,
      detail: toTransferDetail(record, vehicles.get(record.vin), data.meta, role),
    }));
  }, [data, role]);

  if (!data) return null;

  const simple = !details.length || details.some(({ record }) => record.workflowMode === 'simple');

  const requestedId = params.get('id');
  const requestedVin = params.get('vin')?.toUpperCase();
  const normalizedQuery = query.trim().toLowerCase();

  const scopedDetails = details.filter(
    ({ record }) =>
      storeScope === 'group' ||
      [record.homeStore, record.requestingStore, record.currentLocation, record.destination].includes(
        homeStore,
      ),
  );

  const filteredDetails = scopedDetails
    .filter(({ record, detail }) => {
      const terminal = isTerminalTransfer(record);
      const needsAction = needsTransferAction(detail);
      if (
        queueView === 'history'
          ? !terminal
          : queueView === 'active'
            ? terminal
            : !needsAction || terminal
      ) {
        return false;
      }

      if (
        queueFilter === 'my-location' &&
        ![record.homeStore, record.requestingStore, record.currentLocation, record.destination].includes(
          homeStore,
        )
      ) {
        return false;
      }
      if (queueFilter === 'my-home-inventory' && record.homeStore !== homeStore) return false;
      if (queueFilter === 'requested-by-my-store' && record.requestingStore !== homeStore) return false;
      if (
        queueFilter === 'away-from-home' &&
        !awayFromHomeSummary(record.homeStore, record.currentLocation, record.events).isAway
      ) {
        return false;
      }
      if (
        queueFilter === 'awaiting-approval' &&
        !['requested', 'submitted', 'manager-reviewed', 'needs-information'].includes(
          normalizedStatus(record.requestStatus),
        )
      ) {
        return false;
      }
      if (
        queueFilter === 'ready-to-collect' &&
        !['approved', 'transport-assigned', 'pickup-scheduled'].includes(
          normalizedStatus(record.requestStatus),
        )
      ) {
        return false;
      }
      if (
        queueFilter === 'at-requesting-store' &&
        ![
          'arrived',
          'customer-showing',
          'sale-outcome-pending',
          'sale-confirmed',
          'not-sold',
        ].includes(normalizedStatus(record.requestStatus))
      ) {
        return false;
      }
      if (
        queueFilter === 'driver-needed' &&
        (terminal ||
          Boolean(record.transportAssignee) ||
          normalizedStatus(record.requestStatus) === 'requested')
      ) {
        return false;
      }
      if (
        queueFilter === 'moving' &&
        !['in-transit', 'picked-up', 'transport-assigned', 'return-in-transit'].includes(
          normalizedStatus(record.requestStatus),
        )
      ) {
        return false;
      }
      if (queueFilter === 'return-due' && (!record.returnRequired || terminal)) return false;
      if (
        queueFilter === 'sold-pending' &&
        (!normalizedStatus(record.dealStatus).includes('sold-pending') ||
          ['confirmed', 'delivery-confirmed'].includes(normalizedStatus(record.deliveryStatus)))
      ) {
        return false;
      }
      if (queueFilter === 'issues' && !transferIssueLabel(detail)) return false;

      if (!normalizedQuery) return true;
      return [
        record.stockNumber,
        record.vin,
        record.vehicleName,
        record.homeStore,
        record.requestingStore,
        record.currentLocation,
        record.destination,
        record.requestedBy,
        record.approvedBy,
        record.custodian,
        record.transportAssignee,
        record.nextAction,
        record.nextActionOwner,
        record.dealStatus,
        record.deliveryStatus,
        record.movementStatus,
        detail.requestReason,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    })
    .sort((left, right) => {
      if (queueSort === 'needed-by') {
        return dateScore(left.detail.nextAction.dueAt) - dateScore(right.detail.nextAction.dueAt);
      }
      if (queueSort === 'recent') {
        return dateScore(right.record.requestedAt, 0) - dateScore(left.record.requestedAt, 0);
      }
      if (queueSort === 'stock') {
        return left.record.stockNumber.localeCompare(right.record.stockNumber, undefined, {
          numeric: true,
        });
      }
      if (queueSort === 'route') {
        return `${left.record.homeStore}|${left.record.destination}`.localeCompare(
          `${right.record.homeStore}|${right.record.destination}`,
        );
      }
      const leftIssue = transferIssueLabel(left.detail) ? 1 : 0;
      const rightIssue = transferIssueLabel(right.detail) ? 1 : 0;
      if (leftIssue !== rightIssue) return rightIssue - leftIssue;
      const slaRank = { breached: 4, overdue: 3, 'due-soon': 2, 'on-track': 1, none: 0 };
      const slaDifference =
        slaRank[right.detail.nextAction.sla] - slaRank[left.detail.nextAction.sla];
      if (slaDifference) return slaDifference;
      const priorityDifference =
        transferPriorityScore(right.record) - transferPriorityScore(left.record);
      if (priorityDifference) return priorityDifference;
      return dateScore(left.detail.nextAction.dueAt) - dateScore(right.detail.nextAction.dueAt);
    });

  const selected = selectRequestedTransfer(
    requestedId || requestedVin ? details : filteredDetails,
    requestedId,
    requestedVin,
  );

  const queueCounts = {
    active: scopedDetails.filter(({ record }) => !isTerminalTransfer(record)).length,
    'needs-action': scopedDetails.filter(
      ({ record, detail }) => !isTerminalTransfer(record) && needsTransferAction(detail),
    ).length,
    history: scopedDetails.filter(({ record }) => isTerminalTransfer(record)).length,
  };

  const requestVehicle = requestedVin
    ? data.vehicles.find((vehicle) => vehicle.vin === requestedVin)
    : undefined;

  function selectTransfer(id: string | null) {
    setParams((curr) => {
      const next = new URLSearchParams(curr);
      if (id) {
        next.set('id', id);
        next.delete('vin');
      } else {
        next.delete('id');
        next.delete('vin');
      }
      return next;
    });
  }

  function handleAction(action: TransferActionKind, detail: TransferDetail) {
    const record = data?.transfers.find((item) => item.id === detail.id);
    if (!record) return;
    if (action === 'open-source') {
      const listingUrl = data?.vehicles.find((vehicle) => vehicle.vin === record.vin)?.listingUrl;
      if (listingUrl) window.open(listingUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setPendingAction({ action, detail, record });
  }

  if (requestMode) {
    if (requestVehicle?.homeStore === homeStore) {
      return (
        <section className="transfer-request-page">
          <div className="move-request-home-message">
            <CarFront aria-hidden="true" size={32} />
            <h1>This vehicle belongs to {homeStore}</h1>
            <p>
              A move request brings another store’s vehicle to your store. Choose a vehicle from
              another store to ask your manager.
            </p>
            <button
              type="button"
              className="mif-button mif-button--primary"
              onClick={() => navigate('/inventory?scope=group')}
            >
              Find a vehicle at another store
            </button>
          </div>
        </section>
      );
    }
    const vehicleSummary = requestVehicle ? toTransferVehicle(requestVehicle, data.meta) : null;
    const stores: SelectOption[] = data.stores
      .filter((store) => store.store !== requestVehicle?.homeStore)
      .map((store) => ({ value: store.store, label: store.store }));
    const defaultRequestingStore = homeStore;
    const requestingManagerStore = defaultRequestingStore ?? homeStore;
    const managerApprovers: SelectOption[] = requestVehicle
      ? [
          {
            value: `${requestingManagerStore}-manager`,
            label: `${requestingManagerStore} manager`,
            secondaryLabel: `Checks with ${requestVehicle.homeStore}, then approves the request`,
          },
        ]
      : [];

    return (
      <section className="transfer-request-page">
        <SourceWarning meta={data.meta} />
        <TransferRequestWorkspace
          workflowMode="simple"
          vehicle={vehicleSummary}
          stores={stores}
          requesters={[
            {
              value: 'signed-in-user',
              label: currentUser || 'Signed-in salesperson',
              secondaryLabel: homeStore,
            },
          ]}
          managerApprovers={managerApprovers}
          defaultRequestingStore={defaultRequestingStore}
          defaultRequesterId="signed-in-user"
          defaultManagerApproverId={managerApprovers[0]?.value}
          onCancel={() => navigate(requestVehicle ? '/transfers' : '/inventory')}
          onViewRequest={(id) => navigate(`/transfers?id=${encodeURIComponent(id)}`)}
          onSubmit={async (draft) => {
            const created = await submitTransfer({
              vin: draft.vin,
              requestingStore: draft.requestingStore as typeof homeStore,
              requestedBy: currentUser || 'Signed-in salesperson',
              neededBy: draft.neededBy,
              reason: `${REASON_LABELS[draft.reasonCode]}${draft.reasonDetail?.trim() ? `: ${draft.reasonDetail.trim()}` : ''}`,
              customerReference: draft.customerReference?.trim() || undefined,
              customerAppointment: false,
              returnRequired: draft.returnRequired,
              returnDueAt: draft.targetReturnAt || undefined,
              priority: draft.priority,
              approvalOwner: managerApprovers.find((option) => option.value === draft.managerApproverId)
                ?.label,
            });
            return { requestId: created.id };
          }}
        />
      </section>
    );
  }

  return (
    <div className="transfers-page-v2" aria-label="Transfers Movement View V2">
      <SourceWarning meta={data.meta} />

      {/* Header */}
      <header className="transfers-v2-header">
        <div className="transfers-v2-header-title">
          <h1>
            <Truck size={24} aria-hidden="true" />
            Vehicle Movement Cockpit
          </h1>
          <p>
            Route Tracking, Custody & Transfer Progression · {homeStore}
          </p>
        </div>

        <div className="transfers-v2-header-controls">
          {/* Store Scope Switch */}
          <div
            className="transfers-v2-toggle-group"
            role="group"
            aria-label="Movement store scope"
          >
            <button
              type="button"
              className={`transfers-v2-toggle-btn${storeScope === 'home' ? ' is-active' : ''}`}
              aria-pressed={storeScope === 'home'}
              onClick={() => setStoreScope('home')}
            >
              My Store ({homeStore})
            </button>
            <button
              type="button"
              className={`transfers-v2-toggle-btn${storeScope === 'group' ? ' is-active' : ''}`}
              aria-pressed={storeScope === 'group'}
              onClick={() => setStoreScope('group')}
            >
              All Stores
            </button>
          </div>

          {/* Queue View Switcher */}
          <div
            className="transfers-v2-toggle-group"
            role="group"
            aria-label="Movement queue view"
          >
            {(
              [
                ['active', 'Active Moves'],
                ['needs-action', 'Needs Action'],
                ['history', 'Completed'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`transfers-v2-toggle-btn${queueView === val ? ' is-active' : ''}`}
                aria-pressed={queueView === val}
                onClick={() => setQueueView(val)}
              >
                <span>{label}</span>
                <span className="transfers-v2-toggle-count">{queueCounts[val]}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            className="transfers-v2-request-btn"
            onClick={() => navigate('/inventory?scope=group')}
            aria-label="Request vehicle move"
          >
            <Plus size={16} aria-hidden="true" />
            Request Vehicle
          </button>
        </div>
      </header>

      {/* Toolbar: Search, Filters, Sorters */}
      <div className="transfers-v2-toolbar">
        <label className="transfers-v2-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stock, VIN, driver, custodian, route..."
            aria-label="Search vehicle moves"
          />
        </label>

        <div className="transfers-v2-filters">
          <label className="transfers-v2-select-label" title="Filter by stage">
            <ListFilter size={14} aria-hidden="true" />
            <select
              className="transfers-v2-select"
              aria-label="Filter vehicle moves"
              value={queueFilter}
              onChange={(e) => setQueueFilter(e.target.value as TransferQueueFilter)}
            >
              <option value="all">All stages</option>
              <option value="awaiting-approval">Waiting for approval</option>
              <option value="ready-to-collect">Ready to collect</option>
              <option value="at-requesting-store">At requesting store</option>
              <option value="moving">In transit</option>
              <option value="return-due">Return due</option>
              <option value="issues">Issues to review</option>
            </select>
          </label>

          <label className="transfers-v2-select-label" title="Sort vehicle moves">
            <ArrowDownUp size={14} aria-hidden="true" />
            <select
              className="transfers-v2-select"
              aria-label="Sort vehicle moves"
              value={queueSort}
              onChange={(e) => setQueueSort(e.target.value as TransferQueueSort)}
            >
              <option value="urgency">Sort by Urgency</option>
              <option value="needed-by">Sort by Next Due</option>
              <option value="recent">Sort by Newest Request</option>
              <option value="stock">Sort by Stock #</option>
              <option value="route">Sort by Route</option>
            </select>
          </label>

          <div className="transfers-v2-metrics-summary" aria-live="polite">
            {filteredDetails.length} {filteredDetails.length === 1 ? 'move' : 'moves'} shown
          </div>
        </div>
      </div>

      {/* Master-Detail Layout */}
      {details.length === 0 ? (
        <div className="transfers-v2-empty-state">
          <TransferEmptyState onAction={() => navigate('/inventory')} actionLabel="Find a vehicle" />
        </div>
      ) : (
        <div className="transfers-v2-layout">
          {/* Left Column: Movement Queue Cards */}
          <div className="transfers-v2-queue" role="feed" aria-label="Movement queue cards">
            <AnimatePresence mode="popLayout">
              {filteredDetails.length === 0 ? (
                <div className="transfers-v2-empty-state">
                  <Truck size={32} aria-hidden="true" />
                  <h3>No matching movement records</h3>
                  <p>
                    {queueView === 'needs-action'
                      ? 'No movement updates currently waiting on your action.'
                      : 'Try broadening your search query or selecting "All Stores".'}
                  </p>
                </div>
              ) : (
                filteredDetails.map(({ record, detail }) => {
                  const isSelected = selected?.record.id === record.id;
                  const thumbnail = detail.vehicle.imageUrl || null;
                  const countdown = calculateCountdown(
                    detail.nextAction.dueAt || record.dueAt,
                    detail.nextAction.sla,
                  );
                  const issue = transferIssueLabel(detail);
                  const away = awayFromHomeSummary(
                    record.homeStore,
                    record.currentLocation,
                    record.events,
                  );
                  const step = workflowStep(record.requestStatus);
                  const simpleRecord = record.workflowMode === 'simple';
                  const stageText = simpleRecord
                    ? compactRequestStatus(record.requestStatus, true)
                    : `Step ${step} of 5 · ${compactRequestStatus(record.requestStatus)}`;

                  const origin = record.homeStore || detail.vehicle.homeStore;
                  const destination = record.destination || detail.requestingStore || 'Target Store';
                  const custodian =
                    record.custodian ||
                    record.transportAssignee ||
                    record.nextActionOwner ||
                    'Unassigned';

                  // Available progression actions
                  const allowed = simpleRecord
                    ? simpleTransferActions(detail)
                    : detail.allowedActions.filter((a) => !PASSIVE_TRANSFER_ACTIONS.has(a));
                  const progressionAction =
                    SIMPLE_ACTION_ORDER.find((action) => allowed.includes(action)) || allowed[0];

                  return (
                    <motion.article
                      key={record.id}
                      layout
                      layoutId={`transfer-card-${record.id}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      whileHover={{ y: -2 }}
                      className={`transfers-v2-card${isSelected ? ' is-selected' : ''}${countdown.isOverdue ? ' is-overdue' : ''}`}
                      onClick={() => selectTransfer(record.id)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Movement card for ${detail.vehicle.vehicleLabel}, Stock ${detail.vehicle.stock}`}
                      onKeyDown={(e: ReactKeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectTransfer(record.id);
                        }
                      }}
                    >
                      {/* Card Header: Photo & Identifiers */}
                      <div className="transfers-v2-card-header">
                        <div className="transfers-v2-card-thumb">
                          {thumbnail ? (
                            <img src={thumbnail} alt="" loading="lazy" />
                          ) : (
                            <CarFront size={22} aria-hidden="true" />
                          )}
                        </div>
                        <div className="transfers-v2-card-headline">
                          <div className="transfers-v2-card-top-row">
                            <span className="transfers-v2-card-title">
                              {detail.vehicle.vehicleLabel}
                            </span>
                            {record.priority === 'urgent' || detail.priority === 'critical' ? (
                              <span className="transfers-v2-priority-pill transfers-v2-priority-urgent">
                                Urgent
                              </span>
                            ) : record.priority === 'high' || detail.priority === 'high' ? (
                              <span className="transfers-v2-priority-pill transfers-v2-priority-high">
                                High
                              </span>
                            ) : null}
                          </div>
                          <div className="transfers-v2-card-chips">
                            <CopyableValue label="Stock" text={record.stockNumber} compact>
                              #{record.stockNumber}
                            </CopyableValue>
                            <CopyableValue label="VIN" text={record.vin} compact>
                              {record.vin.slice(-8)}
                            </CopyableValue>
                          </div>
                        </div>
                      </div>

                      {/* Route & Custody Section */}
                      <div className="transfers-v2-movement-bar">
                        <div className="transfers-v2-route-row">
                          <span className="transfers-v2-route">
                            <strong>{origin}</strong>
                            <ArrowRight size={13} className="transfers-v2-route-arrow" aria-hidden="true" />
                            <strong>{destination}</strong>
                          </span>
                          <span className="transfers-v2-location">
                            <MapPin size={12} aria-hidden="true" />
                            {record.currentLocation}
                            {away.isAway ? ` (${away.label})` : ''}
                          </span>
                        </div>
                        <div className="transfers-v2-custody-row">
                          <span className="transfers-v2-custodian">
                            <User size={13} aria-hidden="true" />
                            Custodian: {custodian}
                          </span>
                          <span className="transfers-v2-stage-pill">{stageText}</span>
                        </div>
                      </div>

                      {/* Timing & Countdown Timer Badges */}
                      <div className="transfers-v2-timing-row">
                        <span
                          className={`transfers-v2-countdown-badge ${
                            countdown.isOverdue
                              ? 'transfers-v2-countdown-overdue'
                              : countdown.isDueSoon
                                ? 'transfers-v2-countdown-due-soon'
                                : detail.nextAction.dueAt
                                  ? 'transfers-v2-countdown-on-track'
                                  : 'transfers-v2-countdown-neutral'
                          }`}
                        >
                          {countdown.isOverdue ? (
                            <CircleAlert size={12} aria-hidden="true" />
                          ) : (
                            <Clock size={12} aria-hidden="true" />
                          )}
                          {countdown.label}
                        </span>

                        {record.returnRequired ? (
                          <span className="transfers-v2-return-pill">
                            <RotateCcw size={12} aria-hidden="true" />
                            {returnTimingLabel(record)}
                          </span>
                        ) : null}
                      </div>

                      {/* Overdue Banner Highlight */}
                      {countdown.isOverdue ? (
                        <div className="transfers-v2-overdue-alert" role="alert">
                          <CircleAlert size={14} aria-hidden="true" />
                          <span>
                            <strong>Action Overdue:</strong> {dueLabel(detail)}
                          </span>
                        </div>
                      ) : null}

                      {/* Issue Alert */}
                      {issue ? (
                        <div className="transfers-v2-issue-alert" role="status">
                          <AlertTriangle size={14} aria-hidden="true" />
                          <span>{issue}</span>
                        </div>
                      ) : null}

                      {/* Card Action Footer with Inline Action Progression Buttons */}
                      <div className="transfers-v2-card-footer">
                        <div className="transfers-v2-next-action-summary">
                          <span>Next Step</span>
                          <strong>{compactNextAction(record.nextAction)}</strong>
                        </div>

                        <div className="transfers-v2-card-actions">
                          {progressionAction ? (
                            <motion.button
                              type="button"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              className="transfers-v2-btn-progression"
                              onClick={(e: ReactMouseEvent) => {
                                handleAction(progressionAction, detail);
                              }}
                              title={simpleTransferActionLabel(progressionAction)}
                              aria-label={`${simpleTransferActionLabel(progressionAction)} for ${record.stockNumber}`}
                            >
                              {simpleTransferActionLabel(progressionAction)}
                            </motion.button>
                          ) : null}

                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="transfers-v2-btn-details"
                            onClick={(e: ReactMouseEvent) => {
                              e.stopPropagation();
                              selectTransfer(record.id);
                            }}
                            aria-label={`Track movement for ${record.stockNumber}`}
                          >
                            Track
                          </motion.button>
                        </div>
                      </div>
                    </motion.article>
                  );
                })
              )}
            </AnimatePresence>
          </div>

          {/* Right Column: Movement Tracking Detail Pane */}
          <div className="transfers-v2-detail-pane" id="transfer-detail-workspace">
            {selected ? (
              <div>
                <div className="transfers-v2-detail-header">
                  <h2>
                    {selected.detail.vehicle.stock} · {selected.detail.vehicle.vehicleLabel}
                  </h2>
                  <button
                    type="button"
                    className="transfers-v2-close-detail"
                    onClick={() => selectTransfer(null)}
                    aria-label="Close transfer details"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
                <TransferDetailLoader
                  selected={selected}
                  data={data}
                  role={role}
                  homeStore={homeStore}
                  onAction={handleAction}
                />
              </div>
            ) : (
              <div className="transfers-v2-detail-empty">
                <Truck size={36} aria-hidden="true" />
                <p>Select any vehicle movement from the queue to view its full custody audit trail and location timeline.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Location overview disclosure */}
      {simple ? (
        <details className="move-location-disclosure">
          <summary>
            <MapPin aria-hidden="true" size={18} /> Browse vehicle locations{' '}
            <ChevronDown aria-hidden="true" size={16} />
          </summary>
          <VehicleLocationOverview
            vehicles={data.vehicles}
            transfers={data.transfers}
            homeStore={homeStore}
          />
        </details>
      ) : null}

      {/* Action Dialog */}
      {pendingAction ? (
        <TransferActionDialog
          {...pendingAction}
          onClose={() => setPendingAction(null)}
          onComplete={(updated) => {
            if (isTerminalTransfer(updated)) setQueueView('history');
            selectTransfer(updated.id);
            refresh?.();
          }}
        />
      ) : null}
    </div>
  );
}
