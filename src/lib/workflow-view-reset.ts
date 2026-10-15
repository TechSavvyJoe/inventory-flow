/**
 * Shared empty-state reset labels for list workflows.
 * Keep Inventory's location wording separate from store-scope expansion.
 */
export const WORKFLOW_RESET_LABELS = Object.freeze({
  clearSearch: 'Clear search',
  clearFilters: 'Clear filters',
  clearSearchAndFilters: 'Clear search and filters',
  resetView: 'Reset view',
  viewAllStores: 'View all stores',
  viewAllLocations: 'View all locations',
})

/**
 * Primary empty-state reset label when a page can clear search and/or filters.
 * Scope expansion stays a separate button with `viewAllStores` / `viewAllLocations`.
 */
export function emptyFilterResetLabel({
  query,
  filtersActive,
}: {
  query: string
  filtersActive: boolean
}): string {
  const hasQuery = Boolean(query.trim())
  if (hasQuery && filtersActive) return WORKFLOW_RESET_LABELS.clearSearchAndFilters
  if (hasQuery) return WORKFLOW_RESET_LABELS.clearSearch
  return WORKFLOW_RESET_LABELS.clearFilters
}
