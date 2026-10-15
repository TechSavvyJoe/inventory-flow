import { InventoryExpansionControl, InventoryExpansionProvider } from "./InventoryExpansion";
import { useWorkspaceState, useWorkspaceScroll } from "../../lib/workspace-memory";
import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Filter,
  Heart,
  ListFilter,
  Plus,
  Search,
  ScanLine,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  filterPanelHoldValue,
  filterPanelMovementValue,
  inventoryInLocationScope,
  matchesInventoryQuickView,
  selectHoldFilter,
  selectMovementFilter,
  selectQuickView,
  toggleSecondaryQuickView,
  type InventoryViewState,
  type QuickView,
} from "./inventory-quick-views";
import { ScanVehicleDialog } from "./ScanVehicleDialog";
import { InventoryPredictiveSearch } from "./InventoryPredictiveSearch";
import { serviceWorkflowStatus } from "../../lib/service-readiness";
import { useModalBackgroundIsolation } from "../../lib/useModalBackgroundIsolation";
import { InventoryMobileList, InventoryTable, inventorySortSummary } from "./InventoryTable";
import { VehicleWorkspace } from "./VehicleWorkspace";
import { SaveVehicleDialog } from "./SaveVehicleDialog";
import { CustomerShortlistDrawer } from "./CustomerShortlistDrawer";
import { ShortlistContext, useCustomerShortlist } from "./useCustomerShortlist";
import { useSyncedCustomerLists } from "./useSyncedCustomerLists";
import { useInventoryDisclosure } from "./useInventoryDisclosure";
import { buildInventorySearchIndexes, rankInventorySearchWithAuthorizedFallback } from "./inventory-search";
import {
  activeFilterCount,
  formatMoney,
  DEFAULT_INVENTORY_FILTERS,
  DEFAULT_INVENTORY_SORTS,
  SORT_LABELS,
  sortVehicles,
  vehicleMatchesFilters,
} from "./inventory-utils";
import type {
  InventoryExperienceProps,
  InventoryFilters,
  InventoryGroupStore,
  InventoryScope,
  InventorySort,
  InventorySortKey,
  InventoryStore,
  InventoryVehicle,
  VehicleWorkspaceTab,
} from "./types";
import { OVERVIEW_VIEW_LABELS } from "../overview/overview-links";
import { FlowPageHeader } from "../../design-system";
import { emptyFilterResetLabel, WORKFLOW_RESET_LABELS } from "../../lib/workflow-view-reset";
import "./inventory.css";
import "./inventory-modern.css";
import "./InventoryServiceFilter.css";

const PAGE_SIZE_OPTIONS = [10, 15, 20, 25, 50, 100] as const;
/** Phones always get cards; any wider results surface above this width gets
 *  the desk table (a 1024px landscape tablet included). The CSS container
 *  query in InventoryTable.desk.css uses the same width: change both together. */
const PHONE_QUERY = "(max-width: 760px)";
const CARD_SURFACE_MAX_WIDTH = 820;
const MAX_SORT_LEVELS = 5;
type ServiceFilter = NonNullable<InventoryFilters["serviceReadiness"]>;
const SERVICE_FILTERS: Array<[ServiceFilter, string]> = [["all", "All service"], ["needs_service", "Waiting for service"], ["in_service", "In service"], ["serviced", "Ready"]];

function initialServiceFilter(key: string): ServiceFilter {
  try {
    const saved = window.sessionStorage.getItem(key);
    if (saved === "unknown") return "needs_service";
    return SERVICE_FILTERS.some(([value]) => value === saved) ? saved as ServiceFilter : "all";
  } catch { return "all"; }
}

function numericInputValue(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function normalizedPageSize(value: number): number {
  return PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number]) ? value : 10;
}

function initialRowsPerPage(fallback: number): number {
  if (typeof window === "undefined") return normalizedPageSize(fallback);
  try {
    return normalizedPageSize(Number(window.sessionStorage.getItem("inventory:rows-per-page")) || fallback);
  } catch {
    return normalizedPageSize(fallback);
  }
}

function uniqueStores(homeStore: InventoryStore, vehicles: InventoryVehicle[], groupStores?: InventoryGroupStore[]) {
  const stores = new Map<string, InventoryGroupStore>();
  stores.set(homeStore.id, homeStore);
  for (const store of groupStores ?? []) stores.set(store.id, store);
  for (const vehicle of vehicles) stores.set(vehicle.location.homeStore.id, vehicle.location.homeStore);
  return [...stores.values()].sort((left, right) => {
    if (left.id === homeStore.id) return -1;
    if (right.id === homeStore.id) return 1;
    return left.name.localeCompare(right.name, "en-US");
  });
}

function ScopeSwitch({
  homeStore,
  scope,
  homeCount,
  groupCount,
  onChange,
}: {
  homeStore: InventoryStore;
  scope: InventoryScope;
  homeCount: number;
  groupCount: number;
  onChange: (scope: InventoryScope) => void;
}) {
  return (
    <div className="if-srp-scope" role="group" aria-label="Inventory location scope">
      <button type="button" className={scope === "home" ? "is-active" : undefined} aria-label={`${homeStore.name} inventory, ${homeCount} of ${groupCount} group vehicles`} aria-pressed={scope === "home"} onClick={() => onChange("home")}>
        <span className="inventory-scope-switch__full">{homeStore.name} <b>{homeCount}</b></span>
        <span className="inventory-scope-switch__compact" aria-hidden="true">{homeStore.name} <b>{homeCount}</b></span>
      </button>
      <button type="button" className={scope === "group" ? "is-active" : undefined} aria-label={`All locations, ${groupCount} group vehicles`} aria-pressed={scope === "group"} onClick={() => onChange("group")}>
        <span className="inventory-scope-switch__full">All locations <b>{groupCount}</b></span>
        <span className="inventory-scope-switch__compact" aria-hidden="true">All <b>{groupCount}</b></span>
      </button>
    </div>
  );
}

function SortComposer({
  sorts,
  onChange,
}: {
  sorts: InventorySort[];
  onChange: (sorts: InventorySort[]) => void;
}) {
  const disclosure = useInventoryDisclosure("inventory-sort-composer-panel");
  const usedKeys = new Set(sorts.map((sort) => sort.key));
  const unusedKeys = (Object.keys(SORT_LABELS) as InventorySortKey[]).filter(
    (key) => !usedKeys.has(key),
  );

  const replaceSortKey = (index: number, key: InventorySortKey) => {
    onChange(sorts.map((sort, sortIndex) => (sortIndex === index ? { ...sort, key } : sort)));
  };
  const moveSort = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= sorts.length) return;
    const next = [...sorts];
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
  };
  const removeSort = (index: number) => {
    const next = sorts.filter((_, sortIndex) => sortIndex !== index);
    onChange(next.length ? next : DEFAULT_INVENTORY_SORTS.slice(0, 1));
  };

  return (
    <div
      ref={disclosure.containerRef}
      className="inventory-sort-composer"
      data-open={disclosure.open ? "true" : "false"}
    >
      <button
        ref={disclosure.triggerRef}
        type="button"
        className="inventory-sort-composer__trigger inv-btn inv-btn--secondary"
        title={inventorySortSummary(sorts)}
        aria-label={`Sort inventory. ${inventorySortSummary(sorts)}`}
        aria-expanded={disclosure.open}
        aria-controls={disclosure.panelId}
        onClick={() => disclosure.setOpen((open) => !open)}
      >
        <ListFilter size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>Sort</span>
        <em className="inv-btn__count" aria-hidden="true">{sorts.length}</em>
        <ChevronDown className="inv-btn__chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <div id={disclosure.panelId} className="inventory-sort-composer__panel" hidden={!disclosure.open}>
        <div className="inventory-sort-composer__heading">
          <div>
            <strong>Sort priority</strong>
            <span>Top rule applies first. Add up to {MAX_SORT_LEVELS}.</span>
          </div>
          {sorts.length > 1 ? (
            <button type="button" onClick={() => onChange(DEFAULT_INVENTORY_SORTS.slice(0, 1))}>
              Reset
            </button>
          ) : null}
          <button type="button" aria-label="Close sort options" onClick={() => disclosure.close(true)}><X size={18} aria-hidden="true" /></button>
        </div>
        <ol className="inventory-sort-levels">
          {sorts.map((sort, index) => (
            <li key={`${sort.key}-${index}`}>
              <span className="inventory-sort-levels__priority" aria-label={`Priority ${index + 1}`}>
                {index + 1}
              </span>
              <select
                aria-label={`Sort priority ${index + 1} field`}
                value={sort.key}
                onChange={(event) => replaceSortKey(index, event.target.value as InventorySortKey)}
              >
                {(Object.keys(SORT_LABELS) as InventorySortKey[])
                  .filter((key) => key === sort.key || !usedKeys.has(key))
                  .map((key) => (
                    <option key={key} value={key}>{SORT_LABELS[key]}</option>
                  ))}
              </select>
              <button
                type="button"
                className="inventory-sort-levels__direction"
                onClick={() => onChange(sorts.map((item, sortIndex) => sortIndex === index
                  ? { ...item, direction: item.direction === "asc" ? "desc" : "asc" }
                  : item))}
                aria-label={`${SORT_LABELS[sort.key]}: change to ${sort.direction === "asc" ? "descending" : "ascending"}`}
              >
                {sort.direction === "asc" ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}
                <span>{sort.direction === "asc" ? "Ascending" : "Descending"}</span>
              </button>
              <span className="inventory-sort-levels__reorder">
                <button type="button" onClick={() => moveSort(index, -1)} disabled={index === 0} aria-label={`Move ${SORT_LABELS[sort.key]} earlier`}>
                  <ChevronUp size={15} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => moveSort(index, 1)} disabled={index === sorts.length - 1} aria-label={`Move ${SORT_LABELS[sort.key]} later`}>
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
              </span>
              <button type="button" className="inventory-sort-levels__remove" onClick={() => removeSort(index)} aria-label={`Remove ${SORT_LABELS[sort.key]} sort`}>
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
        {sorts.length < MAX_SORT_LEVELS && unusedKeys.length ? (
          <label className="inventory-sort-composer__add">
            <Plus size={15} aria-hidden="true" />
            <span>Add another sort</span>
            <select
              value=""
              onChange={(event) => {
                if (!event.target.value) return;
                onChange([...sorts, { key: event.target.value as InventorySortKey, direction: "asc" }]);
              }}
              aria-label="Add another inventory sort"
            >
              <option value="">Choose a field</option>
              {unusedKeys.map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}

function FiltersPanel({
  id,
  filters,
  stores,
  homeStore,
  scope,
  holdValue,
  movementValue,
  onChange,
  onHoldChange,
  onMovementChange,
  onClear,
  resultCount,
  onShowResults,
}: {
  id: string;
  filters: InventoryFilters;
  stores: InventoryGroupStore[];
  homeStore: InventoryStore;
  scope: InventoryScope;
  /** Hold and movement read through the quick-view chips: one state, two controls. */
  holdValue: InventoryFilters["dealerMail"];
  movementValue: InventoryFilters["movement"];
  onChange: (filters: InventoryFilters) => void;
  onHoldChange: (value: InventoryFilters["dealerMail"]) => void;
  onMovementChange: (value: InventoryFilters["movement"]) => void;
  onClear: () => void;
  resultCount: number;
  onShowResults: () => void;
}) {
  const update = <Key extends keyof InventoryFilters>(key: Key, value: InventoryFilters[Key]) => onChange({ ...filters, [key]: value });
  return (
    <section className="inventory-filter-panel inventory-filter-panel--modern" id={id} aria-label="Inventory filters">
      <div className="inventory-filter-panel__heading">
        <span><SlidersHorizontal size={17} strokeWidth={1.8} aria-hidden="true" /> Refine vehicles</span>
      </div>
      <div className="inventory-filter-grid inventory-filter-grid--primary">
        {scope === "home" ? (
          <div className="inventory-filter-location-static" aria-label={`Home inventory: ${homeStore.name}`}>
            <span>Home inventory</span>
            <strong>{homeStore.name}</strong>
          </div>
        ) : (
          <label>
            <span>Location</span>
            <select value={filters.storeId} onChange={(event) => update("storeId", event.target.value)}>
              <option value="all">All locations</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
        )}
        <label>
          <span>Hold</span>
          <select value={holdValue} onChange={(event) => onHoldChange(event.target.value as InventoryFilters["dealerMail"])}>
            <option value="all" aria-label="Any hold status">Any status</option>
            <option value="held">Held</option>
            <option value="not-held">No current hold</option>
            <option value="unverified" aria-label="Hold status unverified">Unverified</option>
          </select>
        </label>
        <label>
          <span>Inventory decision</span>
          <select value={filters.disposition ?? "all"} onChange={event => update("disposition", event.target.value as InventoryFilters["disposition"])}>
            <option value="all">Any decision</option><option value="none" aria-label="No disposition recorded">None recorded</option>
            <option value="sold_pending">Sold pending</option><option value="delivered">Delivered</option>
            <option value="other">Other</option><option value="keep">Keep</option>
            <option value="wholesale">Wholesale</option><option value="transfer_out">Transfer out</option>
            <option value="conflict" aria-label="Conflicting records">Conflicting</option>
          </select>
        </label>
        <label>
          <span>Vehicle movement</span>
          <select value={movementValue} onChange={(event) => onMovementChange(event.target.value as InventoryFilters["movement"])}>
            <option value="all" aria-label="Any movement status">Any status</option>
            <option value="active">Being moved</option>
            <option value="overdue" aria-label="Needs movement attention">Needs attention</option>
            <option value="none" aria-label="No move in progress">No active move</option>
          </select>
        </label>
        <label>
          <span>Minimum price</span>
          <input type="number" min="0" step="500" inputMode="numeric" value={filters.minimumPrice ?? ""} onChange={(event) => update("minimumPrice", numericInputValue(event.target.value))} placeholder="$0" />
        </label>
        <label>
          <span>Maximum price</span>
          <input type="number" min="0" step="500" inputMode="numeric" value={filters.maximumPrice ?? ""} onChange={(event) => update("maximumPrice", numericInputValue(event.target.value))} placeholder="No maximum" />
        </label>
        <label>
          <span>Maximum mileage</span>
          <input type="number" min="0" step="1000" inputMode="numeric" value={filters.maximumMileage ?? ""} onChange={(event) => update("maximumMileage", numericInputValue(event.target.value))} placeholder="No maximum" />
        </label>
      </div>
      <div className="inventory-filter-panel__footer">
      <details className="inventory-filter-technical">
        <summary>Record-status filters</summary>
        <div className="inventory-filter-grid">
          <label>
            <span>Online status</span>
            <select value={filters.publicListing} onChange={(event) => update("publicListing", event.target.value as InventoryFilters["publicListing"])}>
              <option value="all">Any website status</option>
              <option value="listed">On a dealership website</option>
              <option value="not-listed">Not on a dealership website</option>
              <option value="unknown">Not verified</option>
            </select>
          </label>
          <label>
            <span>Vehicle movement signal</span>
            <select value={filters.dealerOn} onChange={(event) => update("dealerOn", event.target.value as InventoryFilters["dealerOn"])}>
              <option value="all">Any movement state</option>
              <option value="in-stock">Reported at dealership</option>
              <option value="in-transit">Reported in transit</option>
              <option value="in-production">Reported in production</option>
              <option value="not-reported">Not reported</option>
            </select>
          </label>
        </div>
      </details>
      <div className="inventory-filter-panel__actions">
        <button type="button" className="inventory-filter-clear inv-btn" onClick={onClear}>Clear all</button>
        <button type="button" className="if-srp-show-results inv-btn" onClick={onShowResults}>Show {resultCount} {resultCount === 1 ? "vehicle" : "vehicles"}</button>
      </div>
      </div>
    </section>
  );
}


export function InventoryExperience({
  homeStore,
  vehicles: allVehicles,
  groupStores,
  scope,
  onScopeChange,
  selectedVehicleId,
  onSelectedVehicleChange,
  detailState,
  onRetryDetail,
  returnLabel,
  initialQuery = "",
  queryRequestKey,
  initialFilters,
  filterRequestKey = "initial",
  searchPersistenceKey,
  initialQuickView = "all",
  initialSorts = DEFAULT_INVENTORY_SORTS,
  initialWorkspaceTab = "overview",
  issueContext,
  dispositionContext,
  pageSize = 10,
  canRequestVehicle,
  moveActionFor,
  onRequestVehicle,
  onMoveVehicle,
  onTrackMovement,
  onOpenListing,
  onOpenSourceRecord,
  savedLists,
  openSavedListsRequest,
}: InventoryExperienceProps) {
  const title = `${homeStore.name} inventory`;
  // The customer shortlist is session memory for this signed-in context only;
  // it filters the list but never an already open, still-authorized record.
  const shortlistContext = searchPersistenceKey ?? `inventory:${homeStore.id}`;
  const localShortlist = useCustomerShortlist(shortlistContext, allVehicles);
  const syncedShortlist = useSyncedCustomerLists({
    enabled: savedLists?.enabled === true,
    ownerId: savedLists?.ownerId ?? null,
    role: savedLists?.role ?? "sales",
    store: savedLists?.store ?? "Howell",
    context: shortlistContext,
    authorizedVehicles: allVehicles,
    refreshVehicles: savedLists?.refreshVehicles,
  });
  const shortlist = savedLists?.enabled === true ? syncedShortlist : localShortlist;
  const [onlyShortlisted, setOnlyShortlisted] = useWorkspaceState(searchPersistenceKey, "inventory.shortlistOnly", false);
  const vehicles = useMemo(
    () => onlyShortlisted ? allVehicles.filter((vehicle) => shortlist.isShortlisted(vehicle)) : allVehicles,
    [allVehicles, onlyShortlisted, shortlist.isShortlisted],
  );
  useWorkspaceScroll(searchPersistenceKey, "inventory");
  const [query, setQuery] = useWorkspaceState(searchPersistenceKey, `inventory.query:${queryRequestKey ?? initialQuery}`, initialQuery);
  const filterContext = `inventory-service:v1:${searchPersistenceKey || "session"}:${homeStore.id}`;
  // An Overview link starts one request with exactly its filters; the list
  // keeps them (with their chips) until they are cleared or a new link opens.
  const contextFilters = (): InventoryFilters => filterRequestKey !== "initial" && initialFilters
    ? { ...DEFAULT_INVENTORY_FILTERS, ...initialFilters }
    : { ...DEFAULT_INVENTORY_FILTERS, serviceReadiness: initialServiceFilter(filterContext) };
  const [filterState, setFilterState] = useWorkspaceState<{ context: string; requestKey?: string; value: InventoryFilters }>(searchPersistenceKey, "inventory.filters", () => ({ context: filterContext, requestKey: filterRequestKey, value: contextFilters() }));
  const fallbackFilters = useMemo(contextFilters, [filterContext, filterRequestKey]);
  const filterStateCurrent = (state: { context: string; requestKey?: string }) => state.context === filterContext && (state.requestKey ?? "initial") === filterRequestKey;
  const filters: InventoryFilters = filterStateCurrent(filterState) ? filterState.value : fallbackFilters;
  const setFilters = (next: SetStateAction<InventoryFilters>) => setFilterState(current => ({ context: filterContext, requestKey: filterRequestKey, value: typeof next === "function" ? next(filterStateCurrent(current) ? current.value : contextFilters()) : next }));
  const [sorts, setSorts] = useWorkspaceState<InventorySort[]>(searchPersistenceKey, "inventory.sorts", initialSorts);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const scanTriggerRef = useRef<HTMLButtonElement>(null);
  const [quickView, setQuickView] = useWorkspaceState<QuickView>(searchPersistenceKey, `inventory.quickView:sales-v1:${queryRequestKey ?? "initial"}`, initialQuickView);
  const [rowsPerPage, setRowsPerPage] = useWorkspaceState(searchPersistenceKey, "inventory.pageSize", () => initialRowsPerPage(pageSize));
  const [page, setPage] = useWorkspaceState(searchPersistenceKey, "inventory.page", 1);
  const [workspaceInitialTab, setWorkspaceInitialTab] = useWorkspaceState<VehicleWorkspaceTab>(searchPersistenceKey, "inventory.tab", initialWorkspaceTab);
  const filterPanelId = useId();
  const backgroundRef = useRef<HTMLDivElement>(null);
  const modalBackgroundRef = useRef<HTMLElement | null>(null);
  const captureModalBackground = useCallback((element: HTMLElement | null) => {
    // Workspace and scanner portals live under body. Isolate the entire app,
    // including navigation and the sibling shortlist, while they are open.
    modalBackgroundRef.current = element?.closest<HTMLElement>("#root") ?? element;
  }, []);
  const resultsSurfaceRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceReturnFocusRef = useRef<HTMLElement | null>(null);
  const pendingWorkspaceReturnFocusRef = useRef<{ vehicleId: string; trigger: HTMLElement | null } | null>(null);
  const [compactResults, setCompactResults] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches);
  const stores = useMemo(() => uniqueStores(homeStore, vehicles, groupStores), [groupStores, homeStore, vehicles]);
  const scopedStore = scope === "group" && filters.storeId !== "all" ? stores.find(store => store.id === filters.storeId) ?? homeStore : homeStore;
  const locationScope: InventoryScope = scope === "home" || filters.storeId !== "all" ? "home" : "group";
  const quickViewContext = useMemo(() => ({ scope: locationScope, homeStore: scopedStore }), [locationScope, scopedStore]);
  const groupVehicleCount = vehicles.length;
  const homeVehicleCount = useMemo(
    () => vehicles.filter((vehicle) => inventoryInLocationScope(vehicle, "home", homeStore)).length,
    [homeStore.id, vehicles],
  );

  const setScope = (next: InventoryScope) => {
    if (next === "home") setFilters((current) => ({ ...current, storeId: "all" }));
    onScopeChange(next);
  };
  const setSelectedVehicleId = (next: string | null) => onSelectedVehicleChange(next);
  const viewState: InventoryViewState = { quickView, filters };
  const applyViewState = (next: InventoryViewState) => {
    if (next.quickView !== quickView) setQuickView(next.quickView);
    if (next.filters !== filters) setFilters(next.filters);
  };
  const chooseQuickView = (view: QuickView) => applyViewState(view === 'new' || view === 'price'
    ? toggleSecondaryQuickView(viewState, view)
    : selectQuickView(viewState, view));
  const toggleSecondaryView = (view: Extract<QuickView, 'moving' | 'new' | 'price'>) => applyViewState(toggleSecondaryQuickView(viewState, view));
  const setSearchQuery = (nextQuery: string) => {
    // Filtering must move to the first result page in the same update. Leaving
    // this until an effect ran made an active later page look unchanged.
    setPage(1);
    setQuery(nextQuery);
  };

  useLayoutEffect(() => {
    const surface = resultsSurfaceRef.current;
    if (!surface || typeof window === "undefined") return;
    const media = typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY) : null;
    const update = () => {
      const width = surface.getBoundingClientRect().width;
      const next = Boolean(media?.matches || width > 0 && width <= CARD_SURFACE_MAX_WIDTH);
      setCompactResults(current => current === next ? current : next);
    };
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(surface);
    media?.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      media?.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const visibleVehicleTrigger = (vehicleId: string) => {
    const triggers = Array.from(
      backgroundRef.current?.querySelectorAll<HTMLElement>("button[data-inventory-vehicle-trigger]") ?? [],
    ).filter((element) =>
      element.dataset.inventoryVehicleTrigger === vehicleId &&
      element.getClientRects().length > 0,
    );
    // Several summary controls can open the same workspace. When Safari does
    // not assign focus to a pointer-clicked row action, restore to the clear
    // primary View action instead of whichever secondary cell happens to be
    // first in DOM order. A genuinely focused secondary action is preserved
    // by openVehicleWorkspace below.
    return triggers.find((element) => element.dataset.rowAction === "open-details") ?? triggers[0] ?? null;
  };

  const openVehicleWorkspace = (vehicle: InventoryVehicle, section: VehicleWorkspaceTab = "overview", opener?: HTMLElement) => {
    setWorkspaceInitialTab(section);
    // Pointer clicks in Safari can leave focus on the prior search/control.
    // A table row is not focusable: fall back to this vehicle's visible button.
    const active = document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset.inventoryVehicleTrigger === vehicle.id
      ? document.activeElement
      : null;
    workspaceReturnFocusRef.current = opener ?? active ?? visibleVehicleTrigger(vehicle.id);
    setSelectedVehicleId(vehicle.id);
  };

  const openSourceRecord: NonNullable<InventoryExperienceProps["onOpenSourceRecord"]> = (vehicle, source) => {
    if (source === "dealermail") {
      if (vehicle.dealerMail.canManageHold !== true) return;
      openVehicleWorkspace(vehicle);
      setWorkspaceInitialTab("hold");
      return;
    }
    onOpenSourceRecord?.(vehicle, source);
  };

  const searchableVehicles = useMemo(
    () => vehicles.filter(vehicle => vehicleMatchesFilters(vehicle, filters, { ignoreStore: true })),
    [filters, vehicles],
  );
  // Text matches must be independent of facets, or selecting one collapses the
  // counts for every alternative view and service status.
  const searchIndexes = useMemo(() => buildInventorySearchIndexes(vehicles), [vehicles]);
  // The search field echoes each keystroke at once; re-ranking and re-rendering
  // the result rows follows as a deferred, interruptible update so typing never
  // waits on the table.
  const deferredQuery = useDeferredValue(query);
  const searchMatches = useMemo(
    () => rankInventorySearchWithAuthorizedFallback(searchIndexes, deferredQuery),
    [deferredQuery, searchIndexes],
  );
  const queryMatchIds = useMemo(() => new Set(searchMatches.map((match) => match.vehicle.id)), [searchMatches]);
  const hasQuery = Boolean(deferredQuery.trim());
  const searchedVehicles = useMemo(
    () => vehicles.filter((vehicle) => !hasQuery || queryMatchIds.has(vehicle.id)),
    [hasQuery, queryMatchIds, vehicles],
  );
  const baseMatches = useMemo(
    () => hasQuery ? searchableVehicles.filter((vehicle) => queryMatchIds.has(vehicle.id)) : searchableVehicles,
    [hasQuery, queryMatchIds, searchableVehicles],
  );
  const scopedVehicles = useMemo(() => {
    const scoped = baseMatches.filter((vehicle) => inventoryInLocationScope(vehicle, locationScope, scopedStore) && matchesInventoryQuickView(vehicle, quickView, quickViewContext));
    return sortVehicles(scoped, sorts);
  }, [baseMatches, locationScope, scopedStore, quickView, quickViewContext, sorts]);

  const quickViewCounts = useMemo(() => {
    const scoped = searchedVehicles.filter((vehicle) => inventoryInLocationScope(vehicle, locationScope, scopedStore));
    const countFor = (view: QuickView) => scoped.filter((vehicle) => {
      const candidate = selectQuickView({ quickView, filters }, view);
      return vehicleMatchesFilters(vehicle, candidate.filters, { ignoreStore: true }) && matchesInventoryQuickView(vehicle, candidate.quickView, quickViewContext);
    }).length;
    return {
      all: countFor('all'),
      "no-hold": countFor('no-hold'), offsite: countFor('offsite'), held: countFor('held'),
      moving: countFor('moving'), new: countFor('new'), price: countFor('price'),
    };
  }, [searchedVehicles, filters, quickView, locationScope, scopedStore, quickViewContext]);

  const serviceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, needs_service: 0, in_service: 0, serviced: 0 };
    for (const vehicle of vehicles) {
      if (!inventoryInLocationScope(vehicle, locationScope, scopedStore)) continue;
      if ((hasQuery && !queryMatchIds.has(vehicle.id)) || !matchesInventoryQuickView(vehicle, quickView, quickViewContext)) continue;
      if (!vehicleMatchesFilters(vehicle, { ...filters, serviceReadiness: "all" }, { ignoreStore: true })) continue;
      counts.all += 1;
      counts[serviceWorkflowStatus(vehicle.serviceReadiness)] += 1;
    }
    return counts;
  }, [filters, hasQuery, locationScope, scopedStore, queryMatchIds, quickView, quickViewContext, vehicles]);

  const otherLocationMatches = useMemo(() => {
    if (!query.trim() || scope === "group") return 0;
    return vehicles.filter((vehicle) =>
      queryMatchIds.has(vehicle.id) && vehicleMatchesFilters(vehicle, filters, { ignoreStore: true }) &&
      matchesInventoryQuickView(vehicle, quickView, { scope: "group", homeStore }) &&
      !(inventoryInLocationScope(vehicle, locationScope, scopedStore) && matchesInventoryQuickView(vehicle, quickView, quickViewContext)),
    ).length;
  }, [filters, homeStore, locationScope, scopedStore, query, queryMatchIds, quickView, quickViewContext, scope, vehicles]);

  const totalPages = Math.max(1, Math.ceil(scopedVehicles.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * rowsPerPage;
  const pageVehicles = scopedVehicles.slice(pageStart, pageStart + rowsPerPage);
  // List-only filters must not discard an already open, still-authorized record.
  const selectedVehicle = selectedVehicleId ? allVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null : null;
  const filterCount = activeFilterCount(filters) - (filters.dealerMail === 'held' ? 1 : 0) + (["moving", "new", "price"].includes(quickView) ? 1 : 0) + (onlyShortlisted ? 1 : 0);
  const selectedServiceLabel = SERVICE_FILTERS.find(([value]) => value === filters.serviceReadiness && value !== "all")?.[1];
  const overviewViewLabel = filters.overviewView ? `${OVERVIEW_VIEW_LABELS[filters.overviewView.view]} · ${filters.overviewView.store === "all" ? "All stores" : filters.overviewView.store}` : null;
  const secondaryViewLabel = quickView === "moving" ? "Moving" : quickView === "new" ? "New today" : quickView === "price" ? "Price changed" : null;
  const canRequestSelected = selectedVehicle ? canRequestVehicle?.(selectedVehicle) ?? false : false;
  const selectedMoveAction = selectedVehicle ? moveActionFor?.(selectedVehicle) ?? null : null;

  const closeVehicleWorkspace = () => {
    if (selectedVehicleId) {
      const currentTrigger = workspaceReturnFocusRef.current;
      const currentStillVisible = Boolean(currentTrigger?.isConnected && currentTrigger.getClientRects().length > 0);
      const returnTrigger = currentStillVisible ? currentTrigger : visibleVehicleTrigger(selectedVehicleId);
      // Keep the ref current too: VehicleWorkspace owns a contained-focus
      // cleanup and should restore the same, still-visible launch control.
      workspaceReturnFocusRef.current = returnTrigger;
      pendingWorkspaceReturnFocusRef.current = {
        vehicleId: selectedVehicleId,
        trigger: returnTrigger,
      };
    }
    setSelectedVehicleId(null);
  };

  useModalBackgroundIsolation({
    active: Boolean(selectedVehicle) || scannerOpen,
    backgroundRef: modalBackgroundRef,
  });

  // Restore focus after React has removed background inertness, rather than
  // racing the close handler (especially in WebKit after a viewport resize).
  useLayoutEffect(() => {
    const pending = pendingWorkspaceReturnFocusRef.current;
    if (selectedVehicleId !== null || !pending) return;
    pendingWorkspaceReturnFocusRef.current = null;

    const restoreFocus = () => {
      const visibleTrigger = visibleVehicleTrigger(pending.vehicleId);
      const pendingVisible = Boolean(pending.trigger?.isConnected && pending.trigger.getClientRects().length > 0);
      const target = pendingVisible ? pending.trigger : visibleTrigger;
      target?.focus({ preventScroll: true });
    };

    restoreFocus();
    const frame = window.requestAnimationFrame(restoreFocus);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedVehicleId]);

  const resultKey = JSON.stringify([filters, query, quickView, onlyShortlisted, rowsPerPage, scope, sorts]);
  const previousResultKey = useRef(resultKey);
  useEffect(() => {
    if (previousResultKey.current !== resultKey) setPage(1);
    previousResultKey.current = resultKey;
  }, [resultKey, setPage]);
  useEffect(() => setWorkspaceInitialTab(initialWorkspaceTab), [initialWorkspaceTab]);
  useEffect(() => {
    try { window.sessionStorage.setItem("inventory:rows-per-page", String(rowsPerPage)); } catch { /* storage is optional */ }
  }, [rowsPerPage]);
  useEffect(() => {
    try { window.sessionStorage.setItem(filterContext, filters.serviceReadiness ?? "all"); } catch { /* storage is optional */ }
  }, [filterContext, filters.serviceReadiness]);

  const clearFilters = () => {
    setFilters({ ...DEFAULT_INVENTORY_FILTERS });
    setQuickView("all");
    setOnlyShortlisted(false);
  };
  const clearEmptyState = () => {
    setSearchQuery("");
    clearFilters();
  };
  const returnToFilterTrigger = () => window.requestAnimationFrame(() => filterTriggerRef.current?.focus({ preventScroll: true }));
  const closeFilters = () => {
    setFiltersOpen(false);
    window.requestAnimationFrame(() => {
      filterTriggerRef.current?.focus({ preventScroll: true });
      filterTriggerRef.current?.scrollIntoView?.({ block: "nearest" });
    });
  };

  return (
    <ShortlistContext.Provider value={shortlist}>
    <InventoryExpansionProvider key={`${shortlistContext}:${homeStore.id}`}>
    <section id="inventory-results-workspace" ref={captureModalBackground} data-filters-open={filtersOpen} className={`inventory-experience if-srp${selectedVehicle ? " has-workspace" : ""}`} aria-label="Inventory">
      <div className="inventory-experience__content" ref={backgroundRef}>
        <div className="if-srp-workbench">
        <div className="if-srp-heading-grid">
        <FlowPageHeader className="if-srp-header" title={<><span>Inventory</span><span className="inventory-results-count" aria-live="polite">{scopedVehicles.length} shown <span className="inventory-results-count__scope" aria-hidden="true">· {scope === "home" ? `${homeVehicleCount} of ` : ""}{groupVehicleCount} group</span></span></>} titleLabel={scope === "group" ? "All locations inventory" : title} actions={<ScopeSwitch homeStore={homeStore} scope={scope} homeCount={homeVehicleCount} groupCount={groupVehicleCount} onChange={setScope} />} />

        <div className="if-srp-searchbar" role="group" aria-label="Inventory search and location scope">
          <InventoryPredictiveSearch
            id={`${filterPanelId}-search`}
            vehicles={searchableVehicles}
            value={query}
            onChange={setSearchQuery}
            onSelectVehicle={(vehicle) => {
              if (vehicle.location.homeStore.id !== homeStore.id) setScope("group");
              openVehicleWorkspace(vehicle);
            }}
            persistenceKey={`inventory-search:v2:${searchPersistenceKey || homeStore.id}`}
            placeholder="Search stock, VIN, vehicle or equipment"
          />
      <CustomerShortlistDrawer openRequest={openSavedListsRequest} entries={shortlist.entries}
        onRemove={shortlist.remove} onClear={shortlist.clear}
        management={shortlist.management} authorizedVehicles={allVehicles} accessContext={shortlist.context}
        modalOpen={scannerOpen || Boolean(selectedVehicle) || Boolean(shortlist.management?.pendingSave)}
        onSelectVehicle={(entry, opener) => {
          const vehicle = allVehicles.find(candidate => candidate.id === entry.id || candidate.vin === entry.id);
          if (vehicle) openVehicleWorkspace(vehicle, "overview", opener);
        }} />
        </div>

        </div>
        <div className="if-srp-controls">
          <div className="if-srp-quickviews" role="group" aria-label="Inventory quick filters">
            <strong className="if-srp-control-heading">Hold</strong>
            {([
              ["no-hold", "No hold", "No hold"],
              ["all", "All", "All"],
              ["held", "Held", "Held"],
              ["offsite", locationScope === "home" ? "Offsite" : "Away from home", locationScope === "home" ? "Offsite" : "Away"],
            ] as Array<[QuickView, string, string]>).map(([value, label, compactLabel]) => (
              <button key={value} type="button" className={(value === 'held' ? filters.dealerMail === 'held' : value === 'all' ? quickView === 'all' && filters.dealerMail === 'all' : quickView === value) ? "is-active" : undefined} aria-label={`${label}: ${quickViewCounts[value]} vehicles`} aria-pressed={value === 'held' ? filters.dealerMail === 'held' : value === 'all' ? quickView === 'all' && filters.dealerMail === 'all' : quickView === value} onClick={() => chooseQuickView(value)}>
                <span className="inventory-quick-filter-label inventory-quick-filter-label--full" aria-hidden="true">{label}</span>
                <span className="inventory-quick-filter-label inventory-quick-filter-label--compact" aria-hidden="true">{compactLabel}</span>
                <span className="inventory-quick-filter-count" aria-hidden="true">{quickViewCounts[value]}</span>
              </button>
            ))}
          </div>

          {/* Service chips and, while Filters is open, the secondary views share
              one wrapper so tablet widths can flow them as one chip row. */}
          <div id={`${filterPanelId}-service`} className="if-srp-chip-rows" onKeyDown={event => { if (filtersOpen && event.key === "Escape") { event.preventDefault(); closeFilters(); } }}>
            <div className="if-srp-service-filters" role="group" aria-label="Inventory service status">
              <strong className="if-srp-service-heading" aria-hidden="true">Service</strong>
              {SERVICE_FILTERS.map(([value, label]) => <button className="if-srp-service-choice" key={value} type="button" aria-label={`${label}: ${serviceCounts[value]} vehicles`} aria-pressed={(filters.serviceReadiness ?? "all") === value} onClick={() => setFilters(current => ({ ...current, serviceReadiness: value }))}>
                <span className="service-filter-label--full">{label}</span><span className="service-filter-label--short" aria-hidden="true">{value === 'needs_service' ? 'Waiting' : label}</span><span>{serviceCounts[value]}</span>
              </button>)}
              <div className="if-srp-service-select-slot">
                <select className="if-srp-service-select" aria-label="Inventory service status" value={filters.serviceReadiness ?? "all"} onChange={event => setFilters(current => ({ ...current, serviceReadiness: event.target.value as ServiceFilter }))}>
                  {SERVICE_FILTERS.map(([value, label]) => <option key={value} value={value} aria-label={`${label}: ${serviceCounts[value]} ${serviceCounts[value] === 1 ? "vehicle" : "vehicles"}`}>{value === "needs_service" ? "Waiting" : label} · {serviceCounts[value]}</option>)}
                </select>
              </div>
            </div>
            {filtersOpen ? <div className="if-srp-secondary-views" role="group" aria-label="More inventory views">
              {([["moving", "Being moved"], ["new", "New today"], ["price", "Price changed"]] as Array<[Extract<QuickView, 'moving' | 'new' | 'price'>, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${label}: ${quickViewCounts[value]} vehicles`}
                  aria-pressed={value === 'moving' ? filters.movement === 'active' : quickView === value}
                  onClick={() => toggleSecondaryView(value)}
                >
                  <span aria-hidden="true">{label}</span>
                  <span aria-hidden="true">{quickViewCounts[value]}</span>
                </button>
              ))}
            </div> : null}
          </div>

          <div className="if-srp-tools">
            <div className="inventory-toolbar__left">
              <button ref={filterTriggerRef} type="button" className={`inventory-filter-button inv-btn inv-btn--secondary${filtersOpen || filterCount > 0 ? " is-active" : ""}`} aria-label={`Filters${filterCount > 0 ? ` ${filterCount}` : ""}`} title="Filters" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls={`${filterPanelId} ${filterPanelId}-service`}>
                <Filter size={16} strokeWidth={1.8} aria-hidden="true" /><span className="inventory-tool-label">Filters</span>{filterCount > 0 ? <span className="inv-btn__count">{filterCount}</span> : null}
              </button>
            </div>

            <div className="inventory-toolbar__right">
              <SortComposer sorts={sorts} onChange={setSorts} />
            </div>
          {shortlist.count > 0 || onlyShortlisted ? <button type="button" className="inventory-shortlist-filter" aria-label={`Shortlist (${shortlist.count}) — Saved only`} title="Show saved vehicles only" aria-pressed={onlyShortlisted} onClick={() => setOnlyShortlisted(!onlyShortlisted)}>
            <Heart aria-hidden="true" /><span className="inventory-tool-label">Saved only</span><span aria-hidden="true">{shortlist.count}</span>
          </button> : null}
          </div>
          <InventoryExpansionControl className="inv-btn inv-btn--secondary inventory-expansion-control" />
          <span className="inventory-scan-entry"><button type="button" className="button button-secondary" aria-label="Scan vehicle" title="Scan vehicle" ref={scanTriggerRef} onClick={() => setScannerOpen(true)}><ScanLine size={18} aria-hidden="true" /><span className="inventory-tool-label">Scan</span></button></span>
        </div>
        </div>

        {quickView === "no-hold" ? <p className="inventory-view-context" role="status">{locationScope === "home" ? `Reported at ${scopedStore.name}` : "Reported at a dealership"} · No hold in the published snapshot. Confirm availability.</p> : quickView === "offsite" ? <p className="inventory-view-context" role="status">{locationScope === "home" ? `${scopedStore.name} inventory reported elsewhere` : "Vehicles reported away from their home store"}. Unknown or conflicting locations remain in All.</p> : null}

        {!filtersOpen && filterCount > 0 && (activeFilterCount(filters) > 0 || secondaryViewLabel) ? <div className="if-srp-active-filters" role="group" aria-label="Active inventory filters">
          {selectedServiceLabel ? <button type="button" aria-label={`Clear service filter: ${selectedServiceLabel}`} onClick={() => { setFilters(current => ({ ...current, serviceReadiness: "all" })); returnToFilterTrigger(); }}>Service: {selectedServiceLabel}<X size={14} aria-hidden="true" /></button> : null}
          {overviewViewLabel ? <button type="button" aria-label={`Clear Overview view: ${overviewViewLabel}`} onClick={() => { setFilters(current => ({ ...current, overviewView: undefined })); returnToFilterTrigger(); }}>View: {overviewViewLabel}<X size={14} aria-hidden="true" /></button> : null}
          {filters.vins ? <button type="button" aria-label={`Clear selected vehicles: ${filters.vins.length}`} onClick={() => { setFilters(current => ({ ...current, vins: undefined })); returnToFilterTrigger(); }}>Vehicles: {filters.vins.length} selected<X size={14} aria-hidden="true" /></button> : null}
          {secondaryViewLabel ? <button type="button" aria-label={`Clear view filter: ${secondaryViewLabel}`} onClick={() => { setQuickView("all"); returnToFilterTrigger(); }}>{secondaryViewLabel}<X size={14} aria-hidden="true" /></button> : null}
          {filters.minimumPrice != null ? <button type="button" aria-label={`Clear minimum price filter: ${formatMoney(filters.minimumPrice)}`} onClick={() => { setFilters(current => ({ ...current, minimumPrice: undefined })); returnToFilterTrigger(); }}>From {formatMoney(filters.minimumPrice)}<X size={14} aria-hidden="true" /></button> : null}
          {filters.maximumPrice != null ? <button type="button" aria-label={`Clear maximum price filter: ${formatMoney(filters.maximumPrice)}`} onClick={() => { setFilters(current => ({ ...current, maximumPrice: undefined })); returnToFilterTrigger(); }}>Up to {formatMoney(filters.maximumPrice)}<X size={14} aria-hidden="true" /></button> : null}
          {filters.maximumMileage != null ? <button type="button" aria-label={`Clear maximum mileage filter: ${filters.maximumMileage.toLocaleString('en-US')} mi`} onClick={() => { setFilters(current => ({ ...current, maximumMileage: undefined })); returnToFilterTrigger(); }}>Up to {filters.maximumMileage.toLocaleString('en-US')} mi<X size={14} aria-hidden="true" /></button> : null}
          <button type="button" className="if-srp-clear-filters" onClick={() => { clearFilters(); returnToFilterTrigger(); }}>Clear {filterCount} {filterCount === 1 ? "filter" : "filters"}</button>
        </div> : null}

        <div id={filterPanelId} hidden={!filtersOpen} onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); closeFilters(); } }}>
        {filtersOpen ? <>
          <FiltersPanel id={`${filterPanelId}-details`} filters={filters} stores={stores} homeStore={homeStore} scope={scope}
            holdValue={filterPanelHoldValue(viewState)} movementValue={filterPanelMovementValue(viewState)}
            onChange={setFilters} onHoldChange={value => applyViewState(selectHoldFilter(viewState, value))}
            onMovementChange={value => applyViewState(selectMovementFilter(viewState, value))} onClear={clearFilters}
            resultCount={scopedVehicles.length} onShowResults={closeFilters} />
        </> : null}
        </div>

        <div className="inventory-results-surface" ref={resultsSurfaceRef}>
          {pageVehicles.length ? (
            compactResults ? <InventoryMobileList
              vehicles={pageVehicles}
              selectedVehicleId={selectedVehicleId}
              onSelectVehicle={openVehicleWorkspace}
              onOpenSourceRecord={openSourceRecord}
              canRequestVehicle={canRequestVehicle}
              moveActionFor={moveActionFor}
              onRequestVehicle={onRequestVehicle}
              onMoveVehicle={onMoveVehicle}
              onTrackMovement={onTrackMovement}
              onOpenListing={onOpenListing}
              viewerStore={homeStore.name}
            /> :
              <InventoryTable
                vehicles={pageVehicles}
                selectedVehicleId={selectedVehicleId}
                sorts={sorts}
                onSortChange={setSorts}
                onSelectVehicle={openVehicleWorkspace}
                canRequestVehicle={canRequestVehicle}
                moveActionFor={moveActionFor}
                onRequestVehicle={onRequestVehicle}
                onMoveVehicle={onMoveVehicle}
                onTrackMovement={onTrackMovement}
                onOpenListing={onOpenListing}
                onOpenSourceRecord={openSourceRecord}
                viewerStore={homeStore.name}
              />
          ) : (
            <div className="inventory-empty-results">
              <Search size={28} strokeWidth={1.75} aria-hidden="true" />
              <h2>No matching vehicles</h2>
              <p>{quickView === "no-hold" ? "No vehicles match both the location and recorded hold evidence. Check All to include held vehicles and unverified locations." : "Clear a filter or look across all locations."}</p>
              <div>
                <button type="button" className="inventory-button inv-btn inv-btn--secondary" onClick={query.trim() ? clearEmptyState : clearFilters}>{emptyFilterResetLabel({ query, filtersActive: filterCount > 0 })}</button>
                {scope === "home" ? <button type="button" className="inventory-button inventory-button--primary inv-btn inv-btn--primary" onClick={() => setScope("group")}>{WORKFLOW_RESET_LABELS.viewAllLocations}</button> : null}
              </div>
            </div>
          )}
        </div>

        {otherLocationMatches > 0 ? (
          <button type="button" className="inventory-other-location-match" onClick={() => setScope("group")}>
            <span><strong>{otherLocationMatches}</strong> additional {otherLocationMatches === 1 ? "vehicle" : "vehicles"} match across all locations</span>
            <span>View all locations <ChevronRight size={17} aria-hidden="true" /></span>
          </button>
        ) : null}

        {scopedVehicles.length > 0 ? (
          <nav className="inventory-pagination inventory-pagination--modern" aria-label="Inventory pages">
            <span>Showing {pageStart + 1}–{Math.min(pageStart + pageVehicles.length, scopedVehicles.length)} of {scopedVehicles.length}</span>
            <label className="inventory-page-size">
              <span>Rows</span>
              <select value={rowsPerPage} onChange={(event) => setRowsPerPage(normalizedPageSize(Number(event.target.value)))} aria-label="Rows per page">
                {PAGE_SIZE_OPTIONS.map((size) => <option value={size} key={size}>{size}</option>)}
              </select>
            </label>
            <div>
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1} aria-label="Previous inventory page"><ChevronLeft size={18} aria-hidden="true" /></button>
              <span>Page {safePage} of {totalPages}</span>
              <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages} aria-label="Next inventory page"><ChevronRight size={18} aria-hidden="true" /></button>
            </div>
          </nav>
        ) : null}
      </div>

      {scannerOpen ? <ScanVehicleDialog key={searchPersistenceKey ?? homeStore.id} vehicles={allVehicles} returnFocusRef={scanTriggerRef}
        onClose={() => setScannerOpen(false)} onFind={vehicle => {
          setScope("group"); setOnlyShortlisted(false); setFilters({ ...DEFAULT_INVENTORY_FILTERS }); setQuickView("all"); setPage(1);
          setQuery(vehicle.vin); setScannerOpen(false);
          window.requestAnimationFrame(() => { resultsSurfaceRef.current?.scrollIntoView({ block: "start", behavior: "instant" }); });
        }} /> : null}
      {selectedVehicle ? (
        <VehicleWorkspace
          vehicle={selectedVehicle}
          issueContext={issueContext}
          dispositionContext={dispositionContext}
          detailState={detailState}
          returnLabel={returnLabel}
          onRetryDetail={onRetryDetail}
          initialTab={workspaceInitialTab}
          homeStore={homeStore}
          canRequestVehicle={canRequestSelected}
          moveAction={selectedMoveAction}
          returnFocusRef={workspaceReturnFocusRef}
          onClose={closeVehicleWorkspace}
          onRequestVehicle={onRequestVehicle}
          onMoveVehicle={onMoveVehicle}
          onTrackMovement={onTrackMovement}
          onOpenListing={onOpenListing}
        />
      ) : null}
    </section>
    {shortlist.management?.pendingSave ? <SaveVehicleDialog key={`${shortlist.context}:${shortlist.management.pendingSave.vin}`} management={shortlist.management} /> : null}
    </InventoryExpansionProvider>
    </ShortlistContext.Provider>
  );
}
