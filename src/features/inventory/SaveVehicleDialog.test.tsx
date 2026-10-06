import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaveVehicleDialog } from './SaveVehicleDialog'
import type { ShortlistManagement } from './useCustomerShortlist'

afterEach(cleanup)

function management(): ShortlistManagement {
  return {
    lists:[{ id:'legacy', label:'Customer shortlist', count:1 }, { id:'named', label:'AB', count:0 }],
    activeListId:'legacy', activeLabel:'Customer shortlist', loading:false, saving:false,
    error:null, lastConfirmedAt:null, pendingAction:false, accessRevoked:false, readyForWrites:true,
    pendingSave:{ vin:'TESTDATAHWELL0001', displayName:'2026 Ford F-150', stockNumber:'H00001', namingExistingList:true, namingListId:'legacy' },
    savePendingToNamedList:vi.fn().mockResolvedValue(true), savePendingToExistingList:vi.fn().mockResolvedValue(true),
    selectList:vi.fn(), createList:vi.fn().mockResolvedValue(true), renameActiveList:vi.fn().mockResolvedValue(true),
    deleteActiveList:vi.fn().mockResolvedValue(true), retry:vi.fn(),
  }
}

describe('first-save naming choices', () => {
  it('omits the legacy list while allowing another named list to receive the vehicle', async () => {
    const user = userEvent.setup()
    const state = management()
    render(<SaveVehicleDialog management={state} />)
    expect(screen.getByRole('dialog', { name:'Name this customer list' })).toBeVisible()
    expect(screen.queryByRole('option', { name:'Customer shortlist (1)' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name:'Or use an existing list' }), 'named')
    await user.click(screen.getByRole('button', { name:'Save vehicle' }))
    expect(state.savePendingToExistingList).toHaveBeenCalledWith('named')
    expect(state.savePendingToNamedList).not.toHaveBeenCalled()
  })

  it('keeps the original naming target excluded after it was renamed and the active selection changed', () => {
    const state = management()
    state.lists[0].label = 'CD'
    state.activeListId = 'named'
    render(<SaveVehicleDialog management={state} />)
    expect(screen.queryByRole('option', { name:'CD (1)' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name:'AB (0)' })).toBeInTheDocument()
  })

  it.each(['last list deleted', 'one of multiple deleted', 'renamed generic', 'became naming target'] as const)('restores naming when the selected destination is %s', async change => {
    const user = userEvent.setup()
    const state = management()
    if (change === 'one of multiple deleted') state.lists.push({ id:'other', label:'CD', count:0 })
    const { rerender } = render(<SaveVehicleDialog management={state} />)
    await user.type(screen.getByRole('textbox', { name:'List name' }), 'EF options')
    await user.selectOptions(screen.getByRole('combobox', { name:'Or use an existing list' }), 'named')
    expect(screen.getByRole('textbox', { name:'List name' })).toBeDisabled()

    const refreshed = { ...state, lists:state.lists.map(list => ({ ...list })) }
    if (change === 'renamed generic') refreshed.lists.find(list => list.id === 'named')!.label = 'Customer shortlist'
    else if (change === 'became naming target') refreshed.pendingSave = { ...state.pendingSave!, namingListId:'named' }
    else refreshed.lists = refreshed.lists.filter(list => list.id !== 'named')
    rerender(<SaveVehicleDialog management={refreshed} />)

    expect(screen.getByRole('textbox', { name:'List name' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name:'List name' })).toHaveValue('EF options')
    const existing = screen.queryByRole('combobox', { name:'Or use an existing list' })
    if (existing) expect(existing).toHaveValue('')
    await user.click(screen.getByRole('button', { name:'Save vehicle' }))
    expect(state.savePendingToNamedList).toHaveBeenCalledWith('EF options')
    expect(state.savePendingToExistingList).not.toHaveBeenCalled()
  })
})
