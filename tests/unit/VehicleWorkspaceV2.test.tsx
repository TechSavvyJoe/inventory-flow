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
  it('shows the latest Ford service dates, inspection, and work summary without implying availability', () => {
    const vehicle = premiumVehicle({
      autoCheckReport: {
        dataState: 'current', score: 92, ownerCount: 1,
        recentInspection: { date: '2026-09-10', types: ['Vehicle Inspected'] },
      },
      fordOasis: {
        dataState: 'current', openFieldServiceActions: [], openActionsCaptured: true,
        warrantyCoverages: [], extendedCoverageExpirations: [],
        serviceHistory: {
          dataState: 'current', checkedAt: '2026-09-21T20:20:00.000Z', historyCaptured: true,
          repairOrderCount: 3, detailScanCount: 1, inspectionSearchStatus: 'confirmed',
          latestRepairOrder: {
            repairOrderNumber: '0000000000317147', dealerCode: '07317', openDate: '08/14/2026', closeDate: '09/11/2026', odometer: 121110,
            detailComplete: true, inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' },
            parts: [], laborOperations: [], services: ['Oil and filter service', 'Wiper blades'],
            summary: 'Certified Blue Oval inspection; oil and filter service; wiper blades.',
          },
        },
      },
    })
    showPremiumVehicle(vehicle)
    fireEvent.click(screen.getByRole('tab', { name: 'Records' }))
    const panel = screen.getByRole('tabpanel', { name: 'Records' })
    expect(panel).toHaveTextContent('Ford service history')
    expect(panel).toHaveTextContent('In service')
    expect(panel).toHaveTextContent('08/14/2026')
    expect(panel).toHaveTextContent('Ready')
    expect(panel).toHaveTextContent('09/11/2026')
    expect(panel).toHaveTextContent('Certified Blue Oval inspection')
    expect(panel).toHaveTextContent('Oil and filter service')
    expect(panel).not.toHaveTextContent('AutoCheck inspection')
    expect(panel).toHaveTextContent('Records don’t confirm availability')
  })
  it('shows the AutoCheck inspection date and type in the visible history summary', () => {
    const vehicle = premiumVehicle({
      make: 'Cadillac',
      autoCheckReport: {
        dataState: 'current', score: 91, ownerCount: 1,
        recentInspection: { date: '2026-09-10', types: ['Vehicle Inspected', 'Multiple Point Vehicle Inspection'] },
      },
      serviceReadiness: {
        vin: 'TESTDATAPREMIUM01', status: 'serviced', version: 0, serviceEnteredAt: null, completedAt: '2026-09-10',
        updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: 'Howell', canManage: false,
        readinessBasis: 'autocheck_post_intake_inspection',
        readinessEvidence: { source: 'autocheck', inspectionDate: '2026-09-10', types: ['Vehicle Inspected', 'Multiple Point Vehicle Inspection'] },
      },
    })
    showPremiumVehicle(vehicle)
    expect(screen.getByRole('link', { name: 'Service: Ready' })).toHaveTextContent('AutoCheck inspected 09/10/2026')
    fireEvent.click(screen.getByRole('tab', { name: 'Records' }))
    const panel = screen.getByRole('tabpanel', { name: 'Records' })
    expect(panel).toHaveTextContent('Recent inspection')
    expect(panel).toHaveTextContent('09/10/2026')
    expect(panel).toHaveTextContent('Vehicle Inspected · Multiple Point Vehicle Inspection')
  })
  it('keeps a verified empty Ford history in Waiting for service without adding an empty record card', () => {
    const vehicle = premiumVehicle({
      fordOasis: {
        dataState: 'current', openFieldServiceActions: [], openActionsCaptured: true,
        warrantyCoverages: [], extendedCoverageExpirations: [],
        serviceHistory: {
          dataState: 'current', checkedAt: '2026-09-21T20:20:00.000Z', historyCaptured: true,
          repairOrderCount: 0, detailScanCount: 0, inspectionSearchStatus: 'not_identified',
        },
      },
    })
    showPremiumVehicle(vehicle)
    expect(screen.getByRole('link', { name: 'Service: Waiting for service' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Records' }))
    expect(screen.getByRole('tabpanel', { name: 'Records' })).not.toHaveTextContent('Latest Ford dealer service')
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
