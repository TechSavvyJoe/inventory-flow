import { useWorkspaceState, useWorkspaceScroll } from "../../lib/workspace-memory";
import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Filter,
  ListFilter,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { InventoryPredictiveSearch } from "./InventoryPredictiveSearch";
import { serviceWorkflowStatus } from "../../lib/service-readiness";
import { useModalBackgroundIsolation } from "../../lib/useModalBackgroundIsolation";
import { InventoryMobileList, InventoryTable, inventorySortSummary } from "./InventoryTable";
import { VehicleWorkspace } from "./VehicleWorkspace";
import { CustomerShortlistDrawer } from "./CustomerShortlistDrawer";
import { ShortlistContext, useCustomerShortlist } from "./useCustomerShortlist";
import { useInventoryDisclosure } from "./useInventoryDisclosure";
import { buildInventorySearchIndexes, rankInventorySearchWithAuthorizedFallback } from "./inventory-search";
import {
  activeFilterCount,
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
import "./inventory.css";
import "./inventory-modern.css";
import "./InventoryServiceFilter.css";

const PAGE_SIZE_OPTIONS = [10, 15, 20, 25, 50, 100] as const;
const MAX_SORT_LEVELS = 5;
type QuickView = "all" | "no-hold" | "held" | "moving" | "new" | "price";
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
  onChange,
  onClear,
}: {
  id: string;
  filters: InventoryFilters;
  stores: InventoryGroupStore[];
  homeStore: InventoryStore;
  scope: InventoryScope;
  onChange: (filters: InventoryFilters) => void;
  onClear: () => void;
}) {
  const update = <Key extends keyof InventoryFilters>(key: Key, value: InventoryFilters[Key]) => onChange({ ...filters, [key]: value });
  return (
    <section className="inventory-filter-panel inventory-filter-panel--modern" id={id} aria-label="Inventory filters">
      <div className="inventory-filter-panel__heading">
        <span><SlidersHorizontal size={17} strokeWidth={1.8} aria-hidden="true" /> Refine vehicles</span>
        <button type="button" onClick={onClear}>Clear all</button>
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
          <select value={filters.dealerMail} onChange={(event) => update("dealerMail", event.target.value as InventoryFilters["dealerMail"])}>
            <option value="all">Any hold status</option>
            <option value="held">Held</option>
            <option value="not-held">No current hold</option>
            <option value="unverified">Hold status unverified</option>
          </select>
        </label>
        <label>
          <span>Vehicle movement</span>
          <select value={filters.movement} onChange={(event) => update("movement", event.target.value as InventoryFilters["movement"])}>
            <option value="all">Any movement status</option>
            <option value="active">Being moved</option>
            <option value="overdue">Needs movement attention</option>
            <option value="none">No move in progress</option>
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
    </section>
  );
}

function matchesQuickView(vehicle: InventoryVehicle, quickView: QuickView): boolean {
  if (quickView === "no-hold") return vehicle.dealerMail.dataState === "current" && vehicle.dealerMail.hasActiveHold === false;
  if (quickView === "held") return vehicle.dealerMail.dataState === "current" && vehicle.dealerMail.hasActiveHold === true;
  if (quickView === "moving") return Boolean(vehicle.movement && (vehicle.movement.state || vehicle.movement.requestId));
  const change = (vehicle.changeSummary || "").toLowerCase();
  if (quickView === "new") return change.includes("new arrival") || change.includes("new today");
  if (quickView === "price") return change.includes("price");
  return true;
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
  searchPersistenceKey,
  initialSorts = DEFAULT_INVENTORY_SORTS,
  initialWorkspaceTab = "overview",
  pageSize = 10,
  canRequestVehicle,
  moveActionFor,
  onRequestVehicle,
  onMoveVehicle,
  onTrackMovement,
  onOpenListing,
  onOpenSourceRecord,
}: InventoryExperienceProps) {
  const title = `${homeStore.name} inventory`;
  // The customer shortlist is session memory for this signed-in context only;
  // it filters the list but never an already open, still-authorized record.
  const shortlist = useCustomerShortlist(searchPersistenceKey ?? `inventory:${homeStore.id}`, allVehicles);
  const [onlyShortlisted, setOnlyShortlisted] = useWorkspaceState(searchPersistenceKey, "inventory.shortlistOnly", false);
  const vehicles = useMemo(
    () => onlyShortlisted ? allVehicles.filter((vehicle) => shortlist.isShortlisted(vehicle)) : allVehicles,
    [allVehicles, onlyShortlisted, shortlist.isShortlisted],
  );
  useWorkspaceScroll(searchPersistenceKey, "inventory");
  const [query, setQuery] = useWorkspaceState(searchPersistenceKey, `inventory.query:${queryRequestKey ?? initialQuery}`, initialQuery);
  const filterContext = `inventory-service:v1:${searchPersistenceKey || "session"}:${homeStore.id}`;
  const contextFilters = () => ({ ...DEFAULT_INVENTORY_FILTERS, serviceReadiness: initialServiceFilter(filterContext) });
  const [filterState, setFilterState] = useWorkspaceState<{ context: string; value: InventoryFilters }>(searchPersistenceKey, "inventory.filters", () => ({ context: filterContext, value: contextFilters() }));
  const fallbackFilters = useMemo(contextFilters, [filterContext]);
  const filters: InventoryFilters = filterState.context === filterContext ? filterState.value : fallbackFilters;
  const setFilters = (next: SetStateAction<InventoryFilters>) => setFilterState(current => ({ context: filterContext, value: typeof next === "function" ? next(current.context === filterContext ? current.value : contextFilters()) : next }));
  const [sorts, setSorts] = useWorkspaceState<InventorySort[]>(searchPersistenceKey, "inventory.sorts", initialSorts);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [quickView, setQuickView] = useWorkspaceState<QuickView>(searchPersistenceKey, "inventory.quickView", "all");
  const [rowsPerPage, setRowsPerPage] = useWorkspaceState(searchPersistenceKey, "inventory.pageSize", () => initialRowsPerPage(pageSize));
  const [page, setPage] = useWorkspaceState(searchPersistenceKey, "inventory.page", 1);
  const [workspaceInitialTab, setWorkspaceInitialTab] = useWorkspaceState<VehicleWorkspaceTab>(searchPersistenceKey, "inventory.tab", initialWorkspaceTab);
  const filterPanelId = useId();
  const backgroundRef = useRef<HTMLDivElement>(null);
  const resultsSurfaceRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceReturnFocusRef = useRef<HTMLElement | null>(null);
  const pendingWorkspaceReturnFocusRef = useRef<{ vehicleId: string; trigger: HTMLElement | null } | null>(null);
  const [compactResults, setCompactResults] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches);
  const stores = useMemo(() => uniqueStores(homeStore, vehicles, groupStores), [groupStores, homeStore, vehicles]);
  const groupVehicleCount = vehicles.length;
  const homeVehicleCount = useMemo(
    () => vehicles.filter((vehicle) => vehicle.location.homeStore.id === homeStore.id).length,
    [homeStore.id, vehicles],
  );

  const setScope = (next: InventoryScope) => {
    if (next === "home") setFilters((current) => ({ ...current, storeId: "all" }));
    onScopeChange(next);
  };
  const setSelectedVehicleId = (next: string | null) => onSelectedVehicleChange(next);
  const setSearchQuery = (nextQuery: string) => {
    // Filtering must move to the first result page in the same update. Leaving
    // this until an effect ran made an active later page look unchanged.
    setPage(1);
    setQuery(nextQuery);
  };

  useLayoutEffect(() => {
    const surface = resultsSurfaceRef.current;
    if (!surface || typeof window === "undefined") return;
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 760px)") : null;
    const update = () => {
      const width = surface.getBoundingClientRect().width;
      const next = Boolean(media?.matches || width > 0 && width <= 1000);
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

  const openVehicleWorkspace = (vehicle: InventoryVehicle, section: VehicleWorkspaceTab = "overview") => {
    setWorkspaceInitialTab(section);
    // Pointer clicks in Safari can leave focus on the prior search/control.
    // A table row is not focusable: fall back to this vehicle's visible button.
    const active = document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset.inventoryVehicleTrigger === vehicle.id
      ? document.activeElement
      : null;
    workspaceReturnFocusRef.current = active ?? visibleVehicleTrigger(vehicle.id);
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
    () => vehicles.filter(vehicle => vehicleMatchesFilters(vehicle, filters, { ignoreStore: true }) && matchesQuickView(vehicle, quickView)),
    [filters, quickView, vehicles],
  );
  const searchIndexes = useMemo(() => buildInventorySearchIndexes(searchableVehicles), [searchableVehicles]);
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
  const baseMatches = useMemo(
    () => vehicles.filter((vehicle) =>
      vehicleMatchesFilters(vehicle, filters) && (!hasQuery || queryMatchIds.has(vehicle.id)),
    ),
    [filters, hasQuery, queryMatchIds, vehicles],
  );
  const scopedVehicles = useMemo(() => {
    const scoped = baseMatches.filter((vehicle) => (scope === "group" || vehicle.location.homeStore.id === homeStore.id) && matchesQuickView(vehicle, quickView));
    return sortVehicles(scoped, sorts);
  }, [baseMatches, homeStore.id, quickView, scope, sorts]);

  const quickViewCounts = useMemo(() => {
    const scoped = baseMatches.filter((vehicle) => scope === "group" || vehicle.location.homeStore.id === homeStore.id);
    return {
      all: scoped.length,
      "no-hold": scoped.filter((vehicle) => matchesQuickView(vehicle, "no-hold")).length,
      held: scoped.filter((vehicle) => matchesQuickView(vehicle, "held")).length,
      moving: scoped.filter((vehicle) => matchesQuickView(vehicle, "moving")).length,
      new: scoped.filter((vehicle) => matchesQuickView(vehicle, "new")).length,
      price: scoped.filter((vehicle) => matchesQuickView(vehicle, "price")).length,
    };
  }, [baseMatches, homeStore.id, scope]);

  const serviceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, needs_service: 0, in_service: 0, serviced: 0 };
    for (const vehicle of vehicles) {
      if (scope !== "group" && vehicle.location.homeStore.id !== homeStore.id) continue;
      if ((hasQuery && !queryMatchIds.has(vehicle.id)) || !matchesQuickView(vehicle, quickView)) continue;
      if (!vehicleMatchesFilters(vehicle, { ...filters, serviceReadiness: "all" })) continue;
      counts.all += 1;
      counts[serviceWorkflowStatus(vehicle.serviceReadiness)] += 1;
    }
    return counts;
  }, [filters, hasQuery, homeStore.id, queryMatchIds, quickView, scope, vehicles]);

  const otherLocationMatches = useMemo(() => {
    if (!query.trim() || scope === "group") return 0;
    return vehicles.filter((vehicle) => vehicle.location.homeStore.id !== homeStore.id && queryMatchIds.has(vehicle.id)).length;
  }, [homeStore.id, query, queryMatchIds, scope, vehicles]);

  const totalPages = Math.max(1, Math.ceil(scopedVehicles.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * rowsPerPage;
  const pageVehicles = scopedVehicles.slice(pageStart, pageStart + rowsPerPage);
  // List-only filters must not discard an already open, still-authorized record.
  const selectedVehicle = selectedVehicleId ? allVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null : null;
  const filterCount = activeFilterCount(filters) + (quickView === "all" ? 0 : 1);
  const selectedServiceLabel = SERVICE_FILTERS.find(([value]) => value === filters.serviceReadiness && value !== "all")?.[1];
  const secondaryViewLabel = quickView === "no-hold" ? "No current hold" : quickView === "new" ? "New today" : quickView === "price" ? "Price changed" : null;
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
    active: Boolean(selectedVehicle),
    backgroundRef,
  });

  // A vehicle selection can be committed inside a view transition. Restore
  // focus only after that commit has removed background inertness, rather than
  // racing the transition from the close handler (especially noticeable in
  // WebKit after a viewport resize).
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

  const resultKey = JSON.stringify([filters, query, quickView, rowsPerPage, scope, sorts]);
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
    <section id="inventory-results-workspace" data-filters-open={filtersOpen} className={`inventory-experience if-srp${selectedVehicle ? " has-workspace" : ""}`} aria-label="Inventory">
      <div className="inventory-experience__content" ref={backgroundRef}>
        <div className="if-srp-heading-grid">
        <header className="if-srp-header">
          <div>
            <h1 aria-label={scope === "group" ? "All locations inventory" : title}>Inventory</h1>
          </div>
          <ScopeSwitch homeStore={homeStore} scope={scope} homeCount={homeVehicleCount} groupCount={groupVehicleCount} onChange={setScope} />
        </header>

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
            placeholder="Search stock, VIN, vehicle, packages, or equipment…"
          />
        </div>

        </div>
        <div className="if-srp-controls">
          <div className="if-srp-quickviews" role="group" aria-label="Inventory quick filters">
            {([
              ["all", "All", "All"],
              ["held", "Held", "Held"],
              ["moving", "Being moved", "Moving"],
            ] as Array<[QuickView, string, string]>).map(([value, label, compactLabel]) => (
              <button key={value} type="button" className={quickView === value ? "is-active" : undefined} aria-label={`${label}: ${quickViewCounts[value]} vehicles`} aria-pressed={quickView === value} onClick={() => setQuickView(value)}>
                <span className="inventory-quick-filter-label inventory-quick-filter-label--full" aria-hidden="true">{label}</span>
                <span className="inventory-quick-filter-label inventory-quick-filter-label--compact" aria-hidden="true">{compactLabel}</span>
                <span className="inventory-quick-filter-count" aria-hidden="true">{quickViewCounts[value]}</span>
              </button>
            ))}
          </div>

          <div id={`${filterPanelId}-service`} className="if-srp-service-filters" role="group" aria-label="Inventory service status" onKeyDown={event => { if (filtersOpen && event.key === "Escape") { event.preventDefault(); closeFilters(); } }}>
            <strong className="if-srp-service-heading">Service status</strong>
            {SERVICE_FILTERS.map(([value, label]) => <button key={value} type="button" aria-label={`${label}: ${serviceCounts[value]} vehicles`} aria-pressed={(filters.serviceReadiness ?? "all") === value} onClick={() => setFilters(current => ({ ...current, serviceReadiness: value }))}>
              <span className="service-filter-label--full">{label}</span><span className="service-filter-label--short" aria-hidden="true">{value === 'needs_service' ? 'Waiting' : label}</span><span>{serviceCounts[value]}</span>
            </button>)}
          </div>

          <div className="if-srp-tools">
            {shortlist.count > 0 || onlyShortlisted ? <button type="button" className="button button-secondary"
              aria-pressed={onlyShortlisted} onClick={() => setOnlyShortlisted(!onlyShortlisted)}>
              Shortlist ({shortlist.count})
            </button> : null}
            <div className="inventory-toolbar__left">
              <button ref={filterTriggerRef} type="button" className={`inventory-filter-button inv-btn inv-btn--secondary${filtersOpen ? " is-active" : ""}`} onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls={`${filterPanelId} ${filterPanelId}-service`}>
                <Filter size={16} strokeWidth={1.8} aria-hidden="true" /> Filters {filterCount > 0 ? <span className="inv-btn__count">{filterCount}</span> : null}
              </button>
              <strong className="inventory-results-count" aria-live="polite">
                {scopedVehicles.length} shown · {scope === "home" ? `${homeVehicleCount} of ` : ""}{groupVehicleCount} group
              </strong>
            </div>

            <div className="inventory-toolbar__right">
              <SortComposer sorts={sorts} onChange={setSorts} />
            </div>
          </div>
        </div>

        {!filtersOpen && filterCount > 0 ? <div className="if-srp-active-filters" role="group" aria-label="Active inventory filters">
          {selectedServiceLabel ? <button type="button" aria-label={`Clear service filter: ${selectedServiceLabel}`} onClick={() => { setFilters(current => ({ ...current, serviceReadiness: "all" })); returnToFilterTrigger(); }}>Service: {selectedServiceLabel}<X size={14} aria-hidden="true" /></button> : null}
          {secondaryViewLabel ? <button type="button" aria-label={`Clear view filter: ${secondaryViewLabel}`} onClick={() => { setQuickView("all"); returnToFilterTrigger(); }}>{secondaryViewLabel}<X size={14} aria-hidden="true" /></button> : null}
          <button type="button" className="if-srp-clear-filters" onClick={() => { clearFilters(); returnToFilterTrigger(); }}>Clear {filterCount} {filterCount === 1 ? "filter" : "filters"}</button>
        </div> : null}

        <div id={filterPanelId} hidden={!filtersOpen} onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); closeFilters(); } }}>
        {filtersOpen ? <>
          <div className="if-srp-secondary-views" role="group" aria-label="More inventory views">
            {([["no-hold", "No current hold"], ["new", "New today"], ["price", "Price changed"]] as Array<[QuickView, string]>).map(([value, label]) => <button key={value} type="button" aria-pressed={quickView === value} onClick={() => setQuickView(quickView === value ? "all" : value)}>{label} <span>{quickViewCounts[value]}</span></button>)}
          </div>
          <FiltersPanel id={`${filterPanelId}-details`} filters={filters} stores={stores} homeStore={homeStore} scope={scope} onChange={setFilters} onClear={clearFilters} />
          <button type="button" className="if-srp-show-results inv-btn" onClick={closeFilters}>Show {scopedVehicles.length} {scopedVehicles.length === 1 ? "vehicle" : "vehicles"}</button>
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
              />
          ) : (
            <div className="inventory-empty-results">
              <Search size={28} strokeWidth={1.75} aria-hidden="true" />
              <h2>No matching vehicles</h2>
              <p>Clear a filter or look across all locations.</p>
              <div>
                <button type="button" className="inventory-button inv-btn inv-btn--secondary" onClick={query.trim() ? clearEmptyState : clearFilters}>{query.trim() ? filterCount > 0 ? "Clear search and filters" : "Clear search" : "Clear filters"}</button>
                {scope === "home" ? <button type="button" className="inventory-button inventory-button--primary inv-btn inv-btn--primary" onClick={() => setScope("group")}>View all locations</button> : null}
              </div>
            </div>
          )}
        </div>

        {otherLocationMatches > 0 ? (
          <button type="button" className="inventory-other-location-match" onClick={() => setScope("group")}>
            <span><strong>{otherLocationMatches}</strong> additional {otherLocationMatches === 1 ? "vehicle" : "vehicles"} match at other locations</span>
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

      <CustomerShortlistDrawer entries={shortlist.entries}
        onRemove={shortlist.remove} onClear={shortlist.clear}
        onSelectVehicle={(vehicle) => setSelectedVehicleId(vehicle.id)} />
      {selectedVehicle ? (
        <VehicleWorkspace
          vehicle={selectedVehicle}
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
    </ShortlistContext.Provider>
  );
}
