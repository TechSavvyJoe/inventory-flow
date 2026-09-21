import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, renderHook, screen, within } from '@testing-library/react'
import { clearCustomerShortlist, useCustomerShortlist } from '../../src/features/inventory/useCustomerShortlist'
import { premiumVehicle, showPremiumInventory, showPremiumVehicle } from './premium-test-helpers'

beforeEach(clearCustomerShortlist)
afterEach(() => { cleanup(); clearCustomerShortlist() })

describe('Premium workflow stress and boundary behavior', () => {
  it('deduplicates repeated shortlist additions and isolates rapid actions by vehicle', () => {
    const a = premiumVehicle()
    const b = premiumVehicle({ id: 'SYNTHETIC-B', vin: 'SYNTHETIC-B', stockNumber: 'SYNTHETIC-B' })
    const { result } = renderHook(() => useCustomerShortlist('manager:Howell:stress'))
    act(() => { for (let n = 0; n < 100; n++) result.current.add(a); result.current.add(b) })
    expect(result.current.entries.map(entry => entry.id)).toEqual([a.id, b.id])
    act(() => { for (let n = 0; n < 100; n++) result.current.toggle(a) })
    expect(result.current.count).toBe(2)
    act(() => result.current.remove(a.id))
    expect(result.current.entries.map(entry => entry.id)).toEqual([b.id])
  })

  it('does not restore previous selections after leaving and returning to an access context', () => {
    const { result, rerender } = renderHook(({ context }) => useCustomerShortlist(context), { initialProps: { context: 'manager:Howell:A' } })
    act(() => result.current.add(premiumVehicle()))
    const obsoleteAdd = result.current.add
    rerender({ context: 'sales:Fowlerville:B' })
    act(() => obsoleteAdd(premiumVehicle()))
    expect(result.current.count).toBe(0)
    rerender({ context: 'manager:Howell:A' })
    expect(result.current.count).toBe(0)
  })

  it('keeps the first inventory page bounded with a large synthetic inventory', () => {
    const vehicles = Array.from({ length: 150 }, (_, index) => premiumVehicle({ id: `SYNTHETIC-${index}`, vin: `SYNTHETIC-${index}`, stockNumber: `SYNTHETIC-${index}` }))
    showPremiumInventory(vehicles)
    const grid = within(screen.getByRole('region', { name: 'Inventory results table' }))
    expect(grid.getAllByRole('button', { name: /Open vehicle details/ }).length).toBeLessThanOrEqual(50)
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('10')
  })

  it('shows a stable honest placeholder when no photo URLs were supplied', () => {
    showPremiumVehicle(premiumVehicle({ imageUrl: null, imageUrls: [], photoCount: 0 }))
    const gallery = screen.getByRole('region', { name: /Vehicle photos for .* unavailable/ })
    expect(gallery).toHaveTextContent('Photos are not available')
    expect(gallery).toHaveTextContent('No photo URLs were supplied')
    expect(within(gallery).queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps a complete accessible vehicle title when model data is unusually long', () => {
    const model = 'Super Duty long synthetic model with special equipment '.repeat(4)
    showPremiumVehicle(premiumVehicle({ model }))
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', expect.stringContaining(model.trim()))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(model.trim())
  })

  it('does not promote missing evidence into availability or a document result', () => {
    showPremiumVehicle(premiumVehicle({ factoryEquipment: undefined, windowSticker: undefined, fordOasis: undefined, autoCheckReport: undefined, dealerMail: { dataState: 'unavailable', hasActiveHold: null, activeRecordCount: 0, canViewEvidence: false, canManageHold: false }, holdEvidence: [], serviceReadiness: undefined }))
    expect(screen.getByRole('region', { name: 'Vehicle operational summary' })).toHaveTextContent('Hold status unverified')
    fireEvent.click(screen.getByRole('tab', { name: 'Records' }))
    expect(screen.getByRole('tabpanel', { name: 'Records' })).toHaveTextContent('No vehicle records are available')
    expect(screen.queryByText(/^Available$/)).not.toBeInTheDocument()
  })

  it('closes the workspace with Escape without running an operational action', () => {
    const close = vi.fn(), move = vi.fn()
    showPremiumVehicle(premiumVehicle(), { onClose: close, onMoveVehicle: move })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    expect(move).not.toHaveBeenCalled()
  })

  it('closes when the actual modal backdrop is selected', () => {
    const close = vi.fn()
    showPremiumVehicle(premiumVehicle(), { onClose: close })
    fireEvent.click(document.querySelector('.vdp-focus-backdrop')!)
    expect(close).toHaveBeenCalledOnce()
  })

  it('restores focus to its inventory opener on unmount', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = showPremiumVehicle(premiumVehicle(), { returnFocusRef: { current: opener } })
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('Escape closes only the nested take-home dialog and restores the vehicle dialog', () => {
    const close = vi.fn()
    showPremiumVehicle(premiumVehicle(), { onClose: close })
    fireEvent.click(screen.getByRole('button', { name: 'Take-home page' }))
    expect(screen.getByRole('dialog', { name: /Take.home/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('SYNTHETIC-001')
    expect(screen.queryByRole('dialog', { name: /Take.home/ })).not.toBeInTheDocument()
  })
})
