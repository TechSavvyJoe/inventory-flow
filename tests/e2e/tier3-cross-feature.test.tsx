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
  loadTransfersPageV1,
} from '../../src/app/routeModules'
import { createMockVehicle } from './helpers'
import { formatMoney } from '../../src/features/inventory/inventory-utils'

// Setup clipboard and media mocks
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

describe('Tier 3: Cross-Feature Interactions & Multi-Component Integration', () => {
  // ---------------------------------------------------------------------------
  // Suite 1: Table-to-VDP Navigation & Selection Coordination (F21 x F5 x F19)
  // ---------------------------------------------------------------------------
  describe('Suite 1: Table-to-VDP Navigation & Selection Coordination (F21 x F5 x F19)', () => {
    it('T3-01: Clicking an inventory table row triggers onSelectVehicle with vehicle object', () => {
      const onSelect = vi.fn()
      const v = createMockVehicle({ id: 'VEH-9921', vin: '1FTFW1E86HFA9921' })
      render(
        <InventoryTable
          vehicles={[v]}
          selectedVehicleId={null}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={onSelect}
        />
      )

      const vehicleCell = screen.getByText(v.stockNumber)
      const row = vehicleCell.closest('tr')
      expect(row).toBeInTheDocument()
      fireEvent.click(row!)
      expect(onSelect).toHaveBeenCalledWith(v)
    })

    it('T3-02: Selection renders VehicleWorkspaceV2 modal with matching VIN, Stock #, and Price in persistent header', () => {
      const v = createMockVehicle({
        id: 'VEH-9921',
        stockNumber: 'STK-8812',
        vin: '1FTFW1E86HFA88120',
        price: 54990,
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
      expect(within(dialog).getByText('STK-8812')).toBeInTheDocument()
      expect(within(dialog).getByText('1FTFW1E86HFA88120')).toBeInTheDocument()
      expect(within(dialog).getAllByText('$54,990').length).toBeGreaterThanOrEqual(1)
    })

    it('T3-03: Clicking header Close button triggers onClose callback to dismiss modal', () => {
      const onClose = vi.fn()
      const v = createMockVehicle()
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={onClose} />)

      const closeBtn = screen.getByRole('button', { name: /Close vehicle details/i })
      fireEvent.click(closeBtn)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('T3-04: Clicking header Back button triggers onClose callback', () => {
      const onClose = vi.fn()
      const v = createMockVehicle()
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={onClose} />)

      const backBtn = screen.getByRole('button', { name: /Back to inventory/i })
      fireEvent.click(backBtn)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('T3-05: Pressing Escape key within VehicleWorkspaceV2 triggers onClose callback', () => {
      const onClose = vi.fn()
      const v = createMockVehicle()
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={onClose} />)

      const dialog = screen.getByRole('dialog')
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Suite 2: Multi-Identifier Clipboard Synchronization (F6 x F21 x F5)
  // ---------------------------------------------------------------------------
  describe('Suite 2: Multi-Identifier Clipboard Synchronization (F6 x F21 x F5)', () => {
    it('T3-06: Copying stock number from InventoryTable calls clipboard.writeText', async () => {
      const v = createMockVehicle({ stockNumber: 'STK-X77' })
      render(
        <InventoryTable
          vehicles={[v]}
          selectedVehicleId={null}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      )

      const copyBtn = screen.getByRole('button', { name: /Copy stock number: STK-X77/i })
      fireEvent.click(copyBtn)
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('STK-X77')
    })

    it('T3-07: Copying VIN from VehicleWorkspaceV2 persistent header calls clipboard.writeText with full 17-char VIN', async () => {
      const v = createMockVehicle({ vin: '1FTFW1E86HFA99999' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const copyBtn = screen.getByRole('button', { name: /Copy VIN: 1FTFW1E86HFA99999/i })
      fireEvent.click(copyBtn)
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('1FTFW1E86HFA99999')
    })

    it('T3-08: Sequential copying of Stock # and VIN updates clipboard buffer with respective strings', async () => {
      const v = createMockVehicle({ stockNumber: 'STK-SEQ1', vin: '1FTFW1E86HFA00001' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const copyStock = screen.getByRole('button', { name: /Copy stock number: STK-SEQ1/i })
      fireEvent.click(copyStock)
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('STK-SEQ1')

      const copyVin = screen.getByRole('button', { name: /Copy VIN: 1FTFW1E86HFA00001/i })
      fireEvent.click(copyVin)
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('1FTFW1E86HFA00001')
    })

    it('T3-09: Copy button transitions copyable-value to copied state', async () => {
      const v = createMockVehicle({ stockNumber: 'STK-STATE' })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const copyBtn = screen.getByRole('button', { name: /Copy stock number: STK-STATE/i })
      fireEvent.click(copyBtn)
      await waitFor(() => {
        expect(baseElement.querySelector('[data-copy-state="copied"]')).toBeInTheDocument()
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Suite 3: Financials & Take-Home Sheet Cohesion (F9 x F18 x F5)
  // ---------------------------------------------------------------------------
  describe('Suite 3: Financials & Take-Home Sheet Cohesion (F9 x F18 x F5)', () => {
    it('T3-10: Persistent cockpit header price matches Financials & Pricing card values', () => {
      const v = createMockVehicle({ price: 58900, msrp: 64500 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const formattedPrice = formatMoney(58900)
      const formattedMsrp = formatMoney(64500)
      expect(screen.getByText(formattedPrice)).toBeInTheDocument()
      expect(screen.getByText(formattedMsrp)).toBeInTheDocument()
      expect(screen.getByText('Listed MSRP')).toBeInTheDocument()
    })

    it('T3-11: Clicking Take-home page button opens TakeHomeSheet modal dialog over VDP', () => {
      const v = createMockVehicle({ stockNumber: 'W5863Q' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const takeHomeBtn = screen.getByRole('button', { name: /Take-home page/i })
      fireEvent.click(takeHomeBtn)

      const takeHomeDialog = screen.getByRole('dialog', { name: /^Take-home page/i })
      expect(takeHomeDialog).toBeInTheDocument()
    })

    it('T3-12: TakeHomeSheet displays matching price, stock number, and store branding', () => {
      const v = createMockVehicle({ stockNumber: 'TH-901', price: 49995 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: /Take-home page/i }))
      const dialog = screen.getByRole('dialog', { name: /^Take-home page/i })

      expect(within(dialog).getByText('TH-901')).toBeInTheDocument()
      expect(within(dialog).getByText('$49,995')).toBeInTheDocument()
      expect(within(dialog).getAllByText(/Bob Maxey Ford of Howell/i).length).toBeGreaterThanOrEqual(1)
    })

    it('T3-13: Dismissing TakeHomeSheet dialog keeps VehicleWorkspaceV2 open and active', () => {
      const v = createMockVehicle({ stockNumber: 'W5863Q' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: /Take-home page/i }))
      const dialog = screen.getByRole('dialog', { name: /^Take-home page/i })
      expect(dialog).toBeInTheDocument()

      const closeSheet = within(dialog).getByRole('button', { name: /Close/i })
      fireEvent.click(closeSheet)

      expect(screen.queryByRole('dialog', { name: /^Take-home page/i })).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: /vehicle workspace/i })).toBeInTheDocument()
    })

    it('T3-14: takeHomeModel calculates savings delta correctly (MSRP - price)', () => {
      const v = createMockVehicle({ price: 50000, msrp: 56000 })
      const model = takeHomeModel(v)
      expect(model.price).toBe(50000)
      expect(model.msrp).toBe(56000)
      expect(model.savings).toBe(6000)
    })
  })

  // ---------------------------------------------------------------------------
  // Suite 4: Service Readiness & In-Card Progression (F12 x F16 x F23)
  // ---------------------------------------------------------------------------
  describe('Suite 4: Service Readiness & In-Card Progression (F12 x F16 x F23)', () => {
    it('T3-15: Uninspected vehicle displays Needs service · Waiting for service with Start Service button', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      expect(screen.getByText('Needs service · Waiting for service')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Start Service/i })).toBeInTheDocument()
    })

    it('T3-16: Clicking Start Service button advances local service status to In service and renders Mark Ready button', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const startBtn = screen.getByRole('button', { name: /Start Service/i })
      fireEvent.click(startBtn)

      expect(screen.getByText('In service')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Mark Ready/i })).toBeInTheDocument()
    })

    it('T3-17: Clicking Mark Ready button advances local service status to Ready', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'in_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const readyBtn = screen.getByRole('button', { name: /Mark Ready/i })
      fireEvent.click(readyBtn)

      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    it('T3-18: ServiceStatusLink component displays corresponding status label for all stages', () => {
      const { rerender } = render(<ServiceStatusLink vin="1FT1" service={{ status: 'needs_service' }} />)
      expect(screen.getByText('Waiting for service')).toBeInTheDocument()

      rerender(<ServiceStatusLink vin="1FT1" service={{ status: 'in_service' }} />)
      expect(screen.getByText('In service')).toBeInTheDocument()

      rerender(<ServiceStatusLink vin="1FT1" service={{ status: 'serviced' }} />)
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    it('T3-19: ServiceStatusLink contains valid URL query param matching vehicle VIN', () => {
      render(<ServiceStatusLink vin="1FTFW1E86HFA12345" service={{ status: 'in_service' }} />)
      const link = screen.getByRole('link', { name: /Open service status for VIN/i })
      expect(link).toHaveAttribute('href', '/service?vin=1FTFW1E86HFA12345')
    })
  })

  // ---------------------------------------------------------------------------
  // Suite 5: Hold & DealerMail Cross-Card Coordination (F11 x F15 x F21)
  // ---------------------------------------------------------------------------
  describe('Suite 5: Hold & DealerMail Cross-Card Coordination (F11 x F15 x F21)', () => {
    it('T3-20: Active hold card displays salesperson name and formatted expiration datetime', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', hasActiveHold: true, position: 'primary', canViewEvidence: true },
        holdEvidence: [
          {
            id: 'h1',
            position: 'primary',
            salesperson: 'Sarah Jenkins',
            customerOrReason: 'Deposit placed',
            expiresAt: '2026-09-01T15:00:00Z',
          },
        ],
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      expect(screen.getByText(/Held · Sarah Jenkins/i)).toBeInTheDocument()
      expect(baseElement.querySelector('.vdp-hold-timer')).toHaveTextContent(/Sep 1/i)
    })

    it('T3-21: Clicking DealerMail button opens DealerMail drawer/modal', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', hasActiveHold: true, canManageHold: true, canViewEvidence: true },
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const dmButton = screen.getByRole('button', { name: /Update Hold/i })
      fireEvent.click(dmButton)
      expect(screen.getByRole('button', { name: /Hide Tools/i })).toBeInTheDocument()
      expect(baseElement.querySelector('.vdp-dealermail-drawer')).toBeInTheDocument()
    })

    it('T3-22: InventoryTable displays hold status and salesperson pill matching hold evidence', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', hasActiveHold: true, position: 'primary', canViewEvidence: true },
        holdEvidence: [{ id: 'h1', position: 'primary', salesperson: 'Sarah Jenkins', customerOrReason: 'Reserved' }],
      })
      render(
        <InventoryTable
          vehicles={[v]}
          selectedVehicleId={null}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      )

      expect(screen.getByText('Held · Sarah Jenkins')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Suite 6: Custody & Movement Integration (F17 x F24 x F22)
  // ---------------------------------------------------------------------------
  describe('Suite 6: Custody & Movement Integration (F17 x F24 x F22)', () => {
    it('T3-23: Clicking Track Movement in table row calls onTrackMovement callback with vehicle', () => {
      const onTrack = vi.fn()
      const v = createMockVehicle({ movement: { requestId: 'MOV-1234', state: 'In transit' } })
      render(
        <InventoryTable
          vehicles={[v]}
          selectedVehicleId={null}
          sorts={[]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
          onTrackMovement={onTrack}
        />
      )

      const trackBtn = screen.getByRole('button', { name: /Track movement/i })
      fireEvent.click(trackBtn)
      expect(onTrack).toHaveBeenCalledWith(v)
    })

    it('T3-24: Clicking Track Movement in VDP action dock calls onTrackMovement callback with vehicle', () => {
      const onTrack = vi.fn()
      const v = createMockVehicle({ movement: { requestId: 'MOV-1234', state: 'In transit' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onTrackMovement={onTrack} onClose={vi.fn()} />)

      const buttons = screen.getAllByRole('button', { name: /Track movement/i })
      fireEvent.click(buttons[0])
      expect(onTrack).toHaveBeenCalledWith(v)
    })

    it('T3-25: Request vehicle button triggers onRequestVehicle callback when permitted', () => {
      const onRequest = vi.fn()
      const v = createMockVehicle({
        movement: undefined,
        location: { homeStore: { id: 'fowlerville', name: 'Fowlerville' }, currentStore: 'Fowlerville' },
      })
      render(
        <VehicleWorkspaceV2
          vehicle={v}
          homeStore="Howell"
          canRequestVehicle={true}
          onRequestVehicle={onRequest}
          onClose={vi.fn()}
        />
      )

      const reqBtn = screen.getByRole('button', { name: /Request vehicle/i })
      fireEvent.click(reqBtn)
      expect(onRequest).toHaveBeenCalledWith(v)
    })

    it('T3-26: Disabling canRequestVehicle suppresses Request action in VDP', () => {
      const v = createMockVehicle({
        location: { homeStore: { id: 'fowlerville', name: 'Fowlerville' }, currentStore: 'Fowlerville' },
      })
      render(
        <VehicleWorkspaceV2
          vehicle={v}
          homeStore="Howell"
          canRequestVehicle={false}
          onRequestVehicle={vi.fn()}
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: /Request vehicle/i })).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Suite 7: Media Gallery & Vehicle Transition Synchronization (F8 x F7 x F20)
  // ---------------------------------------------------------------------------
  describe('Suite 7: Media Gallery & Vehicle Transition Synchronization (F8 x F7 x F20)', () => {
    it('T3-27: Keyboard ArrowRight navigates to next image in VehicleGallery', () => {
      const v = createMockVehicle({
        imageUrl: 'https://example.com/p1.jpg',
        imageUrls: ['https://example.com/p1.jpg', 'https://example.com/p2.jpg'],
        photoCount: 2,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)

      const gallery = baseElement.querySelector('.inventory-workspace-gallery')
      expect(gallery).toBeInTheDocument()
      fireEvent.keyDown(gallery!, { key: 'ArrowRight' })

      const img = baseElement.querySelector('.inventory-workspace-gallery__stage img')
      expect(img).toHaveAttribute('src', 'https://example.com/p2.jpg')
    })

    it('T3-28: Changing vehicle prop resets gallery active index and displays new vehicle images', () => {
      const v1 = createMockVehicle({
        id: 'V1',
        imageUrl: 'https://example.com/v1.jpg',
        imageUrls: ['https://example.com/v1.jpg'],
      })
      const v2 = createMockVehicle({
        id: 'V2',
        imageUrl: 'https://example.com/v2.jpg',
        imageUrls: ['https://example.com/v2.jpg'],
      })

      const { rerender, baseElement } = render(<VehicleWorkspaceV2 vehicle={v1} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.inventory-workspace-gallery__stage img')).toHaveAttribute('src', 'https://example.com/v1.jpg')

      rerender(<VehicleWorkspaceV2 vehicle={v2} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.inventory-workspace-gallery__stage img')).toHaveAttribute('src', 'https://example.com/v2.jpg')
    })

    it('T3-29: Switching to a vehicle with 0 photos renders empty state without crashing', () => {
      const vWithPhotos = createMockVehicle({ id: 'V-HAS', imageUrl: 'https://example.com/p1.jpg', imageUrls: ['https://example.com/p1.jpg'] })
      const vEmpty = createMockVehicle({ id: 'V-EMPTY', imageUrl: null, imageUrls: [], photoCount: 0 })

      const { rerender, baseElement } = render(<VehicleWorkspaceV2 vehicle={vWithPhotos} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.inventory-workspace-gallery__stage img')).toBeInTheDocument()

      rerender(<VehicleWorkspaceV2 vehicle={vEmpty} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.inventory-workspace-gallery--empty')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Suite 8: Route Seam & Dynamic Loading Coexistence (F1 x F4 x F25)
  // ---------------------------------------------------------------------------
  describe('Suite 8: Route Seam & Dynamic Loading Coexistence (F1 x F4 x F25)', () => {
    it('T3-30: Route seam isV1Requested detects ?v=1 or ?version=1 query parameters', () => {
      expect(isV1Requested('?v=1')).toBe(true)
      expect(isV1Requested('?version=1')).toBe(true)
      expect(isV1Requested('?v=2')).toBe(false)
      expect(isV1Requested('')).toBe(false)
    })

    it('T3-31: loadInventoryPageV1 and loadInventoryPageV2 resolve distinct components safely', async () => {
      const v1Module = await loadInventoryPageV1()
      const v2Module = await loadInventoryPageV2()

      expect(typeof v1Module.default).toBe('function')
      expect(typeof v2Module.default).toBe('function')
      expect(v1Module.default).not.toBe(v2Module.default)
    })
  })
})
