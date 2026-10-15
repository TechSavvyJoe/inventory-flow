import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { InventoryVehicle } from "./types";

export interface ShortlistEntry {
  id: string;
  vin: string;
  stockNumber: string;
  displayName: string;
  price: number | null;
  imageUrl: string | null;
  exteriorColor: string | null;
  addedAt: number;
  available?: boolean;
}

export interface SyncedShortlistSummary {
  id: string;
  label: string;
  count: number;
}

export interface SavedListSheetSnapshot {
  listId: string;
  label: string;
  vehicles: InventoryVehicle[];
  refreshedAt: number;
  unavailableCount: number;
}

export interface ShortlistManagement {
  lists: SyncedShortlistSummary[];
  activeListId: string | null;
  activeLabel: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastConfirmedAt: number | null;
  pendingAction: boolean;
  accessRevoked: boolean;
  readyForWrites: boolean;
  pendingSave?: { vin: string; displayName: string; stockNumber: string; namingExistingList: boolean; namingListId?: string | null } | null;
  savePendingToNamedList?: (label: string) => Promise<boolean>;
  savePendingToExistingList?: (id: string) => Promise<boolean>;
  cancelPendingSave?: () => void;
  addVehicleToActiveList?: (vin: string) => Promise<boolean>;
  prepareCustomerSheet?: (listId?: string) => Promise<SavedListSheetSnapshot | null>;
  preparingSheet?: boolean;
  selectList: (id: string) => void;
  createList: (label: string) => Promise<boolean>;
  renameActiveList: (label: string) => Promise<boolean>;
  deleteActiveList: () => Promise<boolean>;
  retry: () => void;
}

// Browser memory only. Selection belongs to the authenticated user, role and
// store; no vehicle snapshot or customer interest is restored from localStorage.
const EMPTY: ShortlistEntry[] = [];
let activeContext = "";
let entries: ShortlistEntry[] = EMPTY;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
function publish(next: ShortlistEntry[]) {
  entries = next;
  listeners.forEach(listener => listener());
}
export function clearCustomerShortlist() {
  activeContext = "";
  publish(EMPTY);
}

function adoptContext(next: string) {
  if (activeContext === next) return;
  activeContext = next;
  publish(EMPTY);
}

function vehicleEntry(vehicle: InventoryVehicle, addedAt = Date.now()): ShortlistEntry {
  return {
    id: vehicle.id, vin: vehicle.vin, stockNumber: vehicle.stockNumber,
    displayName: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
    price: vehicle.price ?? null, imageUrl: vehicle.imageUrl || vehicle.imageUrls?.[0] || null,
    exteriorColor: vehicle.exteriorColor || null, addedAt,
  };
}

export interface ShortlistContextValue {
  context: string;
  entries: ShortlistEntry[];
  ids: Set<string>;
  count: number;
  isShortlisted: (vehicle: InventoryVehicle | string) => boolean;
  toggle: (vehicle: InventoryVehicle) => void;
  add: (vehicle: InventoryVehicle) => void;
  remove: (id: string) => void;
  clear: () => void;
  management?: ShortlistManagement;
}
export const ShortlistContext = createContext<ShortlistContextValue | null>(null);

export function useCustomerShortlist(accessContext?: string, authorizedVehicles?: InventoryVehicle[]): ShortlistContextValue {
  const inherited = useContext(ShortlistContext);
  const context = accessContext ?? inherited?.context ?? "standalone";
  // Reset in layout so paint never shows another context's vehicles, without
  // mutating module state during render (unsafe under concurrent React).
  useLayoutEffect(() => {
    adoptContext(context);
  }, [context]);
  const snapshot = useCallback(() => activeContext === context ? entries : EMPTY, [context]);
  const stored = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const visible = useMemo(() => {
    if (!authorizedVehicles) return stored;
    const vehicles = new Map(authorizedVehicles.map(vehicle => [vehicle.id, vehicle]));
    return stored.flatMap(entry => {
      const vehicle = vehicles.get(entry.id);
      return vehicle ? [vehicleEntry(vehicle, entry.addedAt)] : [];
    });
  }, [authorizedVehicles, stored]);
  // Prune gone/withheld vehicles and refresh prices from the current projection.
  useEffect(() => {
    if (activeContext === context && authorizedVehicles && JSON.stringify(visible) !== JSON.stringify(stored)) publish(visible);
  }, [authorizedVehicles, context, stored, visible]);
  const ids = useMemo(() => new Set(visible.map(entry => entry.id)), [visible]);
  const isShortlisted = useCallback((vehicle: InventoryVehicle | string) => ids.has(typeof vehicle === "string" ? vehicle : vehicle.id), [ids]);
  const toggle = useCallback((vehicle: InventoryVehicle) => {
    if (activeContext !== context) return;
    publish(entries.some(entry => entry.id === vehicle.id)
      ? entries.filter(entry => entry.id !== vehicle.id)
      : [...entries, vehicleEntry(vehicle)]);
  }, [context]);
  const add = useCallback((vehicle: InventoryVehicle) => {
    if (activeContext === context && !entries.some(entry => entry.id === vehicle.id)) publish([...entries, vehicleEntry(vehicle)]);
  }, [context]);
  const remove = useCallback((id: string) => {
    if (activeContext === context) publish(entries.filter(entry => entry.id !== id));
  }, [context]);
  const clear = useCallback(() => { if (activeContext === context) publish(EMPTY); }, [context]);
  return inherited ?? { context, entries: visible, ids, count: visible.length, isShortlisted, toggle, add, remove, clear };
}

export function useShortlistContext(): ShortlistContextValue {
  const value = useContext(ShortlistContext);
  if (!value) throw new Error("useShortlistContext must be used within a ShortlistContext.Provider");
  return value;
}
