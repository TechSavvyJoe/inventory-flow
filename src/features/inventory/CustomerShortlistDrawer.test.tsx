import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RefObject } from 'react'
import { CustomerShortlistDrawer } from './CustomerShortlistDrawer'
import type { InventoryVehicle } from './types'
import type { ShortlistManagement } from './useCustomerShortlist'

vi.mock('./TakeHomeSheet', () => ({ TakeHomeSheet: ({ vehicles, listLabel, returnFocusRef, onRefresh, onEditList, onClose, refreshError }: { vehicles: InventoryVehicle[]; listLabel?: string; returnFocusRef?: RefObject<HTMLElement | null>; onRefresh?: () => Promise<boolean>; onEditList?: () => void; onClose: () => void; refreshError?: string | null }) => <div role="dialog" aria-label="Customer sheet" data-return-focus={returnFocusRef?.current?.textContent}>Sheet {listLabel}: {vehicles.map(vehicle => vehicle.vin).join(',')}<span>Prices: {vehicles.map(vehicle => vehicle.price).join(',')}</span>{onRefresh ? <button onClick={() => void onRefresh()}>Refresh comparison</button> : null}{onEditList ? <button onClick={onEditList}>Edit list</button> : null}<button onClick={onClose}>Close sheet</button>{refreshError ? <p role="alert">{refreshError}</p> : null}</div> }))

afterEach(cleanup)
const available = { id:'VIN1', vin:'VIN1', stockNumber:'H1', displayName:'2026 Ford F-150', price:50000, imageUrl:null, exteriorColor:null, addedAt:1, available:true }
const unavailable = { id:'VIN2', vin:'VIN2', stockNumber:'Unavailable', displayName:'Vehicle unavailable', price:null, imageUrl:null, exteriorColor:null, addedAt:2, available:false }
const vehicle = { id:'vehicle-1', vin:'VIN1', stockNumber:'H1', year:2026, make:'Ford', model:'F-150' } as InventoryVehicle
function management(overrides: Partial<ShortlistManagement> = {}): ShortlistManagement {
  return { lists:[{ id:'one', label:'AB', count:2 }, { id:'two', label:'CD', count:0 }], activeListId:'one', activeLabel:'AB', loading:false, saving:false, error:null, lastConfirmedAt:1, pendingAction:false, accessRevoked:false, readyForWrites:true, selectList:vi.fn(), createList:vi.fn(async () => true), renameActiveList:vi.fn(async () => true), deleteActiveList:vi.fn(async () => true), retry:vi.fn(), ...overrides }
}

describe('CustomerShortlistDrawer synced lists', () => {
  it('returns focus after the sheet closes and a concurrent list read releases the disabled opener', async () => {
    const user = userEvent.setup()
    const manager = management()
    const props = { entries:[available], onRemove:vi.fn(), onClear:vi.fn(), authorizedVehicles:[vehicle] }
    const view = render(<CustomerShortlistDrawer {...props} management={manager} />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    await user.click(screen.getByRole('button', { name:'Customer sheet (1)' }))
    view.rerender(<CustomerShortlistDrawer {...props} management={{ ...manager, loading:true }} />)
    await user.click(screen.getByRole('button', { name:'Close sheet' }))
    expect(screen.getByRole('button', { name:'Customer sheet (1)' })).toBeDisabled()
    view.rerender(<CustomerShortlistDrawer {...props} management={manager} />)
    await waitFor(() => expect(screen.getByRole('button', { name:'Customer sheet (1)' })).toHaveFocus())
  })

  it('opens the selected list on a navigation request and respects closing until another request arrives', async () => {
    const user = userEvent.setup()
    const props = { entries:[available], onRemove:vi.fn(), onClear:vi.fn(), management:management(), accessContext:'owner-a' }
    const view = render(<CustomerShortlistDrawer {...props} openRequest="navigation-a" />)
    expect(screen.getByRole('combobox', { name:'Customer list' })).toBeVisible()
    await user.click(screen.getByRole('button', { name:'Close customer shortlist' }))
    view.rerender(<CustomerShortlistDrawer {...props} openRequest="navigation-a" />)
    expect(screen.queryByRole('combobox', { name:'Customer list' })).not.toBeInTheDocument()
    view.rerender(<CustomerShortlistDrawer {...props} openRequest="navigation-b" />)
    expect(screen.getByRole('combobox', { name:'Customer list' })).toBeVisible()
    view.rerender(<CustomerShortlistDrawer {...props} accessContext="owner-b" openRequest="navigation-b" />)
    expect(screen.queryByRole('combobox', { name:'Customer list' })).not.toBeInTheDocument()
  })

  it('finds and adds vehicles to the selected saved list without offering existing members', async () => {
    const user = userEvent.setup()
    const addVehicleToActiveList = vi.fn(async () => true)
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management({ addVehicleToActiveList })}
      authorizedVehicles={[vehicle, { ...vehicle, vin:'VIN3', stockNumber:'H3', model:'Escape' }]} />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    await user.click(screen.getByRole('button', { name:'Add vehicles' }))
    await user.type(screen.getByRole('searchbox', { name:'Find vehicles to add' }), 'Escape')
    expect(screen.queryByRole('button', { name:'Add H1 to AB' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name:'Add H3 to AB' }))
    expect(addVehicleToActiveList).toHaveBeenCalledWith('VIN3')
    await waitFor(() => expect(screen.getByRole('searchbox', { name:'Find vehicles to add' })).toHaveFocus())
  })

  it('rebuilds a reopened list preview from confirmed fresh data and returns to editing', async () => {
    const user = userEvent.setup()
    const prepareCustomerSheet = vi.fn()
      .mockResolvedValueOnce({ listId:'one', label:'AB', vehicles:[{ ...vehicle, price:47000 }], refreshedAt:1, unavailableCount:0 })
      .mockResolvedValueOnce({ listId:'one', label:'AB revised', vehicles:[{ ...vehicle, vin:'VIN3', price:42000 }], refreshedAt:2, unavailableCount:0 })
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management({ prepareCustomerSheet })} authorizedVehicles={[vehicle]} />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    await user.click(screen.getByRole('button', { name:'Customer sheet (1)' }))
    expect(await screen.findByRole('dialog', { name:'Customer sheet' })).toHaveTextContent('Prices: 47000')
    await user.click(screen.getByRole('button', { name:'Refresh comparison' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name:'Customer sheet' })).toHaveTextContent('Sheet AB revised: VIN3'))
    expect(prepareCustomerSheet.mock.calls).toEqual([[undefined], ['one']])
    expect(screen.getByRole('dialog', { name:'Customer sheet' })).toHaveTextContent('Prices: 42000')
    await user.click(screen.getByRole('button', { name:'Edit list' }))
    expect(screen.queryByRole('dialog', { name:'Customer sheet' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name:'Customer list' })).toBeVisible()
    expect(screen.getByRole('button', { name:'Remove H1 from list' })).toBeVisible()
  })

  it('keeps the last-loaded preview explicitly marked when refresh fails', async () => {
    const user = userEvent.setup()
    const prepareCustomerSheet = vi.fn()
      .mockResolvedValueOnce({ listId:'one', label:'AB', vehicles:[{ ...vehicle, price:47000 }], refreshedAt:1, unavailableCount:0 })
      .mockResolvedValueOnce(null)
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management({ prepareCustomerSheet })} authorizedVehicles={[vehicle]} />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    await user.click(screen.getByRole('button', { name:'Customer sheet (1)' }))
    await user.click(await screen.findByRole('button', { name:'Refresh comparison' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('last-loaded data')
    expect(screen.getByRole('dialog', { name:'Customer sheet' })).toHaveTextContent('Prices: 47000')
  })

  it('toggles the pop-up from the same launcher without changing saved vehicles', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<CustomerShortlistDrawer entries={[available]} onRemove={onRemove} onClear={vi.fn()} management={management()} />)
    const launcher = screen.getByRole('button', { name:'Saved vehicles: AB (1)' })
    await user.click(launcher)
    expect(launcher).toHaveAttribute('aria-expanded', 'true')
    await user.click(launcher)
    expect(launcher).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name:'Saved vehicles 1' })).not.toBeInTheDocument()
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('hides both floating surfaces while a vehicle workspace covers them and restores the open list', async () => {
    const user = userEvent.setup()
    const props = { entries:[available], onRemove:vi.fn(), onClear:vi.fn(), management:management() }
    const { rerender } = render(<CustomerShortlistDrawer {...props} />)
    await user.click(screen.getByRole('button', { name:'Saved vehicles: AB (1)' }))
    rerender(<CustomerShortlistDrawer {...props} modalOpen />)
    expect(screen.queryByRole('region', { name:'Customer shortlist launcher' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name:'Saved vehicles 1' })).not.toBeInTheDocument()
    rerender(<CustomerShortlistDrawer {...props} />)
    expect(screen.getByRole('region', { name:'Saved vehicles 1' })).toBeVisible()
    expect(screen.getByRole('button', { name:'Saved vehicles: AB (1)' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the current vehicle trim in the compact row identity', async () => {
    const user = userEvent.setup()
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} authorizedVehicles={[{ ...vehicle, trim:'Lariat' }]} />)
    await user.click(screen.getByRole('button', { name:'Saved vehicles: Shortlist (1)' }))
    expect(screen.getByText('2026 Ford F-150 Lariat')).toBeVisible()
    expect(screen.getByRole('button', { name:'Open shortlisted 2026 Ford F-150 Lariat, stock H1' })).toBeVisible()
  })
  it('opens a nonmodal popover and Escape restores the fixed launcher', async () => {
    const user = userEvent.setup()
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management()} />, { container:root })
    const launcher = screen.getByRole('button', { name:'Saved vehicles: AB (1)' })
    await user.click(launcher)
    expect(screen.getByRole('region', { name:'Saved vehicles 1' })).toBeVisible()
    expect(screen.getByRole('region', { name:'Saved vehicles 1' })).not.toHaveAttribute('aria-modal')
    expect(document.body.style.overflow).toBe('')
    await waitFor(() => expect(screen.getByRole('button', { name:'Close customer shortlist' })).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('region', { name:'Saved vehicles 1' })).not.toBeInTheDocument())
    await waitFor(() => expect(launcher).toHaveFocus())
    expect(document.body.style.overflow).toBe('')
  })

  it('closes on an outside pointer without stealing the clicked control focus', async () => {
    const user = userEvent.setup()
    render(<><button type="button">Inventory action</button><CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management()} /></>)
    await user.click(screen.getByRole('button', { name:'Saved vehicles: AB (1)' }))
    const outside = screen.getByRole('button', { name:'Inventory action' })
    await user.click(outside)
    expect(screen.queryByRole('region', { name:'Saved vehicles 1' })).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
  })

  it('returns focus to the management disclosure that removed its form', async () => {
    const user = userEvent.setup()
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management()} />)
    await user.click(screen.getByRole('button', { name:'Saved vehicles: AB (1)' }))
    const newList = screen.getByRole('button', { name:'New list' })
    await user.click(newList)
    await user.click(screen.getByRole('button', { name:'Cancel' }))
    await waitFor(() => expect(newList).toHaveFocus())
    await user.click(newList)
    await user.type(screen.getByRole('textbox', { name:'New customer list' }), 'EF')
    await user.click(screen.getByRole('button', { name:'Create' }))
    await waitFor(() => expect(newList).toHaveFocus())
    const manage = screen.getByRole('button', { name:'Manage' })
    await user.click(manage)
    await user.click(screen.getByRole('button', { name:'Save name' }))
    await waitFor(() => expect(manage).toHaveFocus())
  })

  it('requires confirmation before clearing the active list', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={onClear} management={management()} />)
    await user.click(screen.getByRole('button', { name:'Saved vehicles: AB (1)' }))
    expect(screen.queryByRole('button', { name:'Clear list' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name:'Manage' }))
    await user.click(screen.getByRole('button', { name:'Clear list' }))
    expect(onClear).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name:'Cancel clear' }))
    expect(onClear).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name:'Clear list' }))
    await user.click(screen.getByRole('button', { name:'Confirm clear' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('requires a fresh clear confirmation after changing customers', async () => {
    const user = userEvent.setup()
    const clearAlpha = vi.fn()
    const clearBravo = vi.fn()
    const state = management()
    const { rerender } = render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={clearAlpha} management={state} />)
    await user.click(screen.getByRole('button', { name:'Saved vehicles: AB (1)' }))
    await user.click(screen.getByRole('button', { name:'Manage' }))
    await user.click(screen.getByRole('button', { name:'Clear list' }))
    await user.selectOptions(screen.getByRole('combobox', { name:'Customer list' }), 'two')
    rerender(<CustomerShortlistDrawer entries={[{ ...available, id:'VIN3', vin:'VIN3', stockNumber:'H3' }]} onRemove={vi.fn()} onClear={clearBravo} management={management({ activeListId:'two', activeLabel:'CD' })} />)
    await user.click(screen.getByRole('button', { name:'Manage' }))
    expect(screen.getByRole('button', { name:'Clear list' })).toBeVisible()
    expect(screen.queryByRole('button', { name:'Confirm clear' })).not.toBeInTheDocument()
    expect(clearAlpha).not.toHaveBeenCalled()
    expect(clearBravo).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name:'Clear list' }))
    await user.click(screen.getByRole('button', { name:'Confirm clear' }))
    expect(clearAlpha).not.toHaveBeenCalled()
    expect(clearBravo).toHaveBeenCalledTimes(1)
  })

  it('keeps list management visible when the active list is empty', async () => {
    const user = userEvent.setup()
    const state = management({ lists:[], activeListId:null })
    render(<CustomerShortlistDrawer entries={[]} onRemove={vi.fn()} onClear={vi.fn()} management={state} />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    expect(screen.getByRole('combobox', { name:'Customer list' })).toHaveTextContent('No saved lists yet')
    expect(screen.queryByRole('textbox', { name:'New customer list' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name:'New list' }))
    expect(screen.getByText(/No contact information/)).toBeVisible()
    await user.type(screen.getByRole('textbox', { name:'New customer list' }), 'EF')
    await user.click(screen.getByRole('button', { name:'Create' }))
    expect(state.createList).toHaveBeenCalledWith('EF')
  })

  it('selects a separate list and exports only currently authorized vehicles', async () => {
    const user = userEvent.setup()
    const state = management()
    render(<CustomerShortlistDrawer entries={[available, unavailable]} onRemove={vi.fn()} onClear={vi.fn()} management={state} authorizedVehicles={[vehicle]} />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    await user.selectOptions(screen.getByRole('combobox', { name:'Customer list' }), 'two')
    expect(state.selectList).toHaveBeenCalledWith('two')
    expect(screen.getByRole('button', { name:/unavailable in current access/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name:'Customer sheet (1)' }))
    expect(screen.getByRole('dialog', { name:'Customer sheet' })).toHaveTextContent('Sheet AB: VIN1')
  })

  it('requires a second explicit action before deleting a list', async () => {
    const user = userEvent.setup()
    const state = management()
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={state} />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    expect(screen.queryByRole('button', { name:'Delete list' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name:'Manage' }))
    await user.click(screen.getByRole('button', { name:'Delete list' }))
    expect(state.deleteActiveList).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name:'Confirm delete' }))
    expect(state.deleteActiveList).toHaveBeenCalledTimes(1)
  })

  it('uses current authorized facts without reviving an old price or unavailable specifications', async () => {
    const user = userEvent.setup()
    render(<CustomerShortlistDrawer entries={[available, unavailable]} onRemove={vi.fn()} onClear={vi.fn()} management={management()} authorizedVehicles={[{ ...vehicle, price:null, engine:'Current captured engine' }, { ...vehicle, vin:'VIN2', engine:'Unavailable engine' }]} />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    expect(screen.getByRole('listitem', { name:/2026 Ford F-150/ })).toHaveTextContent('Current captured engine')
    expect(screen.getByRole('listitem', { name:/2026 Ford F-150/ })).not.toHaveTextContent('$50,000')
    expect(screen.queryByText('Unavailable engine')).not.toBeInTheDocument()
  })

  it('keeps an open customer document on its original list and closes it when access context changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management()} authorizedVehicles={[vehicle]} accessContext="employee-a" />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    await user.click(screen.getByRole('button', { name:'Customer sheet (1)' }))
    expect(screen.getByRole('dialog', { name:'Customer sheet' })).toHaveTextContent('Sheet AB: VIN1')
    expect(screen.getByRole('dialog', { name:'Customer sheet' })).toHaveAttribute('data-return-focus', 'Customer sheet (1)')

    rerender(<CustomerShortlistDrawer entries={[]} onRemove={vi.fn()} onClear={vi.fn()} management={management({ activeListId:'two', activeLabel:'CD' })} authorizedVehicles={[]} accessContext="employee-a" />)
    expect(screen.getByRole('dialog', { name:'Customer sheet' })).toHaveTextContent('Sheet AB: VIN1')

    rerender(<CustomerShortlistDrawer entries={[]} onRemove={vi.fn()} onClear={vi.fn()} management={management({ activeListId:'two', activeLabel:'CD' })} authorizedVehicles={[]} accessContext="employee-b" />)
    expect(await screen.findByRole('button', { name:/^Saved vehicles:/ })).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('locks list selection and new mutations while an uncertain action awaits retry', async () => {
    const user = userEvent.setup()
    render(<CustomerShortlistDrawer entries={[available]} onRemove={vi.fn()} onClear={vi.fn()} management={management({ pendingAction:true, error:'Network interrupted' })} />)
    await user.click(screen.getByRole('button', { name:/^Saved vehicles:/ }))
    expect(screen.getByRole('combobox', { name:'Customer list' })).toBeDisabled()
    expect(screen.getByRole('button', { name:'New list' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name:'Manage' }))
    expect(screen.getByRole('button', { name:'Save name' })).toBeDisabled()
    expect(screen.getByRole('button', { name:'Delete list' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Needs retry')
    expect(screen.getByRole('button', { name:'Retry' })).toBeEnabled()
  })
})
