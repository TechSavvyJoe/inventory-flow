import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { InventoryVehicle } from "./types";

/* ─── Storage key ──────────────────────────────────────────────── */
const STORAGE_KEY = "inventory:customer-shortlist";

/* ─── Shortlist entry (lightweight snapshot) ───────────────────── */
export interface ShortlistEntry {
  id: string;
  vin: string;
  stockNumber: string;
  displayName: string;
  price: number | null;
  imageUrl: string | null;
  exteriorColor: string | null;
  addedAt: number; // epoch ms
}

/* ─── External store (shared singleton) ────────────────────────── */
let listeners: Set<() => void> = new Set();
let cache: ShortlistEntry[] | null = null;

function readStore(): ShortlistEntry[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as ShortlistEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function writeStore(entries: ShortlistEntry[]) {
  cache = entries;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota exceeded – keep in-memory */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ShortlistEntry[] {
  return readStore();
}

/* ─── Helpers ──────────────────────────────────────────────────── */
function vehicleToEntry(vehicle: InventoryVehicle): ShortlistEntry {
  return {
    id: vehicle.id,
    vin: vehicle.vin,
    stockNumber: vehicle.stockNumber,
    displayName: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
    price: vehicle.price ?? null,
    imageUrl: vehicle.imageUrl || vehicle.imageUrls?.[0] || null,
    exteriorColor: vehicle.exteriorColor || null,
    addedAt: Date.now(),
  };
}

/* ─── Hook ─────────────────────────────────────────────────────── */
export function useCustomerShortlist() {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const ids = useMemo(() => new Set(entries.map((e) => e.id)), [entries]);

  const isShortlisted = useCallback(
    (vehicleOrId: InventoryVehicle | string): boolean => {
      const id = typeof vehicleOrId === "string" ? vehicleOrId : vehicleOrId.id;
      return ids.has(id);
    },
    [ids],
  );

  const toggle = useCallback(
    (vehicle: InventoryVehicle) => {
      const current = readStore();
      const existing = current.findIndex((e) => e.id === vehicle.id);
      if (existing >= 0) {
        writeStore(current.filter((_, i) => i !== existing));
      } else {
        writeStore([...current, vehicleToEntry(vehicle)]);
      }
    },
    [],
  );

  const add = useCallback((vehicle: InventoryVehicle) => {
    const current = readStore();
    if (current.some((e) => e.id === vehicle.id)) return;
    writeStore([...current, vehicleToEntry(vehicle)]);
  }, []);

  const remove = useCallback((vehicleId: string) => {
    writeStore(readStore().filter((e) => e.id !== vehicleId));
  }, []);

  const clear = useCallback(() => {
    writeStore([]);
  }, []);

  return { entries, ids, isShortlisted, toggle, add, remove, clear, count: entries.length } as const;
}

/* ─── Context (optional, for deep prop-drilling avoidance) ───── */
export type ShortlistContextValue = ReturnType<typeof useCustomerShortlist>;
export const ShortlistContext = createContext<ShortlistContextValue | null>(null);

export function useShortlistContext(): ShortlistContextValue {
  const ctx = useContext(ShortlistContext);
  if (!ctx) throw new Error("useShortlistContext must be used within a ShortlistContext.Provider");
  return ctx;
}
