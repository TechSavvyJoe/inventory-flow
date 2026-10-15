import { describe, expect, it } from 'vitest'
import { emptyFilterResetLabel, WORKFLOW_RESET_LABELS } from '../../src/lib/workflow-view-reset'

describe('workflow empty-state reset labels', () => {
  it('names the reset for search, filters, or both without mentioning store scope', () => {
    expect(emptyFilterResetLabel({ query: '', filtersActive: false })).toBe(WORKFLOW_RESET_LABELS.clearFilters)
    expect(emptyFilterResetLabel({ query: '  Bronco  ', filtersActive: false })).toBe(WORKFLOW_RESET_LABELS.clearSearch)
    expect(emptyFilterResetLabel({ query: 'Bronco', filtersActive: true })).toBe(WORKFLOW_RESET_LABELS.clearSearchAndFilters)
    expect(emptyFilterResetLabel({ query: '', filtersActive: true })).toBe(WORKFLOW_RESET_LABELS.clearFilters)
  })

  it('keeps store expansion wording distinct from inventory location expansion', () => {
    expect(WORKFLOW_RESET_LABELS.viewAllStores).toBe('View all stores')
    expect(WORKFLOW_RESET_LABELS.viewAllLocations).toBe('View all locations')
    expect(WORKFLOW_RESET_LABELS.resetView).toBe('Reset view')
  })
})
