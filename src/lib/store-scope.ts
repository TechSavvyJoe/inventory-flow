/** Shared store-scope values for workflow pages. Inventory, Attention, Moves,
 *  and Overview already use home/group; Service historically used my_store/all. */
export type StoreScope = "home" | "group";

const LEGACY: Record<string, StoreScope> = {
  home: "home",
  group: "group",
  my_store: "home",
  all: "group",
};

/** Accept canonical and legacy Service URL/workspace values. */
export function parseStoreScope(raw: string | null | undefined): StoreScope | null {
  if (raw == null) return null;
  return LEGACY[raw] ?? null;
}

export function isGroupScope(scope: StoreScope): boolean {
  return scope === "group";
}

/** Visible group-side label. Inventory keeps “All locations”; other ledgers use “All stores”. */
export function groupScopeLabel(surface: "inventory" | "workflow" = "workflow"): string {
  return surface === "inventory" ? "All locations" : "All stores";
}
