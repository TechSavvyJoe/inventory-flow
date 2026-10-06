import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error The companion remains unbundled JavaScript.
import { createCustomerListSession as createSession, customerListWritesReady } from '../../extension/sidepanel/lib/customer-lists.mjs'

const createCustomerListSession = (options: Record<string, unknown>) => createSession({ ownerId: 'synthetic-owner-a', ...options })

const list = (revision = 1) => ({ id: 'list-one', label: 'Customer initials', revision, createdAt: '2026-09-30', updatedAt: '2026-09-30', items: [{ vin: 'TESTDATAHWELL0001', addedAt: '2026-09-30', available: true }] })

describe('companion customer lists', () => {
  it('clears labels and references immediately on owner change even if the next refresh fails', async () => {
    const read = vi.fn().mockResolvedValueOnce({ lists:[list()] }).mockRejectedValueOnce(new Error('offline'))
    const session = createCustomerListSession({ read, write:vi.fn() })
    await session.refresh()
    expect(session.active()?.label).toBe('Customer initials')
    session.setOwner('synthetic-owner-b')
    expect(session.snapshot.lists).toEqual([])
    expect(session.snapshot.readyForWrites).toBe(false)
    await session.refresh()
    expect(session.snapshot.lists).toEqual([])
    expect(read.mock.calls.map(call => call[0])).toEqual(['synthetic-owner-a', 'synthetic-owner-b'])
  })

  it('drops late owner reads and mutations including a pending create continuation', async () => {
    let finishRead!: (value: unknown) => void, finishWrite!: (value: unknown) => void
    const read = vi.fn().mockResolvedValueOnce({ lists:[] }).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve })).mockResolvedValueOnce({ lists:[] })
    const write = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => new Promise(resolve => { finishWrite = resolve }))
    const session = createCustomerListSession({ read, write })
    await session.refresh()
    const pendingRead = session.refresh()
    await session.toggle('TESTDATAHWELL0001')
    const pendingWrite = session.saveNamed('AB')
    expect(write.mock.calls[0][2]).toBe('synthetic-owner-a')
    session.setOwner('synthetic-owner-b')
    await session.refresh()
    finishRead({ lists:[list()] }); finishWrite({ ...list(), items:[] })
    await Promise.all([pendingRead, pendingWrite])
    expect(session.snapshot.lists).toEqual([])
    expect(session.snapshot.pending).toBeNull()
    expect(write).toHaveBeenCalledOnce()
  })

  it('does not fetch or mutate customer lists without an owner identity', async () => {
    const read = vi.fn(), write = vi.fn()
    const session = createCustomerListSession({ ownerId:null, read, write })
    await session.refresh()
    expect(await session.mutate('create', { label:'AB' })).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('blocks every write while the initial saved-list read is pending', async () => {
    let finishRead!: (value: unknown) => void
    const write = vi.fn().mockResolvedValue({ ...list(), items: [] })
    const session = createCustomerListSession({ read: () => new Promise(resolve => { finishRead = resolve }), write })
    const pending = session.refresh()
    expect(customerListWritesReady(session.snapshot)).toBe(false)
    expect(await session.mutate('create', { label: 'AB' })).toBe(false)
    expect(await session.toggle('TESTDATAHWELL0002')).toBe(false)
    expect(write).not.toHaveBeenCalled()
    finishRead({ lists: [] }); await pending
    expect(customerListWritesReady(session.snapshot)).toBe(true)
    expect(await session.mutate('create', { label: 'AB' })).toBe(true)
  })
  it('keeps writes blocked after an initial failure until Retry confirms the read', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ lists: [] })
    const write = vi.fn().mockResolvedValue({ ...list(), items: [] })
    const session = createCustomerListSession({ read, write })
    await session.refresh()
    expect(session.snapshot.readyForWrites).toBe(false)
    expect(await session.mutate('create', { label: 'AB' })).toBe(false)
    expect(write).not.toHaveBeenCalled()
    await session.retry()
    expect(session.snapshot.readyForWrites).toBe(true)
    expect(await session.mutate('create', { label: 'AB' })).toBe(true)
    expect(write).toHaveBeenCalledOnce()
  })
  it('finishes saving the requested vehicle after an uncertain first-list creation', async () => {
    const emptyList = { ...list(), items: [] }
    const write = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(emptyList).mockResolvedValueOnce(list(2))
    const session = createCustomerListSession({ read: async () => ({ lists: [] }), write })
    await session.refresh()
    expect(await session.toggle('TESTDATAHWELL0001')).toBe(false)
    expect(await session.saveNamed('AB')).toBe(false)
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
    const write = vi.fn().mockResolvedValue({ ...list(2), label: 'Updated initials' })
    const session = createCustomerListSession({ read, write })
    await session.refresh(); await session.refresh()
    expect(session.active()?.items).toHaveLength(1)
    expect(session.snapshot.error).toContain('last confirmed list')
    expect(session.snapshot.readyForWrites).toBe(true)
    expect(await session.mutate('rename', { label: 'Updated initials' })).toBe(true)
    expect(write).toHaveBeenCalledOnce()
  })
  it('discards a response from the previous employee context', async () => {
    let resolve!: (value: unknown) => void
    const session = createCustomerListSession({ read: () => new Promise(done => { resolve = done }), write: vi.fn() })
    const pending = session.refresh(); session.reset(); resolve({ lists: [list()] }); await pending
    expect(session.snapshot.lists).toEqual([])
    expect(session.snapshot.readyForWrites).toBe(false)
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
  it.each([
    ['email', 'customer@example.com'],
    ['URL', 'https://example.com/customer'],
    ['phone-like digits', 'Call 5551234'],
  ])('rejects a %s label before create or rename reaches the transport', async (_kind, labelValue) => {
    const write = vi.fn()
    const session = createCustomerListSession({ read: async () => ({ lists: [list()] }), write })
    await session.refresh()
    expect(await session.mutate('create', { label: labelValue })).toBe(false)
    expect(await session.mutate('rename', { label: labelValue })).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(session.snapshot.error).toContain('without contact information')
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
  it('asks for a name before first save and cancel creates nothing', async () => {
    const write = vi.fn()
    const session = createCustomerListSession({ read:async () => ({ lists:[] }), write })
    await session.refresh(); await session.toggle('TESTDATAHWELL0001')
    expect(session.snapshot.naming).toEqual({ vin:'TESTDATAHWELL0001', renamingId:null })
    expect(write).not.toHaveBeenCalled()
    session.cancelNaming()
    expect(session.snapshot.naming).toBeNull()
  })
  it('names a legacy generic list without duplicating it, then adds the selected VIN', async () => {
    const legacy = { ...list(), label:'Customer shortlist', items:[] }
    const write = vi.fn().mockResolvedValueOnce({ ...legacy, label:'AB', revision:2 }).mockResolvedValueOnce({ ...list(3), label:'AB' })
    const session = createCustomerListSession({ read:async () => ({ lists:[legacy] }), write })
    await session.refresh(); await session.toggle('TESTDATAHWELL0001')
    expect(write).not.toHaveBeenCalled()
    expect(await session.saveNamed('AB')).toBe(true)
    expect(write.mock.calls[0][0]).toEqual({ action:'rename', listId:'list-one', expectedRevision:1, label:'AB' })
    expect(write.mock.calls[1][0]).toEqual({ action:'add', listId:'list-one', expectedRevision:2, vin:'TESTDATAHWELL0001' })
    expect(session.snapshot.naming).toBeNull()
  })

  it('closes first-save naming after retrying an interrupted VIN add without another create', async () => {
    const write = vi.fn().mockResolvedValueOnce({ ...list(), label:'AB', items:[] })
      .mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ ...list(2), label:'AB' })
    const session = createCustomerListSession({ read:async () => ({ lists:[] }), write })
    await session.refresh(); await session.toggle('TESTDATAHWELL0001')
    expect(await session.saveNamed('AB')).toBe(false)
    expect(session.snapshot.naming).not.toBeNull()
    expect(await session.retry()).toBe(true)
    expect(write.mock.calls.map(call => call[0].action)).toEqual(['create','add','add'])
    expect(write.mock.calls[2]).toEqual(write.mock.calls[1])
    expect(session.snapshot.naming).toBeNull()
    expect(session.active().items).toHaveLength(1)
  })

})
