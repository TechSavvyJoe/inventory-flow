import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RefObject } from 'react'
import { CustomerShortlistDrawer } from './CustomerShortlistDrawer'
import type { InventoryVehicle } from './types'
import type { ShortlistManagement } from './useCustomerShortlist'

vi.mock('./TakeHomeSheet', () => ({ TakeHomeSheet: ({ vehicles, listLabel, returnFocusRef }: { vehicles: InventoryVehicle[]; listLabel?: string; returnFocusRef?: RefObject<HTMLElement | null> }) => <div role="dialog" data-return-focus={returnFocusRef?.current?.textContent}>Sheet {listLabel}: {vehicles.map(vehicle => vehicle.vin).join(',')}</div> }))

afterEach(cleanup)
const available = { id:'VIN1', vin:'VIN1', stockNumber:'H1', displayName:'2026 Ford F-150', price:50000, imageUrl:null, exteriorColor:null, addedAt:1, available:true }
const unavailable = { id:'VIN2', vin:'VIN2', stockNumber:'Unavailable', displayName:'Vehicle unavailable', price:null, imageUrl:null, exteriorColor:null, addedAt:2, available:false }
const vehicle = { id:'vehicle-1', vin:'VIN1', stockNumber:'H1', year:2026, make:'Ford', model:'F-150' } as InventoryVehicle
function management(overrides: Partial<ShortlistManagement> = {}): ShortlistManagement {
  return { lists:[{ id:'one', label:'AB', count:2 }, { id:'two', label:'CD', count:0 }], activeListId:'one', activeLabel:'AB', loading:false, saving:false, error:null, lastConfirmedAt:1, pendingAction:false, accessRevoked:false, readyForWrites:true, selectList:vi.fn(), createList:vi.fn(async () => true), renameActiveList:vi.fn(async () => true), deleteActiveList:vi.fn(async () => true), retry:vi.fn(), ...overrides }
}

describe('CustomerShortlistDrawer synced lists', () => {
  it('keeps list management visible when the active list is empty', async () => {
    const user = userEvent.setup()
    const state = management({ lists:[], activeListId:null })
    render(<CustomerShortlistDrawer entries={[]} onRemove={vi.fn()} onClear={vi.fn()} management={state} />)
    await user.click(screen.getByRole('button', { name:/AB 0/ }))
    expect(screen.getByRole('combobox', { name:'Customer list' })).toHaveTextContent('No saved lists yet')
    expect(screen.getByText(/Do not enter contact information/)).toBeVisible()
    await user.type(screen.getByRole('textbox', { name:'New list' }), 'EF')
    await user.click(screen.getByRole('button', { name:'Create' }))
    expect(state.createList).toHaveBeenCalledWith('EF')
  })

  it('selects a separate list and exports only currently authorized vehicles', async () => {
    const user = userEvent.setup()
    const state = management()
    render(<CustomerShortlistDrawer entries={[available, unavailable]} onRemove={vi.fn()} onClear={vi.fn()} management={state} authorizedVehicles={[vehicle]} />)
    await user.click(screen.getByRole('button', { name:/AB 2/ }))
    await user.selectOptions(screen.getByRole('combobox', { name:'Customer list' }), 'two')
    expect(state.selectList).toHaveBeenCalledWith('two')
    expect(screen.getByRole('button', { name:/unavailable in current access/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name:'Customer sheet (1)' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Sheet AB: VIN1')
  })

  it('requires a second explicit action before deleting a list', async () => {
    const user = userEvent.setup()
    const state = management()
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={state} />)
    await user.click(screen.getByRole('button', { name:/AB 1/ }))
    await user.click(screen.getByRole('button', { name:'Delete' }))
    expect(state.deleteActiveList).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name:'Confirm delete' }))
    expect(state.deleteActiveList).toHaveBeenCalledTimes(1)
  })

  it('keeps an open customer document on its original list and closes it when access context changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management()} authorizedVehicles={[vehicle]} accessContext="employee-a" />)
    await user.click(screen.getByRole('button', { name:/AB 1/ }))
    await user.click(screen.getByRole('button', { name:'Customer sheet (1)' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Sheet AB: VIN1')
    expect(screen.getByRole('dialog')).toHaveAttribute('data-return-focus', 'AB 1')

    rerender(<CustomerShortlistDrawer entries={[]} onRemove={vi.fn()} onClear={vi.fn()} management={management({ activeListId:'two', activeLabel:'CD' })} authorizedVehicles={[]} accessContext="employee-a" />)
    expect(screen.getByRole('dialog')).toHaveTextContent('Sheet AB: VIN1')

    rerender(<CustomerShortlistDrawer entries={[]} onRemove={vi.fn()} onClear={vi.fn()} management={management({ activeListId:'two', activeLabel:'CD' })} authorizedVehicles={[]} accessContext="employee-b" />)
    expect(await screen.findByRole('button', { name:/CD 0/ })).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('locks list selection and new mutations while an uncertain action awaits retry', async () => {
    const user = userEvent.setup()
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management({ pendingAction:true, error:'Network interrupted' })} />)
    await user.click(screen.getByRole('button', { name:/AB 1/ }))
    expect(screen.getByRole('combobox', { name:'Customer list' })).toBeDisabled()
    expect(screen.getByRole('button', { name:'Create' })).toBeDisabled()
    expect(screen.getByRole('button', { name:'Rename' })).toBeDisabled()
    expect(screen.getByRole('button', { name:'Delete' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Action needs confirmation')
    expect(screen.getByRole('button', { name:'Retry' })).toBeEnabled()
  })
})
