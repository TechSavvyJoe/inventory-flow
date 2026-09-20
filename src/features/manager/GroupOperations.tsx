import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowRight,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Filter,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import {
  formatDateTime,
  humanizeStatusLabel,
  locationConfidenceLabel,
  slaLabel,
  TransferEmptyState,
  TransferTracker,
  type MovementStatusCode,
  type RequestStatusCode,
  type SlaState,
  type StoreName,
  type TransferActionKind,
} from '../transfers';
import type {
  GroupOperationRecord,
  ManagerDueWindow,
  ManagerFilters,
  ManagerSortField,
  ManagerSortRule,
  SavedManagerView,
  StoreFilterOption,
} from './types';
import { emptyManagerFilters } from './types';
import './manager.css';

export interface GroupOperationsProps {
  records: GroupOperationRecord[];
  storeOptions: StoreFilterOption[];
  homeStore?: StoreName;
  currentUserId?: string;
  savedViews?: SavedManagerView[];
  initialFilters?: Partial<ManagerFilters>;
  initialSortRules?: ManagerSortRule[];
  selectedTransferId?: string | null;
  now?: string;
  loading?: boolean;
  sourceWarning?: string;
  onFiltersChange?: (filters: ManagerFilters) => void;
  onSortChange?: (rules: ManagerSortRule[]) => void;
  onSavedViewSelect?: (view: SavedManagerView | null) => void;
  onSaveView?: (view: Omit<SavedManagerView, 'id'>) => void;
  onSelectTransfer?: (transfer: GroupOperationRecord | null) => void;
  onAction?: (action: TransferActionKind, transfer: GroupOperationRecord) => void;
  onCreateRequest?: () => void;
}

type SystemView = 'my-store' | 'group' | 'needs-me' | 'overdue' | 'exceptions';
type SummaryQueue = 'needs-approval' | 'pickup-due' | 'in-transit' | 'outcome-due' | 'return-due' | 'location-exception';

const priorityRank: Record<NonNullable<GroupOperationRecord['priority']>, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const slaRank: Record<SlaState, number> = {
  breached: 0,
  overdue: 1,
  'due-soon': 2,
  'on-track': 3,
  none: 4,
};

const sortFieldLabels: Record<ManagerSortField, string> = {
  sla: 'SLA risk',
  dueAt: 'Due time',
  priority: 'Priority',
  vehicle: 'Vehicle',
  homeStore: 'Home Store',
  currentLocation: 'Current location',
  requestingStore: 'Requesting store',
  movementStage: 'Movement stage',
  lastConfirmedAt: 'Last confirmed',
};

function createFilters(initial?: Partial<ManagerFilters>): ManagerFilters {
  return { ...emptyManagerFilters, ...initial };
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'en-US'));
}

function displayOperationalLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || !/[_-]/.test(normalized)) return normalized;
  return normalized
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase())
    .join(' ');
}

function matchesDueWindow(record: GroupOperationRecord, dueWindow: ManagerDueWindow, nowMs: number): boolean {
  if (dueWindow === 'all') return true;
  if (!record.nextAction.dueAt) return dueWindow === 'no-due';
  const dueMs = Date.parse(record.nextAction.dueAt);
  if (Number.isNaN(dueMs)) return dueWindow === 'no-due';
  if (dueWindow === 'overdue') return dueMs < nowMs;
  const endOfToday = new Date(nowMs);
  endOfToday.setHours(23, 59, 59, 999);
  if (dueWindow === 'today') return dueMs <= endOfToday.getTime() && dueMs >= nowMs;
  const days = dueWindow === 'next-2-days' ? 2 : 7;
  return dueMs >= nowMs && dueMs <= nowMs + days * 86_400_000;
}

function compareNullable(a?: string | number, b?: string | number): number {
  if (a === b) return 0;
  if (a === undefined || a === '') return 1;
  if (b === undefined || b === '') return -1;
  return typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), 'en-US', { numeric: true });
}

function sortValue(record: GroupOperationRecord, field: ManagerSortField): string | number | undefined {
  switch (field) {
    case 'sla':
      return slaRank[record.nextAction.sla];
    case 'dueAt':
      return record.nextAction.dueAt ? Date.parse(record.nextAction.dueAt) : undefined;
    case 'priority':
      return priorityRank[record.priority ?? 'normal'];
    case 'vehicle':
      return record.vehicle.vehicleLabel;
    case 'homeStore':
      return record.vehicle.homeStore;
    case 'currentLocation':
      return record.vehicle.currentLocation.label;
    case 'requestingStore':
      return record.requestingStore;
    case 'movementStage':
      return displayOperationalLabel(record.status.movement.label);
    case 'lastConfirmedAt':
      return record.vehicle.currentLocation.confirmedAt
        ? Date.parse(record.vehicle.currentLocation.confirmedAt)
        : undefined;
  }
}

function recordMatches(record: GroupOperationRecord, filters: ManagerFilters, nowMs: number): boolean {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();
  if (normalizedQuery) {
    const haystack = [
      record.vehicle.stock,
      record.vehicle.vin,
      record.vehicle.vehicleLabel,
      record.vehicle.trimLabel,
      record.vehicle.homeStore,
      record.vehicle.currentLocation.label,
      record.requestingStore,
      record.destination,
      record.custodianLabel,
      record.salespersonLabel,
      record.status.request.label,
      record.status.movement.label,
      displayOperationalLabel(record.status.movement.label),
      record.status.deal.label,
      record.status.delivery.label,
      record.status.dealerMail.label,
      record.status.publicListing.label,
      record.status.dealerOnInStock?.label,
      record.status.dealerOnInTransit?.label,
      record.status.dealerOnInProduction?.label,
      record.status.cdk.label,
      record.nextAction.label,
      record.nextAction.ownerLabel,
      record.exception?.label,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    if (!haystack.includes(normalizedQuery)) return false;
  }

  if (filters.homeStores.length && !filters.homeStores.includes(record.vehicle.homeStore)) return false;
  if (filters.currentLocations.length && !filters.currentLocations.includes(record.vehicle.currentLocation.label)) return false;
  if (filters.requestingStores.length && (!record.requestingStore || !filters.requestingStores.includes(record.requestingStore))) return false;
  if (filters.requestStatuses.length && !filters.requestStatuses.includes(record.status.request.code)) return false;
  if (filters.movementStatuses.length && !filters.movementStatuses.includes(record.status.movement.code)) return false;
  if (filters.dealerMailStatuses.length && !filters.dealerMailStatuses.includes(record.status.dealerMail.code)) return false;
  if (filters.publicStatuses.length && !filters.publicStatuses.includes(record.status.publicListing.code)) return false;
  if (filters.priorities.length && !filters.priorities.includes(record.priority ?? 'normal')) return false;
  if (filters.custodians.length && (!record.custodianLabel || !filters.custodians.includes(record.custodianLabel))) return false;
  if (filters.salespeople.length && (!record.salespersonLabel || !filters.salespeople.includes(record.salespersonLabel))) return false;
  if (filters.slaStates.length && !filters.slaStates.includes(record.nextAction.sla)) return false;
  if (filters.nextActionOwnerIds.length && (!record.nextAction.ownerId || !filters.nextActionOwnerIds.includes(record.nextAction.ownerId))) return false;
  if (filters.exceptionOnly && !record.exception) return false;
  return matchesDueWindow(record, filters.dueWindow, nowMs);
}

function metricCount(records: GroupOperationRecord[], predicate: (record: GroupOperationRecord) => boolean) {
  let count = 0;
  let overdue = 0;
  for (const record of records) {
    if (!predicate(record)) continue;
    count += 1;
    if (record.nextAction.sla === 'overdue' || record.nextAction.sla === 'breached') overdue += 1;
  }
  return { count, overdue };
}

function matchesSummaryQueue(record: GroupOperationRecord, queue: SummaryQueue): boolean {
  switch (queue) {
    case 'needs-approval':
      return record.status.request.code === 'submitted';
    case 'pickup-due':
      return ['release-approved', 'pickup-scheduled'].includes(record.status.movement.code);
    case 'in-transit':
      return ['released-to-custodian', 'in-transit-outbound', 'in-transit-return'].includes(record.status.movement.code);
    case 'outcome-due':
      return record.status.movement.code === 'at-requesting-store-verified' && record.status.deal.code === 'no-outcome';
    case 'return-due':
      return ['return-required', 'return-scheduled', 'returned-awaiting-receipt'].includes(record.status.movement.code);
    case 'location-exception':
      return ['location-exception', 'location-unknown'].includes(record.status.movement.code) || Boolean(record.exception);
  }
}

interface FilterSelectProps {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}

function FilterSelect({ label, value, values, onChange }: FilterSelectProps) {
  return (
    <label className="mif-manager-filter">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">All</option>
        {values.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export function GroupOperations({
  records,
  storeOptions,
  homeStore,
  currentUserId,
  savedViews = [],
  initialFilters,
  initialSortRules = [{ field: 'dueAt', direction: 'asc' }],
  selectedTransferId,
  now,
  loading = false,
  sourceWarning,
  onFiltersChange,
  onSortChange,
  onSavedViewSelect,
  onSaveView,
  onSelectTransfer,
  onAction,
  onCreateRequest,
}: GroupOperationsProps) {
  const [filters, setFilters] = useState<ManagerFilters>(() => createFilters(initialFilters));
  const [sortRules, setSortRules] = useState<ManagerSortRule[]>(initialSortRules);
  const [systemView, setSystemView] = useState<SystemView>('group');
  const [summaryQueue, setSummaryQueue] = useState<SummaryQueue | null>(null);
  const [selectedIdInternal, setSelectedIdInternal] = useState<string | null>(selectedTransferId ?? null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [savedViewName, setSavedViewName] = useState('');
  const nowMs = useMemo(() => {
    const parsed = now ? Date.parse(now) : Date.now();
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }, [now]);
  const selectedId = selectedTransferId === undefined ? selectedIdInternal : selectedTransferId;

  const activeFilterCount = useMemo(() => (
    filters.homeStores.length
    + filters.currentLocations.length
    + filters.requestingStores.length
    + filters.requestStatuses.length
    + filters.movementStatuses.length
    + filters.dealerMailStatuses.length
    + filters.publicStatuses.length
    + filters.priorities.length
    + filters.custodians.length
    + filters.salespeople.length
    + filters.slaStates.length
    + filters.nextActionOwnerIds.length
    + (filters.dueWindow === 'all' ? 0 : 1)
    + (filters.exceptionOnly ? 1 : 0)
  ), [filters]);

  const options = useMemo(() => ({
    currentLocations: uniqueValues(records.map((record) => record.vehicle.currentLocation.label)),
    requestingStores: uniqueValues(records.map((record) => record.requestingStore)),
    custodians: uniqueValues(records.map((record) => record.custodianLabel)),
    salespeople: uniqueValues(records.map((record) => record.salespersonLabel)),
    // Request codes the adapter does not name fall through as stored
    // snake_case; read them as words in the filter.
    requestStatuses: uniqueValues(records.map((record) => humanizeStatusLabel(record.status.request.label))),
    movementStatuses: uniqueValues(records.map((record) => displayOperationalLabel(record.status.movement.label))),
    dealerMailStatuses: uniqueValues(records.map((record) => record.status.dealerMail.label)),
  }), [records]);

  const labelToRequestCode = useMemo(() => new Map(records.map((record) => [humanizeStatusLabel(record.status.request.label), record.status.request.code])), [records]);
  const labelToMovementCode = useMemo(() => new Map(records.map((record) => [displayOperationalLabel(record.status.movement.label), record.status.movement.code])), [records]);
  const labelToDealerMailCode = useMemo(() => new Map(records.map((record) => [record.status.dealerMail.label, record.status.dealerMail.code])), [records]);

  const visibleRecords = useMemo(() => {
    const filtered = records.filter((record) => (
      recordMatches(record, filters, nowMs)
      && (!summaryQueue || matchesSummaryQueue(record, summaryQueue))
    ));
    return filtered.sort((left, right) => {
      for (const rule of sortRules) {
        const compared = compareNullable(sortValue(left, rule.field), sortValue(right, rule.field));
        if (compared !== 0) return rule.direction === 'asc' ? compared : -compared;
      }
      return left.vehicle.stock.localeCompare(right.vehicle.stock, 'en-US', { numeric: true });
    });
  }, [filters, nowMs, records, sortRules, summaryQueue]);

  const selected = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  const metrics = useMemo(() => [
    {
      id: 'needs-approval' as const,
      label: 'Needs approval',
      Icon: CheckCircle2,
      tone: 'location',
      ...metricCount(records, (record) => record.status.request.code === 'submitted'),
    },
    {
      id: 'pickup-due' as const,
      label: 'Pickup due',
      Icon: Truck,
      tone: 'warning',
      ...metricCount(records, (record) => ['release-approved', 'pickup-scheduled'].includes(record.status.movement.code)),
    },
    {
      id: 'in-transit' as const,
      label: 'In transit',
      Icon: Truck,
      tone: 'info',
      ...metricCount(records, (record) => ['released-to-custodian', 'in-transit-outbound', 'in-transit-return'].includes(record.status.movement.code)),
    },
    {
      id: 'outcome-due' as const,
      label: 'Outcome due',
      Icon: CircleAlert,
      tone: 'success',
      ...metricCount(records, (record) => record.status.movement.code === 'at-requesting-store-verified' && record.status.deal.code === 'no-outcome'),
    },
    {
      id: 'return-due' as const,
      label: 'Return due',
      Icon: Clock3,
      tone: 'danger',
      ...metricCount(records, (record) => ['return-required', 'return-scheduled', 'returned-awaiting-receipt'].includes(record.status.movement.code)),
    },
    {
      id: 'location-exception' as const,
      label: 'Location exception',
      Icon: MapPin,
      tone: 'neutral',
      ...metricCount(records, (record) => ['location-exception', 'location-unknown'].includes(record.status.movement.code) || Boolean(record.exception)),
    },
  ], [records]);

  function applyFilters(next: ManagerFilters) {
    setFilters(next);
    onFiltersChange?.(next);
  }

  function patchFilters(patch: Partial<ManagerFilters>) {
    applyFilters({ ...filters, ...patch });
  }

  function applySortRules(next: ManagerSortRule[]) {
    const normalized = next.length ? next : [{ field: 'dueAt' as const, direction: 'asc' as const }];
    setSortRules(normalized);
    onSortChange?.(normalized);
  }

  function applySystemView(view: SystemView) {
    setSystemView(view);
    setSummaryQueue(null);
    const base = { ...emptyManagerFilters, query: filters.query };
    if (view === 'my-store') {
      applyFilters({ ...base, homeStores: homeStore ? [homeStore] : [] });
      return;
    }
    if (view === 'group') {
      applyFilters(base);
      return;
    }
    if (view === 'needs-me') {
      applyFilters({ ...base, nextActionOwnerIds: currentUserId ? [currentUserId] : [] });
      return;
    }
    if (view === 'overdue') {
      applyFilters({ ...base, slaStates: ['overdue', 'breached'] });
      return;
    }
    applyFilters({ ...base, exceptionOnly: true });
  }

  function selectRecord(record: GroupOperationRecord | null) {
    setSelectedIdInternal(record?.id ?? null);
    onSelectTransfer?.(record);
  }

  function applySavedView(viewId: string) {
    const view = savedViews.find((candidate) => candidate.id === viewId) ?? null;
    if (!view) {
      onSavedViewSelect?.(null);
      return;
    }
    const nextFilters = createFilters(view.filters);
    setSummaryQueue(null);
    setSystemView('group');
    applyFilters(nextFilters);
    if (view.sortRules?.length) applySortRules(view.sortRules);
    onSavedViewSelect?.(view);
  }

  function addSortRule() {
    const unused = (Object.keys(sortFieldLabels) as ManagerSortField[]).find(
      (field) => !sortRules.some((rule) => rule.field === field),
    );
    if (unused) applySortRules([...sortRules, { field: unused, direction: 'asc' }]);
  }

  function applySummaryQueue(queue: SummaryQueue) {
    const nextQueue = summaryQueue === queue ? null : queue;
    setSummaryQueue(nextQueue);
    setSystemView('group');
    applyFilters({ ...emptyManagerFilters, query: filters.query });
  }

  function clearAllFilters() {
    setSummaryQueue(null);
    setSystemView('group');
    applyFilters(createFilters());
  }

  return (
    <section className={`mif-manager-feature mif-group-operations${selected ? ' has-selection' : ''}`}>
      <div className="mif-manager-main">
        <header className="mif-manager-heading">
          <div>
            <h1>Group operations</h1>
            <p>Review approvals, coordinate store-to-store moves, and resolve overdue work.</p>
          </div>
          <div className="mif-system-views" aria-label="Manager quick views">
            {([
              ['my-store', 'My store'],
              ['group', 'Group'],
              ['needs-me', 'Needs me'],
              ['overdue', 'Overdue'],
              ['exceptions', 'Exceptions'],
            ] as Array<[SystemView, string]>).map(([value, label]) => (
              <button
                aria-pressed={systemView === value}
                className={systemView === value ? 'is-active' : ''}
                disabled={(value === 'my-store' && !homeStore) || (value === 'needs-me' && !currentUserId)}
                key={value}
                onClick={() => applySystemView(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {sourceWarning ? (
          <div className="mif-manager-source-warning" role="status">
            <AlertTriangle aria-hidden="true" size={17} strokeWidth={1.75} />
            <span>{sourceWarning}</span>
          </div>
        ) : null}

        <div className="mif-operation-metrics" aria-label="Manager work queues">
          {metrics.map(({ id, label, Icon, count, overdue, tone }) => (
            <button
              aria-label={`Show ${label.toLocaleLowerCase()} queue, ${count} ${count === 1 ? 'movement' : 'movements'}${overdue ? `, ${overdue} overdue` : ''}`}
              aria-pressed={summaryQueue === id}
              className={`mif-operation-metric${summaryQueue === id ? ' is-active' : ''}`}
              key={id}
              onClick={() => applySummaryQueue(id)}
              type="button"
            >
              <Icon aria-hidden="true" className={`is-${tone}`} size={24} strokeWidth={1.75} />
              <span className="mif-operation-metric__label">{label}</span>
              <strong>{count}</strong>
              <small className={overdue ? 'is-overdue' : ''}>{overdue ? `${overdue} overdue` : 'No overdue items'}</small>
              <span className="mif-operation-metric__action">
                {summaryQueue === id ? 'Showing queue' : 'View queue'}
                <ChevronRight aria-hidden="true" size={14} strokeWidth={2} />
              </span>
            </button>
          ))}
        </div>

        <div className="mif-manager-toolbar">
          <label className="mif-manager-search">
            <Search aria-hidden="true" size={18} strokeWidth={1.75} />
            <span className="mif-visually-hidden">Search movements</span>
            <input
              onChange={(event) => patchFilters({ query: event.target.value })}
              placeholder="Search stock, VIN, vehicle, store, person, or status"
              type="search"
              value={filters.query}
            />
          </label>
          <button aria-expanded={filtersOpen} className="mif-manager-toolbutton" onClick={() => setFiltersOpen((open) => !open)} type="button">
            <Filter aria-hidden="true" size={17} strokeWidth={1.75} />
            Filters
            {activeFilterCount ? <span className="mif-manager-toolbutton__count">{activeFilterCount}</span> : null}
            <ChevronDown aria-hidden="true" size={15} strokeWidth={1.75} />
          </button>
          <label className="mif-saved-view-select">
            <Bookmark aria-hidden="true" size={17} strokeWidth={1.75} />
            <span className="mif-visually-hidden">Saved view</span>
            <select defaultValue="" onChange={(event) => applySavedView(event.target.value)}>
              <option value="">Saved views</option>
              {savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
            </select>
          </label>
          {onSaveView ? (
            <button className="mif-manager-toolbutton" onClick={() => setSaveViewOpen((open) => !open)} type="button">
              <Plus aria-hidden="true" size={17} strokeWidth={1.75} /> Save view
            </button>
          ) : null}
          <button aria-expanded={sortOpen} className="mif-manager-toolbutton" onClick={() => setSortOpen((open) => !open)} type="button">
            <ArrowDownAZ aria-hidden="true" size={17} strokeWidth={1.75} />
            Sort {sortRules.length > 1 ? `(${sortRules.length})` : ''}
          </button>
        </div>

        {saveViewOpen && onSaveView ? (
          <div className="mif-save-view-bar">
            <label>
              <span>View name</span>
              <input onChange={(event) => setSavedViewName(event.target.value)} placeholder="My movement view" value={savedViewName} />
            </label>
            <button
              className="mif-manager-primary"
              disabled={!savedViewName.trim()}
              onClick={() => {
                onSaveView({ name: savedViewName.trim(), filters, sortRules });
                setSavedViewName('');
                setSaveViewOpen(false);
              }}
              type="button"
            >
              Save current filters
            </button>
            <button aria-label="Close save view" className="mif-manager-iconbutton" onClick={() => setSaveViewOpen(false)} type="button"><X size={17} /></button>
          </div>
        ) : null}

        {sortOpen ? (
          <div className="mif-sort-builder" aria-label="Multi-sort rules">
            <div className="mif-sort-builder__heading">
              <div>
                <strong>Sort priority</strong>
                <span>Rules run from left to right.</span>
              </div>
              <button className="mif-manager-toolbutton" onClick={addSortRule} type="button"><Plus size={15} /> Add sort</button>
            </div>
            <div className="mif-sort-rules">
              {sortRules.map((rule, index) => (
                <div className="mif-sort-rule" key={`${rule.field}-${index}`}>
                  <span>{index + 1}</span>
                  <select
                    aria-label={`Sort ${index + 1} field`}
                    onChange={(event) => applySortRules(sortRules.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value as ManagerSortField } : item))}
                    value={rule.field}
                  >
                    {(Object.keys(sortFieldLabels) as ManagerSortField[]).map((field) => <option key={field} value={field}>{sortFieldLabels[field]}</option>)}
                  </select>
                  <select
                    aria-label={`Sort ${index + 1} direction`}
                    onChange={(event) => applySortRules(sortRules.map((item, itemIndex) => itemIndex === index ? { ...item, direction: event.target.value as 'asc' | 'desc' } : item))}
                    value={rule.direction}
                  >
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                  <button aria-label={`Remove sort ${index + 1}`} onClick={() => applySortRules(sortRules.filter((_, itemIndex) => itemIndex !== index))} type="button"><X size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {filtersOpen ? (
          <div className="mif-manager-filters">
            <FilterSelect label="Home Store" onChange={(value) => patchFilters({ homeStores: value ? [value] : [] })} value={filters.homeStores[0] ?? ''} values={storeOptions.map((store) => store.value)} />
            <FilterSelect label="Current location" onChange={(value) => patchFilters({ currentLocations: value ? [value] : [] })} value={filters.currentLocations[0] ?? ''} values={options.currentLocations} />
            <FilterSelect label="Requesting store" onChange={(value) => patchFilters({ requestingStores: value ? [value] : [] })} value={filters.requestingStores[0] ?? ''} values={options.requestingStores} />
            <FilterSelect
              label="Move status"
              onChange={(value) => patchFilters({ requestStatuses: value ? [labelToRequestCode.get(value) as RequestStatusCode] : [] })}
              value={humanizeStatusLabel(records.find((record) => filters.requestStatuses.includes(record.status.request.code))?.status.request.label ?? '')}
              values={options.requestStatuses}
            />
            <FilterSelect
              label="Movement stage"
              onChange={(value) => patchFilters({ movementStatuses: value ? [labelToMovementCode.get(value) as MovementStatusCode] : [] })}
              value={displayOperationalLabel(records.find((record) => filters.movementStatuses.includes(record.status.movement.code))?.status.movement.label ?? '')}
              values={options.movementStatuses}
            />
            <FilterSelect label="Custodian" onChange={(value) => patchFilters({ custodians: value ? [value] : [] })} value={filters.custodians[0] ?? ''} values={options.custodians} />
            <FilterSelect label="Salesperson" onChange={(value) => patchFilters({ salespeople: value ? [value] : [] })} value={filters.salespeople[0] ?? ''} values={options.salespeople} />
            <FilterSelect
              label="Hold-list status"
              onChange={(value) => patchFilters({ dealerMailStatuses: value ? [labelToDealerMailCode.get(value)!] : [] })}
              value={records.find((record) => filters.dealerMailStatuses.includes(record.status.dealerMail.code))?.status.dealerMail.label ?? ''}
              values={options.dealerMailStatuses}
            />
            <label className="mif-manager-filter">
              <span>Due window</span>
              <select onChange={(event) => patchFilters({ dueWindow: event.target.value as ManagerDueWindow })} value={filters.dueWindow}>
                <option value="all">All</option>
                <option value="today">Today</option>
                <option value="next-2-days">Next 2 days</option>
                <option value="next-7-days">Next 7 days</option>
                <option value="overdue">Overdue</option>
                <option value="no-due">No due time</option>
              </select>
            </label>
            <label className="mif-manager-filter mif-manager-filter--check">
              <input checked={filters.exceptionOnly} onChange={(event) => patchFilters({ exceptionOnly: event.target.checked })} type="checkbox" />
              <span>Exceptions only</span>
            </label>
            <button className="mif-clear-filters" onClick={clearAllFilters} type="button">
              <RotateCcw aria-hidden="true" size={15} strokeWidth={1.75} /> Clear all
            </button>
          </div>
        ) : null}

        <div className="mif-manager-resultbar">
          <div className="mif-manager-resultbar__scope">
            <span><strong>{visibleRecords.length}</strong> of {records.length} movements</span>
            {summaryQueue ? (
              <button aria-label="Clear summary queue" onClick={() => setSummaryQueue(null)} type="button">
                {metrics.find((metric) => metric.id === summaryQueue)?.label}
                <X aria-hidden="true" size={13} />
              </button>
            ) : null}
          </div>
          <span><SlidersHorizontal aria-hidden="true" size={14} strokeWidth={1.75} /> {sortRules.map((rule) => `${sortFieldLabels[rule.field]} ${rule.direction === 'asc' ? '↑' : '↓'}`).join(' · ')}</span>
        </div>

        {loading ? (
          <div className="mif-manager-loading" aria-live="polite"><Clock3 aria-hidden="true" size={20} /> Loading operations…</div>
        ) : records.length === 0 ? (
          <TransferEmptyState actionLabel={onCreateRequest ? 'Create movement request' : undefined} onAction={onCreateRequest} variant="no-records" />
        ) : visibleRecords.length === 0 ? (
          <TransferEmptyState
            actionLabel="Clear filters"
            description="No movements match the current quick view, filters, and sort scope."
            onAction={clearAllFilters}
            title="No matching movements"
            variant="no-records"
          />
        ) : (
          <>
            <div className="mif-operations-table-wrap">
              <table className="mif-operations-table">
                <colgroup>
                  <col className="mif-operations-table__col--vehicle" />
                  <col className="mif-operations-table__col--route" />
                  <col className="mif-operations-table__col--workflow" />
                  <col className="mif-operations-table__col--ownership" />
                  <col className="mif-operations-table__col--timing" />
                  <col className="mif-operations-table__col--exception" />
                  <col className="mif-operations-table__col--action" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Vehicle / priority</th>
                    <th>Where it is going</th>
                    <th>Current step</th>
                    <th>Who acts next</th>
                    <th>When</th>
                    <th>Issue</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((record) => {
                    const isSelected = record.id === selectedId;
                    return (
                      <tr
                        aria-selected={isSelected}
                        className={isSelected ? 'is-selected' : ''}
                        key={record.id}
                        onClick={() => selectRecord(record)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectRecord(record);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td className="mif-manager-vehicle-cell">
                          <span className="mif-manager-vehicle-cell__heading">
                            <strong>{record.vehicle.vehicleLabel}</strong>
                            <span className={`mif-priority is-${record.priority ?? 'normal'}`}>{record.priority ?? 'normal'}</span>
                          </span>
                          <span>{record.vehicle.stock} · {record.vehicle.vin}</span>
                        </td>
                        <td className="mif-manager-route-cell">
                          <span className="mif-route-cells">
                            <b>{record.vehicle.homeStore}</b><ArrowRight size={13} /><b>{record.vehicle.currentLocation.label}</b><ArrowRight size={13} /><b>{record.destination ?? record.requestingStore ?? 'Not set'}</b>
                          </span>
                          <span>Requesting store · {record.requestingStore ?? 'Not set'}</span>
                        </td>
                        <td className="mif-manager-workflow-cell">
                          <strong>{displayOperationalLabel(record.status.movement.label)}</strong>
                          <span>{record.status.request.label}</span>
                        </td>
                        <td className="mif-manager-ownership-cell">
                          <strong>{record.nextAction.ownerLabel ?? 'Not assigned'}</strong>
                          <span>{record.nextAction.ownerRole ?? record.nextAction.label}</span>
                          <small>Custodian · {record.custodianLabel ?? 'Not assigned'}</small>
                        </td>
                        <td className="mif-manager-timing-cell">
                          <strong>{formatDateTime(record.nextAction.dueAt)}</strong>
                          <span className={`mif-sla-label is-${record.nextAction.sla}`}>{slaLabel(record.nextAction.sla)}</span>
                          <small>Last confirmed · {formatDateTime(record.vehicle.currentLocation.confirmedAt)} · {locationConfidenceLabel(record.vehicle.currentLocation.confidence)}</small>
                        </td>
                        <td className="mif-manager-exception-cell">{record.exception ? <span className={`mif-exception-cell is-${record.exception.severity}`}><AlertTriangle size={14} />{record.exception.label}</span> : <span className="mif-exception-cell is-clear">No exception</span>}</td>
                        <td className="mif-manager-review-cell"><button aria-label={`Review ${record.vehicle.stock}`} className="mif-manager-review-button" onClick={(event) => { event.stopPropagation(); selectRecord(record); }} type="button"><span>Review</span><ChevronRight size={16} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mif-operations-mobile-list">
              {visibleRecords.map((record) => (
                <button className={record.id === selectedId ? 'is-selected' : ''} key={record.id} onClick={() => selectRecord(record)} type="button">
                  <span className="mif-mobile-row-top"><b>{record.vehicle.vehicleLabel}</b><span className={`mif-priority is-${record.priority ?? 'normal'}`}>{record.priority ?? 'normal'}</span></span>
                  <span>{record.vehicle.stock} · {record.vehicle.homeStore} → {record.vehicle.currentLocation.label}</span>
                  <span className="mif-mobile-row-stage"><Truck size={15} /> {displayOperationalLabel(record.status.movement.label)}</span>
                  <span className={`mif-mobile-row-due is-${record.nextAction.sla}`}><Clock3 size={15} /> {record.nextAction.label} · {formatDateTime(record.nextAction.dueAt)}</span>
                  <span><UserRound size={15} /> {record.nextAction.ownerLabel ?? 'Owner not assigned'}</span>
                  {record.exception ? <span className="mif-mobile-row-exception"><AlertTriangle size={15} /> {record.exception.label}</span> : null}
                  <span className="mif-mobile-row-action">Review movement <ChevronRight aria-hidden="true" size={16} /></span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {selected ? (
        <aside className="mif-manager-detail">
          <TransferTracker
            mode="drawer"
            onAction={(action) => onAction?.(action, selected)}
            onClose={() => selectRecord(null)}
            transfer={selected}
          />
        </aside>
      ) : null}
    </section>
  );
}
