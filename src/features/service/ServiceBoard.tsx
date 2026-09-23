import { useMemo, useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { readWorkspaceReturnPath, workspaceReturnLabel } from "../inventory/inventory-navigation";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion";
import { useContainedFocus } from "../../lib/useContainedFocus";
import { useModalBackgroundIsolation } from "../../lib/useModalBackgroundIsolation";
import { confirmUnsavedWork } from "../../lib/useUnsavedChanges";
import { useWorkspaceState } from "../../lib/workspace-memory";
import { ServiceEditor } from "./ServicePage";
import { serviceEvidenceSummary } from "./SourceServiceHistory";
import { oasisActionLabel } from "../inventory/vehicle-resource-catalog";
import { CopyableValue } from "../../components/CopyableValue";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  CarFront,
  CheckCircle2,
  Clock3,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useAppData } from "../../app/AppDataContext";
import { formatDate, formatNumber } from "../../lib/format";
import {
  serviceWorkflowStatus,
} from "../../lib/service-readiness";
import type {
  ServiceWorkflowStatus,
  VehicleRecord,
} from "../../types";
import { searchFieldsMatch } from "../inventory/inventory-search";
import { PredictiveSearchInput } from "../../components/PredictiveSearchInput";
import "./ServicePageV2.css";

function localToday(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function displayDate(value?: string | null): string {
  return value ? formatDate(value.slice(0, 10)) : 'Not recorded';
}

function FordServiceActions({ vehicle }: { vehicle: VehicleRecord }) {
  const count = vehicle.fordOasis?.openFieldServiceActions?.length ?? 0;
  if (!count) return null;
  return <div className="service-v2-card-alert"><ShieldAlert size={14} aria-hidden="true" /><span>Saved OASIS · {oasisActionLabel(vehicle.fordOasis)}</span></div>;
}

function ServiceHistoryEvidence({ vehicle }: { vehicle: VehicleRecord }) {
  const summary = serviceEvidenceSummary(vehicle);
  return summary ? <div className="service-v2-card-history"><Wrench size={14} aria-hidden="true" /><span>{summary}</span></div> : null;
}

export function ServiceBoard({ toolbarAccessory }: { toolbarAccessory?: ReactNode } = {}) {
  const reducedMotion = usePrefersReducedMotion();
  const { data, homeStore, role, currentUser, refresh } = useAppData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = readWorkspaceReturnPath(params.get("returnTo"));

  const accessContext = `${currentUser}:${role}:${homeStore}`;
  const [scope, setScope] = useWorkspaceState<"my_store" | "all">(accessContext, "service.scope", "my_store");
  const [search, setSearch] = useWorkspaceState(accessContext, "service.search", "");

  // The board only displays server-confirmed service state. Actions open the
  // same permission-checked editor as the standard service list.
  const boardRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Selected vehicle for detailed drawer
  const selectedVin = params.get("vin");
  const selectedVehicle = useMemo(() => {
    return data?.vehicles.find((v) => v.vin === selectedVin) ?? null;
  }, [data?.vehicles, selectedVin]);

  const selectVin = useCallback(
    (vin: string | null) => {
      if (!confirmUnsavedWork()) return;
      if (!vin && returnTo) { navigate(returnTo); return; }
      setParams((curr) => {
        const next = new URLSearchParams(curr);
        next.delete("action");
        if (vin) next.set("vin", vin);
        else next.delete("vin");
        return next;
      });
    },
    [setParams, returnTo, navigate],
  );

  // Scoped vehicles
  const scopedVehicles = useMemo(() => {
    if (!data?.vehicles) return [];
    return data.vehicles.filter((v) => {
      if (scope === "my_store") {
        const store = v.serviceReadiness?.store ?? v.homeStore;
        return store === homeStore;
      }
      return true;
    });
  }, [data?.vehicles, scope, homeStore]);

  // Filtered by search query
  const searchedVehicles = useMemo(() => {
    if (!search.trim()) return scopedVehicles;
    return scopedVehicles.filter((v) => searchFieldsMatch(search, [v.vehicleName, v.stockNumber, v.vin, v.searchText]));
  }, [scopedVehicles, search]);

  const getEffectiveStatus = (vehicle: VehicleRecord) => serviceWorkflowStatus(vehicle.serviceReadiness);

  // Group vehicles into 3 Kanban columns
  const needsServiceVehicles = useMemo(() => {
    return searchedVehicles.filter((v) => {
      const st = getEffectiveStatus(v);
      return st === "needs_service";
    });
  }, [searchedVehicles, getEffectiveStatus]);

  const inServiceVehicles = useMemo(() => {
    return searchedVehicles.filter((v) => getEffectiveStatus(v) === "in_service");
  }, [searchedVehicles, getEffectiveStatus]);

  const readyVehicles = useMemo(() => {
    return searchedVehicles.filter((v) => getEffectiveStatus(v) === "serviced");
  }, [searchedVehicles, getEffectiveStatus]);

  const openServiceAction = (vehicle: VehicleRecord, action: ServiceWorkflowStatus) => {
    if (!vehicle.serviceReadiness?.canManage) return;
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set("vin", vehicle.vin);
      next.set("action", action);
      return next;
    });
  };
  const handleQuickStartService = (vehicle: VehicleRecord) => openServiceAction(vehicle, "in_service");
  const handleQuickMarkReady = (vehicle: VehicleRecord) => openServiceAction(vehicle, "serviced");
  const requestedAction = params.get("action");
  const initialAction = requestedAction === "needs_service" || requestedAction === "in_service" || requestedAction === "serviced" ? requestedAction : null;
  useContainedFocus({ active: Boolean(selectedVehicle), contain: true, containerRef: drawerRef, onEscape: () => selectVin(null) });
  useModalBackgroundIsolation({ active: Boolean(selectedVehicle), backgroundRef: boardRef });

  if (!data) return null;

  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}><div ref={boardRef} className="service-page-v2" aria-label="Service status">
      {/* Header */}
      <header className="service-v2-header">
        <div className="service-v2-header-title">
          <h1>
            <Wrench size={24} aria-hidden="true" />
            Service status
          </h1>
          <p>
            Waiting, in service, and ready · {homeStore}
          </p>
        </div>

        <div className="service-v2-header-controls">
          {/* Scope switch */}
          <div
            className="service-v2-toggle-group"
            role="group"
            aria-label="Service scope"
          >
            <button
              type="button"
              className={`service-v2-toggle-btn${scope === "my_store" ? " is-active" : ""}`}
              aria-label={`My store · ${homeStore}`}
              aria-pressed={scope === "my_store"}
              onClick={() => setScope("my_store")}
            >
              {homeStore}
            </button>
            <button
              type="button"
              className={`service-v2-toggle-btn${scope === "all" ? " is-active" : ""}`}
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              All Stores
            </button>
          </div>

          {toolbarAccessory}
        </div>
      </header>

      {/* Toolbar: Search & Summary */}
      <div className="service-v2-toolbar">
        <PredictiveSearchInput className="service-v2-search" inputType="search" value={search} onChange={setSearch} ariaLabel="Filter service vehicles" clearLabel="Clear service search" placeholder="Search stock #, VIN, model..." candidates={scopedVehicles.map(vehicle => ({ id: vehicle.vin, label: vehicle.vehicleName, detail: `#${vehicle.stockNumber} · ${vehicle.serviceReadiness?.store ?? vehicle.homeStore}`, value: vehicle.stockNumber, searchValues: [vehicle.vehicleName, vehicle.stockNumber, vehicle.vin, vehicle.searchText] }))} />

        <div className="service-v2-metrics-summary">
          <span>
            {searchedVehicles.length}{" "}
            {searchedVehicles.length === 1 ? "vehicle" : "vehicles"} ·{" "}
            <strong>{needsServiceVehicles.length}</strong> waiting,{" "}
            <strong>{inServiceVehicles.length}</strong> in service,{" "}
            <strong>{readyVehicles.length}</strong> ready
          </span>
        </div>
      </div>

      {/* Main Content: Kanban or List cross-fade */}
      {search.trim() && searchedVehicles.length === 0 ? (
        <div className="service-v2-no-results" role="status">
          <Search size={24} aria-hidden="true" />
          <strong>No service vehicles match “{search.trim()}”</strong>
          <span>Try another stock number, VIN, or vehicle.</span>
          <button type="button" onClick={() => setSearch("")}>Clear search</button>
        </div>
      ) : <AnimatePresence mode="wait">
          <motion.div
            key="kanban-view"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="service-v2-board"
          >
            {/* Column 1: Needs Service */}
            <div className={`service-v2-column service-v2-col--needs-service${needsServiceVehicles.length ? "" : " is-empty"}`}>
              <div className="service-v2-column-header">
                <h2>
                  <Clock3 size={16} aria-hidden="true" />
                  Waiting for service
                </h2>
                <span className="service-v2-column-count">
                  {needsServiceVehicles.length}
                </span>
              </div>
              <div className="service-v2-column-cards">
                {needsServiceVehicles.length === 0 ? (
                  <div className="service-v2-empty-col">
                    <CheckCircle2 size={20} aria-hidden="true" />
                    <span>No vehicles waiting for service</span>
                  </div>
                ) : (
                  needsServiceVehicles.map((vehicle) => {
                    const thumbnail = vehicle.imageUrl || vehicle.imageUrls?.[0];


                    return (
                      <motion.div
                        key={vehicle.vin}
                        layout
                        layoutId={`service-card-${vehicle.vin}`}
                        className={`service-v2-card${selectedVin === vehicle.vin ? " is-selected" : ""}`}
                      >
                        <div className="service-v2-card-top">
                          <div className="service-v2-card-thumb">
                            {thumbnail ? (
                              <img src={thumbnail} alt="" loading="lazy" />
                            ) : (
                              <CarFront size={22} aria-hidden="true" />
                            )}
                          </div>
                          <div className="service-v2-card-info">
                            <span className="service-v2-card-title">
                              {vehicle.vehicleName}
                            </span>
                            <div className="service-v2-card-chips">
                              <CopyableValue
                                label="Stock"
                                text={vehicle.stockNumber}
                                compact
                              >
                                #{vehicle.stockNumber}
                              </CopyableValue>
                              <CopyableValue
                                label="VIN"
                                text={vehicle.vin}
                                compact
                              >
                                {vehicle.vin.slice(-8)}
                              </CopyableValue>
                            </div>
                          </div>
                        </div>

                        <div className="service-v2-card-meta">
                          <span>
                            {vehicle.mileage != null
                              ? `${formatNumber(vehicle.mileage)} mi`
                              : "No miles"}
                          </span>
                          <span>·</span>
                          <span>
                            {vehicle.daysListed != null
                              ? `${vehicle.daysListed}d listed`
                              : "New"}
                          </span>
                          <span>·</span>
                          <span>
                            {vehicle.serviceReadiness?.store ?? vehicle.homeStore}
                          </span>
                        </div>

                        <FordServiceActions vehicle={vehicle} />
                        <ServiceHistoryEvidence vehicle={vehicle} />
                        <div className="service-v2-card-footer">
                          <motion.span
                            layoutId={`service-badge-${vehicle.vin}`}
                            className="service-v2-badge service-v2-badge--needs-service"
                          >
                            Waiting
                          </motion.span>

                          <div className="service-v2-card-actions">
                            {vehicle.serviceReadiness?.canManage ? (<motion.button
                              type="button"
                              whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                              whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                              className="service-v2-action-btn service-v2-btn-start"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleQuickStartService(vehicle);
                              }}
                              title="Start service now"
                              aria-label={`Start service for ${vehicle.stockNumber}`}
                            >
                              Start Service
                            </motion.button>) : null}
                            <motion.button
                              type="button"
                              whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                              whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                              className="service-v2-action-btn service-v2-btn-details"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                selectVin(vehicle.vin);
                              }}
                              aria-label={`View details for ${vehicle.stockNumber}`}
                            >
                              Details
                            </motion.button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Column 2: In Service */}
            <div className={`service-v2-column service-v2-col--in-service${inServiceVehicles.length ? "" : " is-empty"}`}>
              <div className="service-v2-column-header">
                <h2>
                  <Wrench size={16} aria-hidden="true" />
                  In service
                </h2>
                <span className="service-v2-column-count">
                  {inServiceVehicles.length}
                </span>
              </div>
              <div className="service-v2-column-cards">
                {inServiceVehicles.length === 0 ? (
                  <div className="service-v2-empty-col">
                    <CheckCircle2 size={20} aria-hidden="true" />
                    <span>No vehicles currently undergoing service</span>
                  </div>
                ) : (
                  inServiceVehicles.map((vehicle) => {
                    const thumbnail = vehicle.imageUrl || vehicle.imageUrls?.[0];
                    const enteredDate =
                      vehicle.serviceReadiness?.serviceEnteredAt;

                    return (
                      <motion.div
                        key={vehicle.vin}
                        layout
                        layoutId={`service-card-${vehicle.vin}`}
                        className={`service-v2-card${selectedVin === vehicle.vin ? " is-selected" : ""}`}
                      >
                        <div className="service-v2-card-top">
                          <div className="service-v2-card-thumb">
                            {thumbnail ? (
                              <img src={thumbnail} alt="" loading="lazy" />
                            ) : (
                              <CarFront size={22} aria-hidden="true" />
                            )}
                          </div>
                          <div className="service-v2-card-info">
                            <span className="service-v2-card-title">
                              {vehicle.vehicleName}
                            </span>
                            <div className="service-v2-card-chips">
                              <CopyableValue
                                label="Stock"
                                text={vehicle.stockNumber}
                                compact
                              >
                                #{vehicle.stockNumber}
                              </CopyableValue>
                              <CopyableValue
                                label="VIN"
                                text={vehicle.vin}
                                compact
                              >
                                {vehicle.vin.slice(-8)}
                              </CopyableValue>
                            </div>
                          </div>
                        </div>

                        <div className="service-v2-card-meta">
                          <span>
                            {vehicle.mileage != null
                              ? `${formatNumber(vehicle.mileage)} mi`
                              : "No miles"}
                          </span>
                          <span>·</span>
                          <span>
                            {enteredDate
                              ? `Entered ${displayDate(enteredDate)}`
                              : "In Progress"}
                          </span>
                        </div>

                        <FordServiceActions vehicle={vehicle} />
                        <ServiceHistoryEvidence vehicle={vehicle} />
                        <div className="service-v2-card-footer">
                          <motion.span
                            layoutId={`service-badge-${vehicle.vin}`}
                            className="service-v2-badge service-v2-badge--in-service"
                          >
                            In service
                          </motion.span>

                          <div className="service-v2-card-actions">
                            {vehicle.serviceReadiness?.canManage ? (<motion.button
                              type="button"
                              whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                              whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                              className="service-v2-action-btn service-v2-btn-ready"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleQuickMarkReady(vehicle);
                              }}
                              title="Record service completion"
                              aria-label={`Mark Ready for ${vehicle.stockNumber}`}
                            >
                              Mark Ready
                            </motion.button>) : null}
                            <motion.button
                              type="button"
                              whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                              whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                              className="service-v2-action-btn service-v2-btn-details"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                selectVin(vehicle.vin);
                              }}
                              aria-label={`View details for ${vehicle.stockNumber}`}
                            >
                              Details
                            </motion.button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Column 3: Service Ready */}
            <div className={`service-v2-column service-v2-col--serviced${readyVehicles.length ? "" : " is-empty"}`}>
              <div className="service-v2-column-header">
                <h2>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  Service Ready
                </h2>
                <span className="service-v2-column-count">
                  {readyVehicles.length}
                </span>
              </div>
              <div className="service-v2-column-cards">
                {readyVehicles.length === 0 ? (
                  <div className="service-v2-empty-col">
                    <Clock3 size={20} aria-hidden="true" />
                    <span>No vehicles marked ready yet</span>
                  </div>
                ) : (
                  readyVehicles.map((vehicle) => {
                    const thumbnail = vehicle.imageUrl || vehicle.imageUrls?.[0];
                    const completedDate = vehicle.serviceReadiness?.completedAt;

                    return (
                      <motion.div
                        key={vehicle.vin}
                        layout
                        layoutId={`service-card-${vehicle.vin}`}
                        className={`service-v2-card${selectedVin === vehicle.vin ? " is-selected" : ""}`}
                      >
                        <div className="service-v2-card-top">
                          <div className="service-v2-card-thumb">
                            {thumbnail ? (
                              <img src={thumbnail} alt="" loading="lazy" />
                            ) : (
                              <CarFront size={22} aria-hidden="true" />
                            )}
                          </div>
                          <div className="service-v2-card-info">
                            <span className="service-v2-card-title">
                              {vehicle.vehicleName}
                            </span>
                            <div className="service-v2-card-chips">
                              <CopyableValue
                                label="Stock"
                                text={vehicle.stockNumber}
                                compact
                              >
                                #{vehicle.stockNumber}
                              </CopyableValue>
                              <CopyableValue
                                label="VIN"
                                text={vehicle.vin}
                                compact
                              >
                                {vehicle.vin.slice(-8)}
                              </CopyableValue>
                            </div>
                          </div>
                        </div>

                        <div className="service-v2-card-meta">
                          <span>
                            {vehicle.mileage != null
                              ? `${formatNumber(vehicle.mileage)} mi`
                              : "No miles"}
                          </span>
                          <span>·</span>
                          <span>
                            {completedDate
                              ? `Ready ${displayDate(completedDate)}`
                              : "Ready date not recorded"}
                          </span>
                        </div>

                        <FordServiceActions vehicle={vehicle} />
                        <ServiceHistoryEvidence vehicle={vehicle} />
                        <div className="service-v2-card-footer">
                          <motion.span
                            layoutId={`service-badge-${vehicle.vin}`}
                            className="service-v2-badge service-v2-badge--serviced"
                          >
                            Ready
                          </motion.span>

                          <div className="service-v2-card-actions">
                            <motion.button
                              type="button"
                              whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                              whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                              className="service-v2-action-btn service-v2-btn-details"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                selectVin(vehicle.vin);
                              }}
                              aria-label={`View details for ${vehicle.stockNumber}`}
                            >
                              Details
                            </motion.button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>
          </motion.div>
      </AnimatePresence>}

      {selectedVin && !selectedVehicle ? <p role="status" className="service-permission">This vehicle is not in the current inventory. Choose a vehicle to review service status.</p> : null}
      {selectedVehicle ? createPortal(
        <div className="service-v2-drawer-backdrop">
          <div className="service-v2-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label={`Service details for ${selectedVehicle.vehicleName}`}>

            <ServiceEditor key={`${selectedVehicle.vin}:${role}:${homeStore}`} vehicle={selectedVehicle} role={role} store={homeStore}
              initialAction={initialAction} defaultDate={selectedVehicle.vin.startsWith('TESTDATA') ? data.meta.reportDate : localToday()}
              onBack={() => selectVin(null)} backLabel={returnTo ? workspaceReturnLabel(returnTo) : "Back to service board"} onSaved={async () => { await refresh(); }} />
          </div>
        </div>, document.body) : null}
    </div></MotionConfig>
  );
}
