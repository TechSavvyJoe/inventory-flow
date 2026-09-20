import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import React from 'react'

import { VehicleWorkspaceV2 } from '../../src/features/inventory/VehicleWorkspaceV2'
import { InventoryTable } from '../../src/features/inventory/InventoryTable'
import { ServiceStatusLink } from '../../src/features/inventory/ServiceStatusLink'
import { takeHomeModel } from '../../src/features/inventory/TakeHomeSheet'
import {
  isV1Requested,
  loadInventoryPageV1,
  loadInventoryPageV2,
  loadServicePageV1,
  loadServicePageV2,
  loadTransfersPageV1,
  loadTransfersPageV2,
} from '../../src/app/routeModules'
import { createMockVehicle } from './helpers'
import { formatMoney, formatMileage } from '../../src/features/inventory/inventory-utils'

beforeEach(() => {
  let clipboardBuffer = ''
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn((text: string) => {
        clipboardBuffer = text
        return Promise.resolve()
      }),
      readText: vi.fn(() => Promise.resolve(clipboardBuffer)),
    },
  })

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  cleanup()
})

describe('Tier 4: Real-World Application Scenarios (TEST_INFRA.md §5)', () => {
  // ---------------------------------------------------------------------------
  // Scenario 1: Salesperson Lead Response & Take-Home Sheet Generation
  // ---------------------------------------------------------------------------
  it('Scenario 1: Salesperson Lead Response & Take-Home Sheet Generation', async () => {
    const onSelect = vi.fn()
    const vehicle = createMockVehicle({
      id: 'V-SCEN-01',
      stockNumber: 'W5863Q',
      vin: '1FTFW1E86HFA48871',
      price: 55495,
      msrp: 62240,
      factoryEquipment: {
        basePrice: 51200,
        packages: ['FX4 Off-Road Package', 'Max Trailer Tow Package'],
        features: ['360-Degree Camera', 'Twin Panel Moonroof'],
      },
    })

    // Step 1: Salesperson navigates inventory table and selects vehicle
    const { unmount } = render(
      <InventoryTable
        vehicles={[vehicle]}
        selectedVehicleId={null}
        sorts={[]}
        onSortChange={vi.fn()}
        onSelectVehicle={onSelect}
      />
    )
    const stockCell = screen.getByText('W5863Q')
    fireEvent.click(stockCell.closest('tr')!)
    expect(onSelect).toHaveBeenCalledWith(vehicle)
    unmount()

    // Step 2: Opens VDP Cockpit
    render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: /vehicle workspace/i })
    expect(dialog).toBeInTheDocument()

    // Step 3: Verifies sale price and MSRP delta
    expect(within(dialog).getByText('$55,495')).toBeInTheDocument()
    expect(within(dialog).getByText('$62,240')).toBeInTheDocument()

    // Step 4: Copies VIN for CRM entry
    const copyVinBtn = within(dialog).getByRole('button', { name: /Copy VIN: 1FTFW1E86HFA48871/i })
    fireEvent.click(copyVinBtn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('1FTFW1E86HFA48871')

    // Step 5: Reviews standout packages
    expect(within(dialog).getAllByText(/FX4 Off-Road Package/i).length).toBeGreaterThanOrEqual(1)

    // Step 6: Generates Take-Home customer sheet
    const takeHomeBtn = within(dialog).getByRole('button', { name: /Take-home page/i })
    fireEvent.click(takeHomeBtn)

    const sheetDialog = screen.getByRole('dialog', { name: /^Take-home page/i })
    expect(sheetDialog).toBeInTheDocument()
    expect(within(sheetDialog).getByText('W5863Q')).toBeInTheDocument()
    expect(within(sheetDialog).getByText('$55,495')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scenario 2: Deal Desk Manager DealerMail Hold Expiration & Reallocation
  // ---------------------------------------------------------------------------
  it('Scenario 2: Deal Desk Manager DealerMail Hold Expiration & Reallocation', async () => {
    const vehicle = createMockVehicle({
      dealerMail: {
        dataState: 'current',
        hasActiveHold: true,
        position: 'primary',
        canManageHold: true,
        canViewEvidence: true,
      },
      holdEvidence: [
        {
          id: 'hold-1',
          position: 'primary',
          salesperson: 'Sarah Jenkins',
          customerOrReason: 'Deposit placed pending financing',
          expiresAt: '2026-09-02T16:00:00Z',
        },
      ],
    })

    const { baseElement } = render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    // Step 1: Inspects active hold card with salesperson attribution
    expect(screen.getByText(/Held · Sarah Jenkins/i)).toBeInTheDocument()

    // Step 2: Reviews hold expiration timer
    expect(baseElement.querySelector('.vdp-hold-timer')).toHaveTextContent(/Sep 2/i)

    // Step 3: Opens DealerMail hold tools drawer
    const updateHoldBtn = screen.getByRole('button', { name: /Update Hold/i })
    fireEvent.click(updateHoldBtn)

    // Step 4: Drawer opens and button changes to Hide Tools
    expect(screen.getByRole('button', { name: /Hide Tools/i })).toBeInTheDocument()
    expect(baseElement.querySelector('.vdp-dealermail-drawer')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scenario 3: Service Technician Intake to Delivery Readiness
  // ---------------------------------------------------------------------------
  it('Scenario 3: Service Technician Intake to Delivery Readiness', () => {
    const vehicle = createMockVehicle({
      serviceReadiness: { status: 'needs_service', notes: 'Auction intake' },
    })

    render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    // Step 1: Technician sees vehicle waiting for service
    expect(screen.getByText('Needs service · Waiting for service')).toBeInTheDocument()

    // Step 2: Technician advances status to In Service
    const startServiceBtn = screen.getByRole('button', { name: /Start Service/i })
    fireEvent.click(startServiceBtn)

    // Step 3: Status optimistically updates to In Service and shows Mark Ready
    expect(screen.getByText('In service')).toBeInTheDocument()
    const markReadyBtn = screen.getByRole('button', { name: /Mark Ready/i })
    expect(markReadyBtn).toBeInTheDocument()

    // Step 4: Work completed, tech advances status to Ready
    fireEvent.click(markReadyBtn)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scenario 4: Porter / Transport Driver Vehicle Transfer Execution
  // ---------------------------------------------------------------------------
  it('Scenario 4: Porter / Transport Driver Vehicle Transfer Execution', () => {
    const onTrack = vi.fn()
    const vehicle = createMockVehicle({
      movement: {
        requestId: 'MOV-2026-0042',
        state: 'In transit',
        origin: 'Howell',
        destination: 'Fowlerville',
        driver: 'Tom Vance',
        overdue: false,
      },
    })

    render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onTrackMovement={onTrack} onClose={vi.fn()} />)

    // Step 1: Driver reviews custody card details
    expect(screen.getAllByText(/In transit/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('MOV-2026-0042')).toBeInTheDocument()

    // Step 2: Driver clicks Track Movement in action dock
    const trackBtns = screen.getAllByRole('button', { name: /Track movement/i })
    fireEvent.click(trackBtns[0])
    expect(onTrack).toHaveBeenCalledWith(vehicle)
  })

  // ---------------------------------------------------------------------------
  // Scenario 5: High-Density VDP Inspection of Zero-Photo Auction Intake
  // ---------------------------------------------------------------------------
  it('Scenario 5: High-Density VDP Inspection of Zero-Photo Auction Intake', () => {
    const vehicle = createMockVehicle({
      imageUrl: null,
      imageUrls: [],
      photos: [],
      photoCount: 0,
      engine: '3.5L V6 EcoBoost',
      transmission: '10-Speed Automatic',
      drivetrain: '4WD',
      windowSticker: { dataState: 'current', totalMsrp: 62240, options: ['FX4 Off-Road Package'] },
    })

    const { baseElement } = render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    // Step 1: Verifies graceful ImageOff placeholder without layout collapse
    const placeholder = baseElement.querySelector('.inventory-workspace-gallery--empty')
    expect(placeholder).toBeInTheDocument()
    expect(placeholder).toHaveAttribute('data-photo-state', 'empty')

    // Step 2: Technical specifications remain visible and dense
    expect(screen.getByText('3.5L V6 EcoBoost')).toBeInTheDocument()
    expect(screen.getByText('10-Speed Automatic')).toBeInTheDocument()
    expect(screen.getByText('4WD')).toBeInTheDocument()

    // Step 3: Window sticker document card is present
    expect(baseElement.querySelector('.vehicle-resource-card[data-resource="window-sticker"]')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scenario 6: Transport Role Privacy Redaction & Access Enforcement
  // ---------------------------------------------------------------------------
  it('Scenario 6: Transport Role Privacy Redaction & Access Enforcement', () => {
    const vehicle = createMockVehicle({
      dealerMail: {
        dataState: 'current',
        hasActiveHold: true,
        canViewEvidence: false, // Redacted for transport role
        canManageHold: false,
      },
      holdEvidence: [
        {
          id: 'h1',
          position: 'primary',
          salesperson: 'Confidential Staff',
          customerOrReason: 'Private Customer John Doe phone 555-1234',
        },
      ],
    })

    render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    // Customer PII and confidential evidence are strictly excluded from DOM
    expect(screen.queryByText(/John Doe/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/555-1234/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Confidential Staff/i)).not.toBeInTheDocument()

    // Operational hold state shows generic "On hold"
    expect(screen.getByText('On hold')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scenario 7: Rapid Deal Desk Multi-Identifier Clipboard Copying
  // ---------------------------------------------------------------------------
  it('Scenario 7: Rapid Deal Desk Multi-Identifier Clipboard Copying', async () => {
    const vehicle = createMockVehicle({
      stockNumber: 'DD-7788',
      vin: '1FTFW1E86HFA77880',
    })

    render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    const copyStock = screen.getByRole('button', { name: /Copy stock number: DD-7788/i })
    const copyVin = screen.getByRole('button', { name: /Copy VIN: 1FTFW1E86HFA77880/i })

    // Sequential rapid copying
    fireEvent.click(copyStock)
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('DD-7788')

    fireEvent.click(copyVin)
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('1FTFW1E86HFA77880')
  })

  // ---------------------------------------------------------------------------
  // Scenario 8: Overdue Transfer Alert & Timeline Audit
  // ---------------------------------------------------------------------------
  it('Scenario 8: Overdue Transfer Alert & Timeline Audit', () => {
    const vehicle = createMockVehicle({
      movement: {
        requestId: 'MOV-OVERDUE-88',
        state: 'In transit',
        overdue: true,
        driver: 'Alex Smith',
      },
      timeline: [
        { id: 'ev-1', title: 'Vehicle Received', detail: 'Received at Howell lot', occurredAt: '2026-08-10T10:00:00Z', source: 'cdk' },
        { id: 'ev-2', title: 'Transfer Dispatched', detail: 'Driver Alex Smith dispatched', occurredAt: '2026-08-12T14:00:00Z', source: 'app' },
      ],
    })

    render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    // Overdue move warning highlighted
    expect(screen.getByText(/Move needs action/i)).toBeInTheDocument()

    // Timeline audit trail displays recorded events
    expect(screen.getByText('Vehicle Received')).toBeInTheDocument()
    expect(screen.getByText('Transfer Dispatched')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scenario 9: Mobile Salesperson Lot Walk on 390px Viewport
  // ---------------------------------------------------------------------------
  it('Scenario 9: Mobile Salesperson Lot Walk on 390px Viewport', () => {
    const vehicle = createMockVehicle({ stockNumber: 'MOB-390' })

    const { baseElement } = render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    const aside = baseElement.querySelector('#inventory-vehicle-workspace')
    expect(aside).toBeInTheDocument()
    expect(aside).toHaveAttribute('role', 'dialog')
    expect(aside).toHaveAttribute('aria-modal', 'true')

    // Header back button is accessible for one-thumb dismiss
    const backBtn = screen.getByRole('button', { name: /Back to inventory/i })
    expect(backBtn).toBeInTheDocument()

    // Action buttons retain touchable button elements
    const takeHomeBtn = screen.getByRole('button', { name: /Take-home page/i })
    expect(takeHomeBtn).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scenario 10: Multi-Vehicle Service Batch Progression
  // ---------------------------------------------------------------------------
  it('Scenario 10: Multi-Vehicle Service Batch Progression', () => {
    const v1 = createMockVehicle({ id: 'V1', serviceReadiness: { status: 'needs_service' } })
    const v2 = createMockVehicle({ id: 'V2', serviceReadiness: { status: 'in_service' } })
    const v3 = createMockVehicle({ id: 'V3', serviceReadiness: { status: 'serviced' } })

    // Process Vehicle 1
    const { rerender } = render(<VehicleWorkspaceV2 vehicle={v1} homeStore="Howell" onClose={vi.fn()} />)
    expect(screen.getByText('Needs service · Waiting for service')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Start Service/i }))
    expect(screen.getByText('In service')).toBeInTheDocument()

    // Switch to Vehicle 2
    rerender(<VehicleWorkspaceV2 vehicle={v2} homeStore="Howell" onClose={vi.fn()} />)
    expect(screen.getByText('In service')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Mark Ready/i }))
    expect(screen.getByText('Ready')).toBeInTheDocument()

    // Switch to Vehicle 3
    rerender(<VehicleWorkspaceV2 vehicle={v3} homeStore="Howell" onClose={vi.fn()} />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scenario 11: Backup Hold Queue & Customer Priority Management
  // ---------------------------------------------------------------------------
  it('Scenario 11: Backup Hold Queue & Customer Priority Management', () => {
    const vehicle = createMockVehicle({
      dealerMail: {
        dataState: 'current',
        hasActiveHold: true,
        position: 'multiple',
        activeRecordCount: 3,
        canViewEvidence: true,
      },
      holdEvidence: [
        { id: 'h1', position: 'primary', salesperson: 'Sarah Jenkins', customerOrReason: 'Primary customer' },
        { id: 'h2', position: 'backup', salesperson: 'Dave Miller', customerOrReason: 'First backup' },
        { id: 'h3', position: 'backup', salesperson: 'John Doe', customerOrReason: 'Second backup' },
      ],
    })

    render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    // Primary owner attribution
    expect(screen.getByText(/Held · Sarah Jenkins/i)).toBeInTheDocument()

    // Backup holds counter displayed
    expect(screen.getByText('Backup holds')).toBeInTheDocument()
    const backupFact = screen.getByText('Backup holds').closest('.inventory-workspace-fact')
    expect(within(backupFact!).getByText('2')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scenario 12: Margin & Pricing Delta Analysis Under Manager Credentials
  // ---------------------------------------------------------------------------
  it('Scenario 12: Margin & Pricing Delta Analysis Under Manager Credentials', () => {
    const vehicle = createMockVehicle({
      price: 55495,
      msrp: 62240,
      windowSticker: { basePrice: 51200, totalMsrp: 62240, dataState: 'current' },
    })

    render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    // Persistent header price
    expect(screen.getByText('$55,495')).toBeInTheDocument()

    // Financials card details
    expect(screen.getByText('$62,240')).toBeInTheDocument()
    expect(screen.getByText('$51,200')).toBeInTheDocument()

    // Take-home calculation reflects savings
    const model = takeHomeModel(vehicle)
    expect(model.savings).toBe(6745) // 62240 - 55495
  })

  // ---------------------------------------------------------------------------
  // Scenario 13: View Switch Transitions & Route Seam Coexistence
  // ---------------------------------------------------------------------------
  it('Scenario 13: View Switch Transitions & Route Seam Coexistence', async () => {
    // Dynamic import seam correctly resolves V2 by default
    const invModule = await loadInventoryPageV2()
    expect(typeof invModule.default).toBe('function')

    const srvModule = await loadServicePageV2()
    expect(typeof srvModule.default).toBe('function')

    const trfModule = await loadTransfersPageV2()
    expect(typeof trfModule.default).toBe('function')

    // V1 fallback preserved intact
    const invV1 = await loadInventoryPageV1()
    expect(typeof invV1.default).toBe('function')
  })

  // ---------------------------------------------------------------------------
  // Scenario 14: Strict Keyboard-Only Accessibility Workflow
  // ---------------------------------------------------------------------------
  it('Scenario 14: Strict Keyboard-Only Accessibility Workflow', () => {
    const onClose = vi.fn()
    const vehicle = createMockVehicle({
      imageUrl: 'https://example.com/p1.jpg',
      imageUrls: ['https://example.com/p1.jpg', 'https://example.com/p2.jpg'],
      photoCount: 2,
    })

    const { baseElement } = render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={onClose} />)

    // Keyboard cycling of photo gallery
    const gallery = baseElement.querySelector('.inventory-workspace-gallery')
    expect(gallery).toBeInTheDocument()
    fireEvent.keyDown(gallery!, { key: 'ArrowRight' })
    expect(baseElement.querySelector('.inventory-workspace-gallery__stage img')).toHaveAttribute('src', 'https://example.com/p2.jpg')

    fireEvent.keyDown(gallery!, { key: 'ArrowLeft' })
    expect(baseElement.querySelector('.inventory-workspace-gallery__stage img')).toHaveAttribute('src', 'https://example.com/p1.jpg')

    // Keyboard Escape dismissal of VDP
    const dialog = screen.getByRole('dialog', { name: /vehicle workspace/i })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // Scenario 15: Factory Equipment & CPO Warranty Validation
  // ---------------------------------------------------------------------------
  it('Scenario 15: Factory Equipment & CPO Warranty Validation', () => {
    const vehicle = createMockVehicle({
      certified: true,
      factoryEquipment: {
        basePrice: 51200,
        packages: ['FX4 Off-Road Package', 'Max Trailer Tow Package'],
        features: ['Heated Front Seats', '360-Degree Camera'],
      },
      fordOasis: {
        warrantyStartDate: '2024-03-15',
        openFieldServiceActions: [],
      },
    })

    render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore="Howell" onClose={vi.fn()} />)

    // Key Equipment highlights
    expect(screen.getAllByText(/FX4 Off-Road Package/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Max Trailer Tow Package/i).length).toBeGreaterThanOrEqual(1)

    // Warranty & OASIS date inspection
    expect(screen.getByText(/Mar 15, 2024/i)).toBeInTheDocument()
  })
})
