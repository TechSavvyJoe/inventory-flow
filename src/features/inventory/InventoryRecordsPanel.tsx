import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ChevronLeft, ChevronRight, FileText, X } from "lucide-react";
import { useContainedFocus } from "../../lib/useContainedFocus";
import { useModalBackgroundIsolation } from "../../lib/useModalBackgroundIsolation";
import { VehicleResourceCards } from "./VehicleResourceCards";
import { formatMoney, vehicleDisplayName } from "./inventory-utils";
import { vehicleOverviewResources } from "./vehicle-resource-catalog";
import type { InventoryVehicle } from "./types";
import "./InventoryRecordsPanel.css";

export interface InventoryRecordsPanelProps {
  vehicle: InventoryVehicle;
  vehicles: InventoryVehicle[];
  onVehicleChange: (id: string) => void;
  onClose: () => void;
  onOpenWorkspace: (vehicle: InventoryVehicle) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const MOBILE_QUERY = "(max-width: 760px)";

function subscribeToMobile(onChange: () => void) {
  const media = typeof window !== "undefined" ? window.matchMedia?.(MOBILE_QUERY) : undefined;
  if (!media) return () => undefined;
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }
  media.addListener?.(onChange);
  return () => media.removeListener?.(onChange);
}

function mobileSnapshot() {
  return typeof window !== "undefined" && (window.matchMedia?.(MOBILE_QUERY).matches ?? false);
}

/** A persistent inspector; changing vehicles replaces its contents, never the list. */
export function InventoryRecordsPanel({
  vehicle,
  vehicles,
  onVehicleChange,
  onClose,
  onOpenWorkspace,
  returnFocusRef,
}: InventoryRecordsPanelProps) {
  const mobile = useSyncExternalStore(subscribeToMobile, mobileSnapshot, () => false);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLElement>(null);
  const fallbackReturnFocusRef = useRef<HTMLElement>(null);
  const openingWorkspaceRef = useRef(false);
  const closeCallbackRef = useRef(onClose);
  const titleId = useId();
  const headingId = useId();
  const name = vehicleDisplayName(vehicle);
  const index = vehicles.findIndex(candidate => candidate.id === vehicle.id);
  const previous = index > 0 ? vehicles[index - 1] : undefined;
  const next = index >= 0 ? vehicles[index + 1] : undefined;
  const hasResources = vehicleOverviewResources(vehicle).some(resource => resource.href || resource.hasCapturedData);

  useEffect(() => { closeCallbackRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    // The inspector is a body portal, so isolating the app root cannot hide it.
    backgroundRef.current = document.getElementById("root");
    if (!fallbackReturnFocusRef.current && document.activeElement instanceof HTMLElement) {
      fallbackReturnFocusRef.current = document.activeElement;
    }
  }, []);

  useModalBackgroundIsolation({ active: mobile, backgroundRef });
  useContainedFocus({
    active: mobile,
    contain: true,
    containerRef: panelRef,
    initialFocusRef: closeRef,
    returnFocusRef: returnFocusRef ?? fallbackReturnFocusRef,
    onEscape: onClose,
  });

  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>(".app-shell .top-bar");
    const positionBelowHeader = () => {
      const bottom = header?.getBoundingClientRect().bottom;
      const top = bottom != null && bottom > 0 ? bottom + 10 : 88;
      panelRef.current?.style.setProperty("--inventory-records-top", `${Math.max(16, top)}px`);
    };
    positionBelowHeader();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(positionBelowHeader) : null;
    if (header) observer?.observe(header);
    window.addEventListener("resize", positionBelowHeader);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", positionBelowHeader);
    };
  }, []);

  useLayoutEffect(() => {
    openingWorkspaceRef.current = false;
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [vehicle.id, vehicle.vin]);

  useLayoutEffect(() => {
    if (mobile) return;
    const panel = panelRef.current;
    if (!panel) return;
    // The committed inspector can receive Escape before an animation frame.
    // Establish keyboard ownership before paint rather than opening a window
    // where the panel is visible but focus still belongs to its launcher.
    closeRef.current?.focus({ preventScroll: true });
    let ownedFocus = panel.contains(document.activeElement);
    const trackFocus = (event: FocusEvent) => {
      ownedFocus = event.target instanceof Node && panel.contains(event.target);
    };
    const handleEscape = (event: KeyboardEvent) => {
      // A nonmodal inspector does not intercept Escape from inventory controls
      // or from a workspace opened above it.
      if (event.key !== "Escape" || event.defaultPrevented || !panel.contains(document.activeElement)) return;
      const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
      if (modal && !panel.contains(modal)) return;
      event.preventDefault();
      event.stopPropagation();
      closeCallbackRef.current();
    };
    document.addEventListener("focusin", trackFocus);
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("focusin", trackFocus);
      document.removeEventListener("keydown", handleEscape, true);
      const active = document.activeElement;
      const shouldRestore = panel.contains(active) || (ownedFocus && (!active || active === document.body));
      if (!shouldRestore || openingWorkspaceRef.current || document.querySelector('[aria-modal="true"]')) return;
      const target = returnFocusRef?.current ?? fallbackReturnFocusRef.current;
      const restore = () => {
        if (!target?.isConnected || target.closest('[inert], [hidden]') || !target.getClientRects().length) return;
        // Leave a new user selection or a newly opened workspace in control.
        const current = document.activeElement;
        if (current && current !== document.body && current !== target && !panel.contains(current)) return;
        target.focus({ preventScroll: true });
      };
      restore();
      // StrictMode rehearses cleanup while the same inspector is mounted.
      // A restoration retry belongs to a removed panel, not that rehearsal.
      window.requestAnimationFrame(() => {
        if (!panel.isConnected) restore();
      });
    };
  }, [mobile, returnFocusRef]);

  const openWorkspace = () => {
    openingWorkspaceRef.current = true;
    onOpenWorkspace(vehicle);
  };

  return createPortal(<>
    <div className={`inventory-records-backdrop${mobile ? "" : " inventory-records-backdrop--nonmodal"}`} aria-hidden="true" onClick={onClose} />
    <aside className="inventory-records-panel" ref={panelRef} role="dialog" aria-modal={mobile}
      aria-label={`${name} records`} tabIndex={-1} data-vehicle-id={vehicle.id}>
      <header className="inventory-records-panel__header">
        <div className="inventory-records-panel__heading"><span id={headingId}>Vehicle records</span><button ref={closeRef} type="button" onClick={onClose} aria-label="Close records"><X size={19} aria-hidden="true" /></button></div>
        <h2 id={titleId} aria-live="polite">{name}</h2>
        <div className="inventory-records-panel__identity"><span>Stock <strong>{vehicle.stockNumber}</strong></span><b>{formatMoney(vehicle.price)}</b></div>
        <nav className="inventory-records-panel__vehicles" aria-label="Browse visible vehicles">
          <button type="button" disabled={!previous} onClick={() => previous && onVehicleChange(previous.id)} aria-label="Previous vehicle"><ChevronLeft size={16} aria-hidden="true" />Previous</button>
          <span aria-live="polite">{index >= 0 ? `${index + 1} of ${vehicles.length}` : "Vehicle records"}</span>
          <button type="button" disabled={!next} onClick={() => next && onVehicleChange(next.id)} aria-label="Next vehicle">Next<ChevronRight size={16} aria-hidden="true" /></button>
        </nav>
      </header>
      <div className="inventory-records-panel__content" ref={contentRef}>
        {hasResources ? <VehicleResourceCards key={`${vehicle.id}:${vehicle.vin}`} vehicle={vehicle} variant="preview" summaryLimit={6} onOpenSection={openWorkspace} />
          : <div className="inventory-records-panel__empty"><FileText size={23} strokeWidth={1.6} aria-hidden="true"/><strong>No records available</strong><p>Vehicle details are available in the full vehicle workspace.</p></div>}
      </div>
      <footer className="inventory-records-panel__footer"><button type="button" onClick={openWorkspace}>Full vehicle<ArrowRight size={17} aria-hidden="true" /></button></footer>
    </aside>
  </>, document.body);
}
