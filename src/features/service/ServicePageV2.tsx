import { useState, useMemo, useCallback, useEffect, type FormEvent } from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  CarFront,
  CheckCircle2,
  Clock3,
  Kanban,
  List,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAppData } from "../../app/AppDataContext";
import { CopyableValue } from "../../components/CopyableValue";
import {
  getServiceReadiness,
  updateServiceReadiness,
} from "../../lib/api";
import { formatNumber } from "../../lib/format";
import {
  serviceStatusLabel,
  serviceWorkflowStatus,
} from "../../lib/service-readiness";
import type {
  ServiceReadinessDetail,
  ServiceWorkflowStatus,
  VehicleRecord,
} from "../../types";
import "./ServicePageV2.css";

type ViewMode = "kanban" | "list";

function localToday(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function displayDate(value?: string | null): string {
  if (!value) return "Not recorded";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
  } catch {
    return value;
  }
}

export function ServicePageV2() {
  const { data, homeStore, role, refresh } = useAppData();
  const [params, setParams] = useSearchParams();

  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [scope, setScope] = useState<"my_store" | "all">("my_store");
  const [search, setSearch] = useState("");

  // Optimistic status map for instant visual feedback on cards
  const [optimisticStatuses, setOptimisticStatuses] = useState<
    Record<string, ServiceWorkflowStatus>
  >({});
  const [actionBusyVins, setActionBusyVins] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  // Selected vehicle for detailed drawer
  const selectedVin = params.get("vin");
  const selectedVehicle = useMemo(() => {
    return data?.vehicles.find((v) => v.vin === selectedVin) ?? null;
  }, [data?.vehicles, selectedVin]);

  const [detail, setDetail] = useState<ServiceReadinessDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [drawerNotes, setDrawerNotes] = useState("");
  const [drawerDate, setDrawerDate] = useState(localToday());
  const [drawerStatus, setDrawerStatus] = useState<ServiceWorkflowStatus>("needs_service");
  const [savingDrawer, setSavingDrawer] = useState(false);

  // Load detail when selectedVin changes
  useEffect(() => {
    if (!selectedVin) {
      setDetail(null);
      return;
    }
    let canceled = false;
    setLoadingDetail(true);
    getServiceReadiness(selectedVin, role, homeStore)
      .then((res) => {
        if (!canceled) {
          setDetail(res);
          setDrawerStatus(serviceWorkflowStatus(res));
          setDrawerNotes(res.notes ?? "");
          setDrawerDate(
            res.status === "serviced"
              ? res.completedAt ?? localToday()
              : res.serviceEnteredAt ?? localToday(),
          );
        }
      })
      .catch(() => {
        if (!canceled) setDetail(null);
      })
      .finally(() => {
        if (!canceled) setLoadingDetail(false);
      });
    return () => {
      canceled = true;
    };
  }, [selectedVin, role, homeStore]);

  const selectVin = useCallback(
    (vin: string | null) => {
      setParams((curr) => {
        const next = new URLSearchParams(curr);
        if (vin) next.set("vin", vin);
        else next.delete("vin");
        return next;
      });
    },
    [setParams],
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
    const q = search.trim().toLowerCase();
    return scopedVehicles.filter((v) => {
      return (
        v.vehicleName.toLowerCase().includes(q) ||
        v.stockNumber.toLowerCase().includes(q) ||
        v.vin.toLowerCase().includes(q)
      );
    });
  }, [scopedVehicles, search]);

  // Helper to determine effective status (optimistic or server)
  const getEffectiveStatus = useCallback(
    (vehicle: VehicleRecord): ServiceWorkflowStatus => {
      if (optimisticStatuses[vehicle.vin]) {
        return optimisticStatuses[vehicle.vin];
      }
      return serviceWorkflowStatus(vehicle.serviceReadiness);
    },
    [optimisticStatuses],
  );

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

  // 1-Click Quick Action: Start Service
  const handleQuickStartService = useCallback(
    async (vehicle: VehicleRecord) => {
      const vin = vehicle.vin;
      setActionError(null);
      setActionBusyVins((prev) => new Set(prev).add(vin));
      // Optimistic update
      setOptimisticStatuses((prev) => ({ ...prev, [vin]: "in_service" }));

      try {
        const currentDetail = await getServiceReadiness(vin, role, homeStore);
        await updateServiceReadiness(
          vin,
          {
            status: "in_service",
            expectedVersion: currentDetail.version,
            serviceDate: localToday(),
            notes: currentDetail.notes || "Service started via 1-click quick action",
          },
          role,
          homeStore,
        );
        await refresh();
      } catch (err) {
        // Revert optimistic update
        setOptimisticStatuses((prev) => {
          const next = { ...prev };
          delete next[vin];
          return next;
        });
        setActionError(
          err instanceof Error ? err.message : "Failed to start service. Please try again.",
        );
      } finally {
        setActionBusyVins((prev) => {
          const next = new Set(prev);
          next.delete(vin);
          return next;
        });
      }
    },
    [role, homeStore, refresh],
  );

  // 1-Click Quick Action: Mark Ready
  const handleQuickMarkReady = useCallback(
    async (vehicle: VehicleRecord) => {
      const vin = vehicle.vin;
      setActionError(null);
      setActionBusyVins((prev) => new Set(prev).add(vin));
      // Optimistic update
      setOptimisticStatuses((prev) => ({ ...prev, [vin]: "serviced" }));

      try {
        const currentDetail = await getServiceReadiness(vin, role, homeStore);
        await updateServiceReadiness(
          vin,
          {
            status: "serviced",
            expectedVersion: currentDetail.version,
            serviceDate: localToday(),
            notes: currentDetail.notes || "Marked ready via 1-click quick action",
          },
          role,
          homeStore,
        );
        await refresh();
      } catch (err) {
        // Revert optimistic update
        setOptimisticStatuses((prev) => {
          const next = { ...prev };
          delete next[vin];
          return next;
        });
        setActionError(
          err instanceof Error ? err.message : "Failed to mark ready. Please try again.",
        );
      } finally {
        setActionBusyVins((prev) => {
          const next = new Set(prev);
          next.delete(vin);
          return next;
        });
      }
    },
    [role, homeStore, refresh],
  );

  // Submit full form in drawer
  const handleDrawerSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle || !detail || savingDrawer) return;
    setSavingDrawer(true);
    setActionError(null);
    try {
      await updateServiceReadiness(
        selectedVehicle.vin,
        {
          status: drawerStatus,
          expectedVersion: detail.version,
          serviceDate: drawerDate,
          notes: drawerNotes,
        },
        role,
        homeStore,
      );
      await refresh();
      selectVin(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to save service updates.",
      );
    } finally {
      setSavingDrawer(false);
    }
  };

  if (!data) return null;

  return (
    <div className="service-page-v2" aria-label="Service Board V2">
      {/* Header */}
      <header className="service-v2-header">
        <div className="service-v2-header-title">
          <h1>
            <Wrench size={24} aria-hidden="true" />
            Service Operations Cockpit
          </h1>
          <p>
            Readiness Kanban & High-Utility Queue · {homeStore}
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
              aria-pressed={scope === "my_store"}
              onClick={() => setScope("my_store")}
            >
              My Store ({homeStore})
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

          {/* View mode toggle (Kanban vs List) */}
          <div
            className="service-v2-toggle-group"
            role="group"
            aria-label="View mode"
          >
            <button
              type="button"
              className={`service-v2-toggle-btn${viewMode === "kanban" ? " is-active" : ""}`}
              aria-pressed={viewMode === "kanban"}
              onClick={() => setViewMode("kanban")}
            >
              <Kanban size={14} aria-hidden="true" />
              Kanban Board
            </button>
            <button
              type="button"
              className={`service-v2-toggle-btn${viewMode === "list" ? " is-active" : ""}`}
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              <List size={14} aria-hidden="true" />
              List View
            </button>
          </div>
        </div>
      </header>

      {/* Toolbar: Search & Summary */}
      <div className="service-v2-toolbar">
        <label className="service-v2-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stock #, VIN, model..."
            aria-label="Filter service vehicles"
          />
        </label>

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

      {actionError && (
        <div
          role="alert"
          style={{
            background: "var(--ifx-danger-surface)",
            color: "var(--ifx-danger)",
            border: "1px solid color-mix(in srgb, var(--ifx-danger) 30%, transparent)",
            borderRadius: "6px",
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {actionError}
        </div>
      )}

      {/* Main Content: Kanban or List cross-fade */}
      <AnimatePresence mode="wait">
        {viewMode === "kanban" ? (
          <motion.div
            key="kanban-view"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="service-v2-board"
          >
            {/* Column 1: Needs Service */}
            <div className="service-v2-column service-v2-col--needs-service">
              <div className="service-v2-column-header">
                <h2>
                  <Clock3 size={16} aria-hidden="true" />
                  Needs Service
                </h2>
                <span className="service-v2-column-count">
                  {needsServiceVehicles.length}
                </span>
              </div>
              <div className="service-v2-column-cards">
                {needsServiceVehicles.length === 0 ? (
                  <div className="service-v2-empty-col">
                    <CheckCircle2 size={24} />
                    <span>No vehicles waiting for service</span>
                  </div>
                ) : (
                  needsServiceVehicles.map((vehicle) => {
                    const isBusy = actionBusyVins.has(vehicle.vin);
                    const thumbnail = vehicle.imageUrl || vehicle.imageUrls?.[0];
                    const hasRecall = Boolean(
                      vehicle.fordOasis?.openFieldServiceActions &&
                        vehicle.fordOasis.openFieldServiceActions.length > 0,
                    );

                    return (
                      <motion.div
                        key={vehicle.vin}
                        layout
                        layoutId={`service-card-${vehicle.vin}`}
                        whileHover={{ y: -2 }}
                        className={`service-v2-card${selectedVin === vehicle.vin ? " is-selected" : ""}`}
                        onClick={() => selectVin(vehicle.vin)}
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

                        {hasRecall ? (
                          <div className="service-v2-card-alert">
                            <ShieldAlert size={12} />
                            <span>Recall Open</span>
                          </div>
                        ) : null}

                        <div className="service-v2-card-footer">
                          <motion.span
                            layoutId={`service-badge-${vehicle.vin}`}
                            className="service-v2-badge service-v2-badge--needs-service"
                          >
                            Waiting
                          </motion.span>

                          <div className="service-v2-card-actions">
                            <motion.button
                              type="button"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              disabled={isBusy}
                              className="service-v2-action-btn service-v2-btn-start"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleQuickStartService(vehicle);
                              }}
                              title="Start service now"
                              aria-label={`Start service for ${vehicle.stockNumber}`}
                            >
                              {isBusy ? "Starting…" : "Start Service"}
                            </motion.button>
                            <motion.button
                              type="button"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
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
            <div className="service-v2-column service-v2-col--in-service">
              <div className="service-v2-column-header">
                <h2>
                  <Wrench size={16} aria-hidden="true" />
                  In Service
                </h2>
                <span className="service-v2-column-count">
                  {inServiceVehicles.length}
                </span>
              </div>
              <div className="service-v2-column-cards">
                {inServiceVehicles.length === 0 ? (
                  <div className="service-v2-empty-col">
                    <CheckCircle2 size={24} />
                    <span>No vehicles currently undergoing service</span>
                  </div>
                ) : (
                  inServiceVehicles.map((vehicle) => {
                    const isBusy = actionBusyVins.has(vehicle.vin);
                    const thumbnail = vehicle.imageUrl || vehicle.imageUrls?.[0];
                    const enteredDate =
                      vehicle.serviceReadiness?.serviceEnteredAt;

                    return (
                      <motion.div
                        key={vehicle.vin}
                        layout
                        layoutId={`service-card-${vehicle.vin}`}
                        whileHover={{ y: -2 }}
                        className={`service-v2-card${selectedVin === vehicle.vin ? " is-selected" : ""}`}
                        onClick={() => selectVin(vehicle.vin)}
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

                        <div className="service-v2-card-footer">
                          <motion.span
                            layoutId={`service-badge-${vehicle.vin}`}
                            className="service-v2-badge service-v2-badge--in-service"
                          >
                            In Service
                          </motion.span>

                          <div className="service-v2-card-actions">
                            <motion.button
                              type="button"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              disabled={isBusy}
                              className="service-v2-action-btn service-v2-btn-ready"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleQuickMarkReady(vehicle);
                              }}
                              title="Mark serviced and ready for delivery"
                              aria-label={`Mark Ready for ${vehicle.stockNumber}`}
                            >
                              {isBusy ? "Marking…" : "Mark Ready"}
                            </motion.button>
                            <motion.button
                              type="button"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
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

            {/* Column 3: Ready for Delivery */}
            <div className="service-v2-column service-v2-col--serviced">
              <div className="service-v2-column-header">
                <h2>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  Ready for Delivery
                </h2>
                <span className="service-v2-column-count">
                  {readyVehicles.length}
                </span>
              </div>
              <div className="service-v2-column-cards">
                {readyVehicles.length === 0 ? (
                  <div className="service-v2-empty-col">
                    <Clock3 size={24} />
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
                        whileHover={{ y: -2 }}
                        className={`service-v2-card${selectedVin === vehicle.vin ? " is-selected" : ""}`}
                        onClick={() => selectVin(vehicle.vin)}
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
                              : "Ready to Show"}
                          </span>
                        </div>

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
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
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
        ) : (
          /* List View */
          <motion.div
            key="list-view"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="service-v2-list-wrapper"
          >
            <table
              className="service-v2-list-table"
              role="table"
              aria-label="Service vehicles list"
            >
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Stock / VIN</th>
                  <th>Store / Location</th>
                  <th>Readiness Stage</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {searchedVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "var(--v10-support)" }}>
                      No vehicles found
                    </td>
                  </tr>
                ) : (
                  searchedVehicles.map((vehicle) => {
                    const st = getEffectiveStatus(vehicle);
                    const isBusy = actionBusyVins.has(vehicle.vin);

                    return (
                      <tr key={vehicle.vin}>
                        <td>
                          <strong>{vehicle.vehicleName}</strong>
                          <div style={{ fontSize: "12px", color: "var(--v10-support)" }}>
                            {vehicle.mileage != null
                              ? `${formatNumber(vehicle.mileage)} mi`
                              : "No miles"}{" "}
                            · {vehicle.exteriorColor ?? "No color"}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <CopyableValue label="Stock" text={vehicle.stockNumber} compact>
                              #{vehicle.stockNumber}
                            </CopyableValue>
                            <CopyableValue label="VIN" text={vehicle.vin} compact>
                              {vehicle.vin}
                            </CopyableValue>
                          </div>
                        </td>
                        <td>
                          {vehicle.serviceReadiness?.store ?? vehicle.homeStore}
                        </td>
                        <td>
                          <span
                            className={`service-v2-badge service-v2-badge--${st === "serviced" ? "serviced" : st === "in_service" ? "in-service" : "needs-service"}`}
                          >
                            {st === "serviced"
                              ? "Ready"
                              : st === "in_service"
                                ? "In Service"
                                : "Needs Service"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "6px" }}>
                            {st !== "in_service" && st !== "serviced" && (
                              <motion.button
                                type="button"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                disabled={isBusy}
                                className="service-v2-action-btn service-v2-btn-start"
                                onClick={() => handleQuickStartService(vehicle)}
                              >
                                Start Service
                              </motion.button>
                            )}
                            {st === "in_service" && (
                              <motion.button
                                type="button"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                disabled={isBusy}
                                className="service-v2-action-btn service-v2-btn-ready"
                                onClick={() => handleQuickMarkReady(vehicle)}
                              >
                                Mark Ready
                              </motion.button>
                            )}
                            <motion.button
                              type="button"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              className="service-v2-action-btn service-v2-btn-details"
                              onClick={() => selectVin(vehicle.vin)}
                            >
                              Details
                            </motion.button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Service Details Drawer / Modal */}
      <AnimatePresence>
        {selectedVehicle ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100,
              display: "flex",
              justifyContent: "flex-end",
              background: "rgb(3 18 33 / 50%)",
              backdropFilter: "blur(2px)",
            }}
            onClick={() => selectVin(null)}
          >
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              style={{
                width: "100%",
                maxWidth: "460px",
                height: "100%",
                background: "var(--v10-surface)",
                boxShadow: "-4px 0 24px rgb(0 0 0 / 15%)",
                display: "flex",
                flexDirection: "column",
                overflowY: "auto",
                padding: "24px",
                boxSizing: "border-box",
                gap: "18px",
              }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              aria-label={`Service details for ${selectedVehicle.vehicleName}`}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => selectVin(null)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "none",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "var(--v10-blue)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <ArrowLeft size={16} /> Back to Service Board
                </button>
              </div>

              <div>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--v10-ink-strong)" }}>
                  {selectedVehicle.vehicleName}
                </h2>
                <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--v10-support)" }}>
                  Stock #{selectedVehicle.stockNumber} · {selectedVehicle.vin}
                </p>
              </div>

              {loadingDetail ? (
                <p style={{ fontSize: "13px", color: "var(--v10-support)" }}>Loading history…</p>
              ) : (
                <form onSubmit={handleDrawerSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--v10-support)", marginBottom: "4px" }}>
                      Service Stage
                    </label>
                    <select
                      value={drawerStatus}
                      onChange={(e) => setDrawerStatus(e.target.value as ServiceWorkflowStatus)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "var(--radius-control, 6px)",
                        border: "1px solid var(--v10-border)",
                        fontSize: "13px",
                        background: "var(--v10-surface)",
                        color: "var(--v10-ink)",
                      }}
                    >
                      <option value="needs_service">Waiting for service</option>
                      <option value="in_service">In service</option>
                      <option value="serviced">Ready for delivery</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--v10-support)", marginBottom: "4px" }}>
                      Effective Date
                    </label>
                    <input
                      type="date"
                      value={drawerDate}
                      onChange={(e) => setDrawerDate(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "var(--radius-control, 6px)",
                        border: "1px solid var(--v10-border)",
                        fontSize: "13px",
                        background: "var(--v10-surface)",
                        color: "var(--v10-ink)",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--v10-support)", marginBottom: "4px" }}>
                      Technician & Service Notes
                    </label>
                    <textarea
                      rows={3}
                      value={drawerNotes}
                      onChange={(e) => setDrawerNotes(e.target.value)}
                      placeholder="Enter work completed or handoff instructions..."
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "var(--radius-control, 6px)",
                        border: "1px solid var(--v10-border)",
                        fontSize: "13px",
                        background: "var(--v10-surface)",
                        color: "var(--v10-ink)",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <button
                      type="submit"
                      disabled={savingDrawer}
                      className="service-v2-action-btn service-v2-btn-start"
                      style={{ flex: 1, padding: "8px 14px", fontSize: "13px" }}
                    >
                      {savingDrawer ? "Saving…" : "Save Changes"}
                    </button>
                    <button
                      type="button"
                      disabled={savingDrawer}
                      className="service-v2-action-btn service-v2-btn-details"
                      onClick={() => selectVin(null)}
                      style={{ padding: "8px 14px", fontSize: "13px" }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* History log */}
              {detail?.history && detail.history.length > 0 && (
                <div style={{ marginTop: "16px", borderTop: "1px solid var(--v10-border-soft)", paddingTop: "14px" }}>
                  <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--v10-ink-strong)", margin: "0 0 8px 0" }}>
                    Status History
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {detail.history.map((h, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: "12px",
                          background: "var(--v10-surface-subtle)",
                          padding: "8px 10px",
                          borderRadius: "4px",
                          border: "1px solid var(--v10-border-soft)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                          <span>{serviceStatusLabel(h)}</span>
                          <span style={{ color: "var(--v10-support)" }}>{displayDate(h.updatedAt)}</span>
                        </div>
                        {h.updatedBy && <div style={{ color: "var(--v10-support)" }}>By {h.updatedBy}</div>}
                        {h.notes && <p style={{ margin: "4px 0 0 0", color: "var(--v10-ink)" }}>{h.notes}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
