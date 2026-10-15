import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';

const PREFERENCE_KEY = 'inventory-flow.inventory-detail-density';
function savedExpansion() {
  try { return localStorage.getItem(PREFERENCE_KEY) === 'expanded'; } catch { return false; }
}
type ExpansionState = {
  defaultExpanded: boolean;
  overrides: Record<string, boolean>;
  toggle: (vin: string) => void;
  setAll: (expanded: boolean) => void;
};
const InventoryExpansionContext = createContext<ExpansionState | null>(null);

/** Only the global presentation preference persists; VIN overrides leave with the surface. */
export function InventoryExpansionProvider({ children }: { children: ReactNode }) {
  const [defaultExpanded, setDefaultExpanded] = useState(savedExpansion);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const state = useMemo<ExpansionState>(() => ({
    defaultExpanded, overrides,
    toggle: vin => setOverrides(current => ({ ...current, [vin]: !(current[vin] ?? defaultExpanded) })),
    setAll: expanded => {
      setDefaultExpanded(expanded);
      setOverrides({});
      try { localStorage.setItem(PREFERENCE_KEY, expanded ? 'expanded' : 'collapsed'); } catch { /* The view still works without storage. */ }
    },
  }), [defaultExpanded, overrides]);
  return <InventoryExpansionContext.Provider value={state}>{children}</InventoryExpansionContext.Provider>;
}

export function useInventoryExpansion(vin: string) {
  const state = useContext(InventoryExpansionContext);
  const [localExpanded, setLocalExpanded] = useState(savedExpansion);
  return {
    expanded: state ? state.overrides[vin] ?? state.defaultExpanded : localExpanded,
    toggle: () => state ? state.toggle(vin) : setLocalExpanded(current => !current),
  };
}

export function InventoryExpansionControl({ className }: { className?: string }) {
  const state = useContext(InventoryExpansionContext);
  if (!state) return null;
  const allExpanded = state.defaultExpanded && Object.values(state.overrides).every(Boolean);
  const Icon = allExpanded ? ChevronsDownUp : ChevronsUpDown;
  return <button type="button" className={className} aria-label={`${allExpanded ? 'Collapse' : 'Expand'} all vehicle details`} onClick={() => state.setAll(!allExpanded)}>
    <Icon size={16} aria-hidden="true"/><span>{allExpanded ? 'Collapse all' : 'Expand all'}</span>
  </button>;
}
