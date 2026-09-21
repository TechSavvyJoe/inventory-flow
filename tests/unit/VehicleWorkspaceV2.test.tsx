import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { clearCustomerShortlist } from '../../src/features/inventory/useCustomerShortlist'
import { premiumVehicle, showPremiumVehicle } from './premium-test-helpers'

beforeEach(clearCustomerShortlist)
afterEach(() => { cleanup(); clearCustomerShortlist() })

describe('Premium vehicle workspace shares the operational record', () => {
  it('keeps identifiers and the accessible dialog while adding a shortlist action', () => {
    showPremiumVehicle()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('button', { name: /Copy stock number: SYNTHETIC-001/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Add SYNTHETIC-001 to shortlist/ })).toHaveAttribute('aria-pressed', 'false')
  })
  it('toggles shortlist without manufacturing an operational change', () => {
    showPremiumVehicle()
    fireEvent.click(screen.getByRole('button', { name: /Add SYNTHETIC-001 to shortlist/ }))
    expect(screen.getByRole('button', { name: /Remove SYNTHETIC-001 from shortlist/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /^Start service$/ })).toHaveAttribute('href', expect.stringContaining('action=in_service'))
    expect(screen.queryByRole('button', { name: /^Start service$/ })).not.toBeInTheDocument()
  })
  it('retains every shared record section and the source qualification', () => {
    showPremiumVehicle()
    for (const name of ['Overview', 'Equipment', 'Records', 'Holds & moves', 'Activity']) expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Records' }))
    expect(screen.getByRole('tabpanel', { name: 'Records' })).toHaveTextContent('Records don’t confirm availability')
  })
  it('keeps direct move actions connected to the supplied authorized intent', () => {
    const move = vi.fn()
    const vehicle = premiumVehicle()
    showPremiumVehicle(vehicle, { moveAction: { intent: 'direct', label: 'Move vehicle', shortLabel: 'Move' }, onMoveVehicle: move })
    fireEvent.click(screen.getByRole('button', { name: /^Move vehicle$/ }))
    expect(move).toHaveBeenCalledWith(vehicle, 'direct')
  })
  it('retains detail retry without losing visible inventory summary', () => {
    const retry = vi.fn()
    showPremiumVehicle(premiumVehicle(), { detailState: 'failed', onRetryDetail: retry })
    expect(screen.getByRole('dialog')).toHaveTextContent('SYNTHETIC-001')
    fireEvent.click(screen.getByRole('button', { name: /Retry full record/i }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
