import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error The companion remains unbundled JavaScript.
import { createCustomerListSession } from '../../extension/sidepanel/lib/customer-lists.mjs'

const list = (revision = 1) => ({ id: 'list-one', label: 'Customer initials', revision, createdAt: '2026-09-30', updatedAt: '2026-09-30', items: [{ vin: 'TESTDATAHWELL0001', addedAt: '2026-09-30', available: true }] })

describe('companion customer lists', () => {
  it('finishes saving the requested vehicle after an uncertain first-list creation', async () => {
    const emptyList = { ...list(), items: [] }
    const write = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(emptyList).mockResolvedValueOnce(list(2))
    const session = createCustomerListSession({ read: async () => ({ lists: [] }), write })
    await session.refresh()
    expect(await session.toggle('TESTDATAHWELL0001')).toBe(false)
    expect(await session.retry()).toBe(true)
    expect(write.mock.calls[1]).toEqual(write.mock.calls[0])
    expect(write.mock.calls[2][0]).toEqual({ action: 'add', listId: 'list-one', expectedRevision: 1, vin: 'TESTDATAHWELL0001' })
    expect(session.active().items).toHaveLength(1)
  })
  it('keeps an uncertain action attached to its original customer list', async () => {
    const session = createCustomerListSession({ read: async () => ({ lists: [list(), { ...list(), id: 'list-two' }] }), write: vi.fn().mockRejectedValue(new Error('timeout')) })
    await session.refresh(); await session.mutate('rename', { label: 'Updated initials' })
    session.select('list-two')
    expect(session.active().id).toBe('list-one')
  })
  it('retains confirmed references through a temporary refresh failure', async () => {
    const read = vi.fn().mockResolvedValueOnce({ lists: [list()] }).mockRejectedValueOnce(new Error('network'))
    const session = createCustomerListSession({ read, write: vi.fn() })
    await session.refresh(); await session.refresh()
    expect(session.active()?.items).toHaveLength(1)
    expect(session.snapshot.error).toContain('last confirmed list')
  })
  it('discards a response from the previous employee context', async () => {
    let resolve!: (value: unknown) => void
    const session = createCustomerListSession({ read: () => new Promise(done => { resolve = done }), write: vi.fn() })
    const pending = session.refresh(); session.reset(); resolve({ lists: [list()] }); await pending
    expect(session.snapshot.lists).toEqual([])
  })
  it('clears private references immediately when access is revoked', async () => {
    const read = vi.fn().mockResolvedValueOnce({ lists: [list()] }).mockRejectedValueOnce({ status: 403 })
    const session = createCustomerListSession({ read, write: vi.fn() })
    await session.refresh(); await session.refresh()
    expect(session.snapshot.lists).toEqual([])
    expect(session.snapshot.error).toContain('Sign in')
  })
  it('retries an uncertain mutation with the same idempotency key and payload', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(list(2))
    const session = createCustomerListSession({ read: async () => ({ lists: [list()] }), write })
    await session.refresh(); await session.mutate('rename', { label: 'New initials' })
    expect(session.active().label).toBe('Customer initials')
    await session.retry()
    expect(write.mock.calls[1]).toEqual(write.mock.calls[0])
    expect(session.snapshot.pending).toBeNull()
  })
  it('never lets an old refresh replace a newer confirmed write', async () => {
    let resolve!: (value: unknown) => void
    const read = vi.fn().mockResolvedValueOnce({ lists: [list()] }).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const session = createCustomerListSession({ read, write: async () => list(2) })
    await session.refresh(); const pending = session.refresh(); await session.mutate('add', { vin: 'TESTDATAHWELL0002' })
    resolve({ lists: [list(1)] }); await pending
    expect(session.active().revision).toBe(2)
  })
  it('refreshes a conflict without silently reapplying an action to another device’s list', async () => {
    const write = vi.fn().mockRejectedValue({ status: 409 })
    const read = vi.fn().mockResolvedValueOnce({ lists: [list()] }).mockResolvedValueOnce({ lists: [list(3)] })
    const session = createCustomerListSession({ read, write })
    await session.refresh(); expect(await session.mutate('remove', { vin: 'TESTDATAHWELL0001' })).toBe(false)
    expect(session.active().revision).toBe(3); expect(write).toHaveBeenCalledTimes(1)
    expect(session.snapshot.pending).toBeNull()
  })
})
