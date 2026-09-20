import { useState, useCallback, useMemo, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  InventoryExperienceProps,
  InventoryScope,
  InventorySort,
  InventoryVehicle,
} from "./types";
import { InventoryDecisionRail } from "./InventoryDecisionRail";
import { InventoryPredictiveSearch } from "./InventoryPredictiveSearch";
import { InventoryTableV2 } from "./InventoryTableV2";
import { VehicleWorkspaceV2 } from "./VehicleWorkspaceV2";
import {
  sortVehicles,
  vehicleMatchesQuery,
} from "./inventory-utils";
import { useCustomerShortlist } from "./useCustomerShortlist";
import { CustomerShortlistDrawer } from "./CustomerShortlistDrawer";
import "./InventoryExperienceV2.css";
import "./InventoryTableV2.css";

export type QuickView = "all" | "no-hold" | "held" | "moving" | "new" | "price" | "shortlisted";

function matchesQuickView(vehicle: InventoryVehicle, quickView: QuickView): boolean {
  if (quickView === "no-hold") return vehicle.dealerMail.dataState === "current" && vehicle.dealerMail.hasActiveHold === false;
  if (quickView === "held") return vehicle.dealerMail.dataState === "current" && vehicle.dealerMail.hasActiveHold === true;
  if (quickView === "moving") return Boolean(vehicle.movement && (vehicle.movement.state || vehicle.movement.requestId));
  const change = (vehicle.changeSummary || "").toLowerCase();
  if (quickView === "new") return change.includes("new arrival") || change.includes("new today");
  if (quickView === "price") return change.includes("price");
  return true;
}

const DEFAULT_SORTS: InventorySort[] = [
  { key: "vehicle", direction: "asc" },
];

/**
 * V2 Experience Container for Inventory Flow V2.
 * Connects the High-Density Table V2 with the VDP Cockpit and Framer Motion transitions.
 */
export function InventoryExperienceV2(props: InventoryExperienceProps) {
  const {
    homeStore,
    vehicles,
    metrics,
    groupStores = [],
    title = `${homeStore.name} Inventory`,
    initialScope = "home",
    scope: controlledScope,
    initialQuery = "",
    searchPersistenceKey = "inventory:search",
    selectedVehicleId: controlledVehicleId,
    defaultSelectedVehicleId,
    onSelectedVehicleChange,
    pageSize = 25,
    initialWorkspaceTab = "overview",
    onScopeChange,
    onGroupStoreSelect,
    onViewVehicle,
    onRequestVehicle,
    onTrackMovement,
    onOpenListing,
    onOpenSourceRecord,
    onViewStateChange,
    canRequestVehicle,
    className = "",
    "aria-label": ariaLabel = "Inventory V2",
  } = props;

  // Scope state
  const isScopeControlled = controlledScope !== undefined;
  const [internalScope, setInternalScope] = useState<InventoryScope>(initialScope);
  const activeScope = isScopeControlled ? controlledScope : internalScope;

  const handleScopeChange = useCallback(
    (newScope: InventoryScope) => {
      if (!isScopeControlled) setInternalScope(newScope);
      onScopeChange?.(newScope);
    },
    [isScopeControlled, onScopeChange],
  );

  // Search query & Quick view
  const [query, setQuery] = useState(initialQuery);
  const [quickView, setQuickView] = useState<QuickView>("all");
  const [sorts, setSorts] = useState<InventorySort[]>(DEFAULT_SORTS);
  const [page, setPage] = useState(1);
  const shortlist = useCustomerShortlist();

  // Vehicle selection state
  const isSelectedControlled = controlledVehicleId !== undefined;
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    defaultSelectedVehicleId ?? null,
  );
  const activeSelectedId = isSelectedControlled
    ? controlledVehicleId
    : internalSelectedId;

  const handleSelectVehicleId = useCallback(
    (id: string | null) => {
      if (!isSelectedControlled) setInternalSelectedId(id);
      onSelectedVehicleChange?.(id);
    },
    [isSelectedControlled, onSelectedVehicleChange],
  );

  const handleSelectVehicle = useCallback(
    (vehicle: InventoryVehicle) => {
      handleSelectVehicleId(vehicle.id);
    },
    [handleSelectVehicleId],
  );

  const handleCloseWorkspace = useCallback(() => {
    handleSelectVehicleId(null);
  }, [handleSelectVehicleId]);

  // Selected vehicle lookup
  const selectedVehicle = useMemo(() => {
    if (!activeSelectedId) return null;
    return (
      vehicles.find(
        (v) => v.id === activeSelectedId || v.vin === activeSelectedId,
      ) ?? null
    );
  }, [activeSelectedId, vehicles]);

  // Filter vehicles by scope, search query, and quick view
  const scopedVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      // Scope check
      if (activeScope === "home" && v.location.homeStore.id !== homeStore.id) {
        return false;
      }
      // Query check
      if (query.trim() && !vehicleMatchesQuery(v, query)) {
        return false;
      }
      // Shortlist check
      if (quickView === "shortlisted") {
        return shortlist.isShortlisted(v);
      }
      // Quick view check
      if (quickView !== "all" && !matchesQuickView(v, quickView)) {
        return false;
      }
      return true;
    });
  }, [vehicles, activeScope, homeStore.id, query, quickView, shortlist.ids]);

  // Sorted vehicles
  const sortedVehicles = useMemo(() => {
    return sortVehicles(scopedVehicles, sorts);
  }, [scopedVehicles, sorts]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedVehicles.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pageVehicles = useMemo(() => {
    return sortedVehicles.slice(startIndex, startIndex + pageSize);
  }, [sortedVehicles, startIndex, pageSize]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [activeScope, query, quickView, sorts]);

  const canRequestSelected =
    typeof canRequestVehicle === "function"
      ? selectedVehicle
        ? canRequestVehicle(selectedVehicle)
        : false
      : (canRequestVehicle ?? true);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={`inventory-experience-v2 ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {/* Header & Scope Bar */}
      <header className="inv-v2-header">
        <div className="inv-v2-title-group">
          <h1>{activeScope === "group" ? "All Locations Inventory" : title}</h1>
          <span className="inv-v2-title-count">
            {scopedVehicles.length}{" "}
            {scopedVehicles.length === 1 ? "vehicle" : "vehicles"} available
          </span>
        </div>

        {/* Scope Switcher */}
        <div
          className="inv-v2-scope-toggle"
          role="group"
          aria-label="Inventory location scope"
        >
          <button
            type="button"
            className={`inv-v2-scope-btn${activeScope === "home" ? " is-active" : ""}`}
            aria-pressed={activeScope === "home"}
            onClick={() => handleScopeChange("home")}
          >
            {homeStore.name} Lot
          </button>
          <button
            type="button"
            className={`inv-v2-scope-btn${activeScope === "group" ? " is-active" : ""}`}
            aria-pressed={activeScope === "group"}
            onClick={() => handleScopeChange("group")}
          >
            All Locations
          </button>
        </div>
      </header>

      {/* Decision Metrics Rail */}
      {metrics ? <InventoryDecisionRail metrics={metrics} /> : null}

      {/* Controls Bar: Predictive Search & Quick View Pills */}
      <div className="inv-v2-controls-bar">
        <div className="inv-v2-search-wrapper">
          <InventoryPredictiveSearch
            id="v2-inventory-search"
            vehicles={vehicles}
            value={query}
            onChange={setQuery}
            onSelectVehicle={handleSelectVehicle}
            persistenceKey={searchPersistenceKey}
            placeholder="Search make, model, stock #, VIN..."
          />
        </div>

        {/* Quick View Filter Pills */}
        <div
          className="inv-v2-pills-group"
          role="group"
          aria-label="Quick inventory filters"
        >
          {(
            [
              ["all", "All Vehicles"],
              ["shortlisted", `♥ Interest (${shortlist.count})`],
              ["no-hold", "No Hold"],
              ["new", "New Today"],
              ["price", "Price Changed"],
            ] as const
          ).map(([val, label]) => {
            const active = quickView === val;
            return (
              <motion.button
                key={val}
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                aria-pressed={active}
                onClick={() => setQuickView(val)}
                className={`inv-v2-pill-btn${active ? " is-active" : ""}`}
              >
                {label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* High-Density Inventory Table V2 */}
      <InventoryTableV2
        vehicles={pageVehicles}
        selectedVehicleId={activeSelectedId}
        sorts={sorts}
        onSortChange={setSorts}
        onSelectVehicle={handleSelectVehicle}
        canRequestVehicle={canRequestVehicle}
        onRequestVehicle={onRequestVehicle}
        onTrackMovement={onTrackMovement}
        onOpenListing={onOpenListing}
        onOpenSourceRecord={onOpenSourceRecord}
        onViewVehicle={onViewVehicle}
        isShortlisted={shortlist.isShortlisted}
        onToggleShortlist={shortlist.toggle}
      />

      {/* Pagination Footer */}
      {totalPages > 1 ? (
        <footer className="inv-v2-pagination">
          <span>
            Showing {startIndex + 1}–
            {Math.min(startIndex + pageSize, sortedVehicles.length)} of{" "}
            {sortedVehicles.length} vehicles
          </span>
          <div className="inv-v2-pagination-controls">
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inv-v2-pagination-btn"
            >
              <ChevronLeft size={14} /> Prev
            </motion.button>
            <span className="inv-v2-pagination-page">
              Page {safePage} of {totalPages}
            </span>
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inv-v2-pagination-btn"
            >
              Next <ChevronRight size={14} />
            </motion.button>
          </div>
        </footer>
      ) : null}

      {/* VDP Cockpit Modal Disclosure */}
      <AnimatePresence>
        {selectedVehicle ? (
          <VehicleWorkspaceV2
            key={selectedVehicle.id}
            vehicle={selectedVehicle}
            homeStore={homeStore}
            initialTab={initialWorkspaceTab}
            canRequestVehicle={canRequestSelected}
            onClose={handleCloseWorkspace}
            onViewVehicle={onViewVehicle}
            onRequestVehicle={onRequestVehicle}
            onTrackMovement={onTrackMovement}
            onOpenListing={onOpenListing}
            onOpenSourceRecord={onOpenSourceRecord}
          />
        ) : null}
      </AnimatePresence>

      {/* Customer Interest Shortlist Drawer */}
      <CustomerShortlistDrawer
        entries={shortlist.entries}
        onRemove={shortlist.remove}
        onClear={shortlist.clear}
        onSelectVehicle={(v) => handleSelectVehicleId(v.id)}
      />
    </motion.div>
  );
}
