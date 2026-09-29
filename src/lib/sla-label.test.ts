import { describe, expect, it } from 'vitest'
import { isReturnOverdue, slaLabel, slaState } from './sla-label'

const NOW = Date.parse('2026-09-01T12:00:00Z')

describe('slaLabel', () => {
  it('classifies due times once, keeping "breached" only as a rank', () => {
    expect(slaState(undefined, NOW)).toBe('none')
    expect(slaState('not a date', NOW)).toBe('none')
    expect(slaState('2026-09-01T14:00:00Z', NOW)).toBe('on-track')
    expect(slaState('2026-09-01T12:30:00Z', NOW)).toBe('due-soon')
    expect(slaState('2026-09-01T11:30:00Z', NOW)).toBe('overdue')
    expect(slaState('2026-08-31T12:00:00Z', NOW)).toBe('breached')
    expect(slaLabel({ sla: 'breached' }).label).toBe('Overdue')
  })

  it('is urgent only for the store that owns the next step', () => {
    expect(slaLabel({ sla: 'overdue', nextActionStore: 'Howell', viewerStore: 'Howell' }))
      .toMatchObject({ tone: 'danger', label: 'Overdue', ownedByViewer: true })
    expect(slaLabel({ sla: 'overdue', nextActionStore: 'Fowlerville', nextActionOwner: 'Fowlerville sales', viewerStore: 'Howell' }))
      .toMatchObject({ tone: 'neutral', label: 'Overdue · waiting on Fowlerville salesperson', ownedByViewer: false })
    expect(slaLabel({ sla: 'overdue', nextActionStore: 'Fowlerville', nextActionOwner: 'Synthetic Salesperson', viewerStore: 'Howell' }).label)
      .toBe('Overdue · waiting on Synthetic Salesperson at Fowlerville')
    expect(slaLabel({ sla: 'overdue', nextActionStore: 'Lincoln', nextActionOwner: 'Unassigned', viewerStore: 'Howell' }).label)
      .toBe('Overdue · waiting on Lincoln')
    // An unpublished owner keeps the conservative, urgent reading.
    expect(slaLabel({ sla: 'overdue', viewerStore: 'Howell' })).toMatchObject({ tone: 'danger', ownedByViewer: null })
    expect(slaLabel({ sla: 'due-soon', nextActionStore: 'Fowlerville', viewerStore: 'Howell' })).toMatchObject({ tone: 'warning', label: 'Due soon' })
  })
})

describe('isReturnOverdue', () => {
  const base = { requestStatus: 'customer_showing', movementStatus: 'at_requesting_store', returnRequired: true, returnDueAt: '2026-08-31T12:00:00Z' }
  it('mirrors the server store-summary rule, pausing sold-pending and delivered moves', () => {
    expect(isReturnOverdue(base, NOW)).toBe(true)
    expect(isReturnOverdue({ ...base, requestStatus: 'sale_confirmed' }, NOW)).toBe(false)
    expect(isReturnOverdue({ ...base, requestStatus: 'delivery_confirmed' }, NOW)).toBe(false)
    expect(isReturnOverdue({ ...base, requestStatus: 'not_sold' }, NOW)).toBe(true)
    expect(isReturnOverdue({ ...base, movementStatus: 'returned_home' }, NOW)).toBe(false)
    expect(isReturnOverdue({ ...base, requestStatus: 'closed' }, NOW)).toBe(false)
    expect(isReturnOverdue({ ...base, requestStatus: 'canceled' }, NOW)).toBe(false)
    expect(isReturnOverdue({ ...base, returnRequired: false }, NOW)).toBe(false)
    expect(isReturnOverdue({ ...base, returnDueAt: '2026-09-02T12:00:00Z' }, NOW)).toBe(false)
  })
})

describe('isReturnOverdue time basis', () => {
  it('claims nothing overdue without a usable time', () => {
    expect(isReturnOverdue({ requestStatus: 'customer_showing', returnRequired: true, returnDueAt: '2026-08-31T12:00:00Z' }, Number.NaN)).toBe(false)
  })
})
