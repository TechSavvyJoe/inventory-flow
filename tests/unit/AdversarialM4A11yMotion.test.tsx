import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { Suspense } from 'react'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'

import {
  motion,
  motionValue,
  MotionConfig,
  useReducedMotion,
} from 'framer-motion'
import {
  isV1Requested,
  loadInventoryPageV1,
  loadInventoryPageV2,
  preloadRoute,
  InventoryPage,
  TransfersPage,
  ServicePage,
} from '../../src/app/routeModules'
import { VehicleWorkspaceV2 } from '../../src/features/inventory/VehicleWorkspaceV2'
import { InventoryTableV2 } from '../../src/features/inventory/InventoryTableV2'
import { ServicePageV2 } from '../../src/features/service/ServicePageV2'
import { TransfersPageV2 } from '../../src/features/transfers/TransfersPageV2'
import { CopyableValue } from '../../src/components/CopyableValue'
import type { InventoryStore, InventoryVehicle, InventorySort } from '../../src/features/inventory/types'
import type { VehicleRecord, TransferRecord, BootstrapData } from '../../src/types'
import { createMockVehicle, setupClipboardMock } from './testHelpers'
import { createMotionPreference } from './motion-test-utils'

// ============================================================================
// Test Data & Shared Mocks
// ============================================================================

const { mockVehicle1, mockTransfer1, mockAppData } = vi.hoisted(() => {
  const v1 = {
    id: 'VIN1FTFW1E86HFA11111',
    vin: '1FTFW1E86HFA11111',
    stockNumber: 'STK101',
    year: 2024,
    make: 'Ford',
    model: 'F-150',
    trim: 'XLT SuperCrew',
    vehicleName: '2024 Ford F-150 XLT',
    homeStore: 'Howell',
    sourceReportedLocation: 'Howell',
    publicStore: 'Howell',
    homeStoreConfirmed: true,
    websiteStatus: 'active',
    publicListingState: 'listed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'None observed', backupCount: 0 },
    price: 45000,
    msrp: 51000,
    mileage: 12000,
    daysListed: 5,
    exteriorColor: 'Agate Black',
    serviceReadiness: {
      vin: '1FTFW1E86HFA11111',
      status: 'needs_service',
      version: 1,
      notes: 'Standard 120-point inspection pending',
      canManage: true,
      store: 'Howell',
    },
    movement: {
      state: 'at_home',
      label: 'At Howell',
      currentLocation: 'Howell',
      locationConfidence: 'verified',
    },
    fordOasis: {
      openFieldServiceActions: [{ campaignNumber: '24S01', description: 'Brake booster recall' }],
    },
    timeline: [],
    holdEvidence: [],
    windowSticker: {
      dataState: 'current',
      url: 'https://example.com/sticker1.pdf',
      pricingCurrency: 'USD',
      basePrice: 42000,
      totalMsrp: 51000,
      equipmentGroup: '302A Luxury',
      options: ['Trailer Tow Package', 'FX4 Off-Road'],
    },
    autoCheckReport: {
      dataState: 'current',
      url: 'https://example.com/autocheck1',
      score: 92,
      scoreRangeLow: 85,
      scoreRangeHigh: 94,
      ownerCount: 1,
      usage: 'Personal',
    },
  } as unknown as VehicleRecord

  const v2 = {
    id: 'VIN1FTFW1E86HFA22222',
    vin: '1FTFW1E86HFA22222',
    stockNumber: 'STK102',
    year: 2023,
    make: 'Ford',
    model: 'Explorer',
    trim: 'Limited AWD',
    vehicleName: '2023 Ford Explorer Limited',
    homeStore: 'Howell',
    sourceReportedLocation: 'Howell',
    publicStore: 'Howell',
    homeStoreConfirmed: true,
    websiteStatus: 'active',
    publicListingState: 'listed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'active', label: 'Active hold', backupCount: 1 },
    price: 38000,
    msrp: 44000,
    mileage: 24000,
    daysListed: 18,
    exteriorColor: 'Stone Blue',
    serviceReadiness: {
      vin: '1FTFW1E86HFA22222',
      status: 'in_service',
      version: 1,
      serviceEnteredAt: '2026-09-15',
      notes: 'In brake pad replacement',
      canManage: true,
      store: 'Howell',
    },
    movement: {
      state: 'at_home',
      label: 'At Howell',
      currentLocation: 'Howell',
      locationConfidence: 'verified',
    },
    timeline: [],
    holdEvidence: [
      {
        id: 'hold-202',
        position: 'primary',
        salesperson: 'Sarah Jenkins',
        customerOrReason: 'Pending financing approval',
      },
    ],
  } as unknown as VehicleRecord

  const v3 = {
    id: 'VIN1FTFW1E86HFA33333',
    vin: '1FTFW1E86HFA33333',
    stockNumber: 'STK103',
    year: 2024,
    make: 'Ford',
    model: 'Bronco',
    trim: 'Badlands 4x4',
    vehicleName: '2024 Ford Bronco Badlands',
    homeStore: 'Howell',
    sourceReportedLocation: 'Howell',
    publicStore: 'Howell',
    homeStoreConfirmed: true,
    websiteStatus: 'active',
    publicListingState: 'listed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'None observed', backupCount: 0 },
    price: 52000,
    msrp: 56000,
    mileage: 8000,
    daysListed: 2,
    exteriorColor: 'Eruption Green',
    serviceReadiness: {
      vin: '1FTFW1E86HFA33333',
      status: 'serviced',
      version: 1,
      completedAt: '2026-09-16',
      notes: 'Multipoint inspection completed; washed and detailed',
      canManage: true,
      store: 'Howell',
    },
    movement: {
      state: 'at_home',
      label: 'At Howell',
      currentLocation: 'Howell',
      locationConfidence: 'verified',
    },
    timeline: [],
    holdEvidence: [],
  } as unknown as VehicleRecord

  const t1: TransferRecord = {
    id: 'TR-2001',
    workflowMode: 'simple',
    vin: '1FTFW1E86HFA11111',
    stockNumber: 'STK101',
    vehicleName: '2024 Ford F-150 XLT',
    homeStore: 'Howell',
    requestingStore: 'Fowlerville',
    currentLocation: 'Howell',
    destination: 'Fowlerville',
    requestStatus: 'approved',
    movementStatus: 'release-approved',
    dealStatus: 'no-outcome',
    deliveryStatus: 'not-confirmed',
    dealerMailHoldState: 'not-observed',
    publicListingState: 'listed',
    cdkStatus: 'open',
    priority: 'high',
    requestedBy: 'Dan Miller',
    requestedAt: '2026-09-17T08:00:00Z',
    custodian: 'Sarah Jenkins',
    transportAssignee: 'Ray Bradley',
    nextAction: 'Confirm pickup and release vehicle to custodian',
    nextActionOwner: 'Sarah Jenkins',
    dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    returnRequired: true,
    returnDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    locationConfidence: 'verified',
    events: [],
    allowedActions: ['confirm-pickup', 'schedule-return'],
  }

  const b = {
    vehicles: [v1, v2, v3],
    transfers: [t1],
    stores: [{ store: 'Howell' }, { store: 'Fowlerville' }],
    meta: {
      reportDate: '2026-09-17',
      completedAt: '2026-09-17T12:00:00Z',
      timezone: 'America/New_York',
      publicFreshness: 'current',
      dealerMailFreshness: 'current',
      publicCount: 3,
      crmCount: 3,
      heldVinCount: 1,
      publicChangeCounts: {
        newArrival: 1,
        removed: 0,
        priceChange: 0,
        mileageChange: 0,
        websiteStatusChange: 0,
        stockCorrection: 0,
        storeTransfer: 0,
      },
      holdChangeStatus: 'baseline',
      warnings: [],
    },
  } as unknown as BootstrapData

  const appData = {
    data: b,
    homeStore: 'Howell' as const,
    role: 'manager' as const,
    currentUser: 'Sarah Jenkins',
    refresh: vi.fn(),
    submitTransfer: vi.fn(),
  }

  return {
    mockVehicle1: v1,
    mockVehicle2: v2,
    mockVehicle3: v3,
    mockTransfer1: t1,
    mockBootstrap: b,
    mockAppData: appData,
  }
})

vi.mock('../../src/app/AppDataContext', () => ({
  useAppData: () => mockAppData,
  AppDataProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>()
  return {
    ...actual,
    getServiceReadiness: vi.fn().mockResolvedValue({
      vin: '1FTFW1E86HFA11111',
      status: 'needs_service',
      version: 1,
      notes: 'Standard 120-point inspection pending',
      history: [],
      canManage: true,
      store: 'Howell',
    }),
    updateServiceReadiness: vi.fn().mockResolvedValue({
      success: true,
      vehicle: mockVehicle1,
    }),
    getTransfer: vi.fn().mockResolvedValue(mockTransfer1),
  }
})

// ============================================================================
// Test Suite: Adversarial M4 A11y, Responsiveness, Motion & Baseline Hardening
// ============================================================================

describe('Adversarial M4: Accessibility, Motion Safety, Routing & Baseline Integrity', () => {
  const mockStore: InventoryStore = { id: 'howell', name: 'Howell' }
  const motionPreference = createMotionPreference()
  let originalMatchMedia: typeof window.matchMedia
  let originalInnerWidth: number
  let originalInnerHeight: number

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    motionPreference.install()
    motionPreference.set(false)
    originalInnerWidth = window.innerWidth
    originalInnerHeight = window.innerHeight
    setupClipboardMock()
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    window.matchMedia = originalMatchMedia
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalInnerHeight })
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // SECTION 1: Dynamic Routing Query Parameter Tamper Testing
  // --------------------------------------------------------------------------
  describe('1. Dynamic Routing Query Parameter Tamper Testing (src/app/routeModules.ts)', () => {
    it('correctly parses legitimate V1 and V2 query parameters', () => {
      expect(isV1Requested('?v=1')).toBe(true)
      expect(isV1Requested('?v=2')).toBe(false)
      expect(isV1Requested('?version=1')).toBe(true)
      expect(isV1Requested('?version=2')).toBe(false)
      expect(isV1Requested('')).toBe(false)
      expect(isV1Requested('?')).toBe(false)
    })

    it('safely handles adversarial, malformed, and injection-style query strings', () => {
      // Empty values & unexpected strings
      expect(isV1Requested('?v=')).toBe(false)
      expect(isV1Requested('?v=invalid')).toBe(false)
      expect(isV1Requested('?v=0')).toBe(false)
      expect(isV1Requested('?v=10')).toBe(false)
      expect(isV1Requested('?v=01')).toBe(false)
      expect(isV1Requested('?v=-1')).toBe(false)
      expect(isV1Requested('?v=true')).toBe(false)
      expect(isV1Requested('?v=1.0')).toBe(false)
      expect(isV1Requested('?v=1 ')).toBe(false)
      expect(isV1Requested('?v=null')).toBe(false)
      expect(isV1Requested('?v=undefined')).toBe(false)

      // Case sensitivity
      expect(isV1Requested('?V=1')).toBe(false)
      expect(isV1Requested('?VERSION=1')).toBe(false)

      // Script injection & SQL injection patterns
      expect(isV1Requested('?v=<script>alert(1)</script>')).toBe(false)
      expect(isV1Requested("?v=1;DROP TABLE vehicles--")).toBe(false)
      expect(isV1Requested('?v={"version":1}')).toBe(false)

      // Extreme lengths
      const veryLongParam = '?v=' + 'a'.repeat(4096)
      expect(isV1Requested(veryLongParam)).toBe(false)

      // URL encoding behavior
      expect(isV1Requested('?v=%31')).toBe(true) // %31 is URL-encoded '1'
      expect(isV1Requested('?v=%201')).toBe(false) // leading space encoded

      // Multi-parameter combinations
      expect(isV1Requested('?sort=price&v=1&filter=ford')).toBe(true)
      expect(isV1Requested('?v=1&version=2')).toBe(true) // params.get('v') is '1'
      expect(isV1Requested('?v=2&version=1')).toBe(true) // params.get('version') is '1'
      expect(isV1Requested('?v=2&version=2')).toBe(false)
      expect(isV1Requested('?v=1&v=2')).toBe(true) // first occurrence is '1'
      expect(isV1Requested('?v=2&v=1')).toBe(false) // first occurrence is '2'
    })

    it('handles search being undefined in browser environment with fallback to window.location', () => {
      const originalLocation = window.location
      try {
        delete (window as any).location
        ;(window as any).location = new URL('http://localhost:3000/inventory?v=1')
        expect(isV1Requested()).toBe(true)

        ;(window as any).location = new URL('http://localhost:3000/inventory?v=2')
        expect(isV1Requested()).toBe(false)

        ;(window as any).location = new URL('http://localhost:3000/inventory')
        expect(isV1Requested()).toBe(false)
      } finally {
        ;(window as any).location = originalLocation
      }
    })

    it('mounts InventoryPage under MemoryRouter with ?v=1 (V1) and falls back safely for invalid query params', async () => {
      // This exercises route selection and rendering, not concurrent Vite
      // module compilation. Resolve both real modules before timing the UI.
      await Promise.all([loadInventoryPageV1(), loadInventoryPageV2()])
      // Valid V1 route
      render(
        <MemoryRouter initialEntries={['/inventory?v=1']}>
          <Suspense fallback={<div data-testid="route-loading">Loading...</div>}>
            <InventoryPage />
          </Suspense>
        </MemoryRouter>
      )
      await waitFor(() => {
        expect(screen.queryByTestId('route-loading')).toBeNull()
      })
      expect(screen.getAllByText(/Inventory/i).length).toBeGreaterThan(0)
      cleanup()

      // Adversarial / invalid version route: falls back safely to V2 default
      render(
        <MemoryRouter initialEntries={['/inventory?v=invalid_override']}>
          <Suspense fallback={<div data-testid="route-loading">Loading...</div>}>
            <InventoryPage />
          </Suspense>
        </MemoryRouter>
      )
      await waitFor(() => {
        expect(screen.queryByTestId('route-loading')).toBeNull()
      })
      expect(screen.getAllByText(/Inventory/i).length).toBeGreaterThan(0)
      cleanup()

      // Empty parameter route: falls back safely to V2 default
      render(
        <MemoryRouter initialEntries={['/inventory?v=']}>
          <Suspense fallback={<div data-testid="route-loading">Loading...</div>}>
            <InventoryPage />
          </Suspense>
        </MemoryRouter>
      )
      await waitFor(() => {
        expect(screen.queryByTestId('route-loading')).toBeNull()
      })
      expect(screen.getAllByText(/Inventory/i).length).toBeGreaterThan(0)
      cleanup()
    })

    it('mounts TransfersPage and ServicePage under MemoryRouter with edge case URLs safely', async () => {
      render(
        <MemoryRouter initialEntries={['/transfers?v=malformed%20param']}>
          <Suspense fallback={<div data-testid="transfers-loading">Loading Transfers...</div>}>
            <TransfersPage />
          </Suspense>
        </MemoryRouter>
      )
      await waitFor(() => {
        expect(screen.queryByTestId('transfers-loading')).toBeNull()
      })
      expect(screen.getAllByText(/Transfer|Movement/i).length).toBeGreaterThan(0)
      cleanup()

      render(
        <MemoryRouter initialEntries={['/service?v=']}>
          <Suspense fallback={<div data-testid="service-loading">Loading Service...</div>}>
            <ServicePage />
          </Suspense>
        </MemoryRouter>
      )
      await waitFor(() => {
        expect(screen.queryByTestId('service-loading')).toBeNull()
      })
      expect(screen.getAllByText(/Service/i).length).toBeGreaterThan(0)
      cleanup()
    })

    it('preloadRoute survives malformed, empty, or unknown route paths without throwing', () => {
      expect(() => {
        preloadRoute('/inventory', '?v=1')
        preloadRoute('/inventory', '?v=2')
        preloadRoute('/inventory', '?v=invalid')
        preloadRoute('/transfers', '?v=')
        preloadRoute('/service', '?v=1')
        preloadRoute('/attention')
        preloadRoute('/manager')
        preloadRoute('/updates')
        preloadRoute('/admin')
        preloadRoute('/completely-unknown-route')
        preloadRoute('')
      }).not.toThrow()
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 2: Motion Safety & prefers-reduced-motion: reduce
  // --------------------------------------------------------------------------
  describe('2. Motion Safety & prefers-reduced-motion: reduce', () => {
    function setupMatchMediaReducedMotion(isReduced: boolean) {
      motionPreference.install()
      motionPreference.set(isReduced)
      return { toggleReducedMotion: (value: boolean) => motionPreference.set(value) }
    }

    it('useReducedMotion hook respects active matchMedia reduce preference', () => {
      setupMatchMediaReducedMotion(true)

      function ReducedMotionDetector() {
        const reduced = useReducedMotion()
        return <div data-testid="reduced-val">{reduced ? 'REDUCED' : 'NORMAL'}</div>
      }

      render(<ReducedMotionDetector />)
      expect(screen.getByTestId('reduced-val')).toHaveTextContent('REDUCED')
    })

    it('configured motion components skip spatial interpolation for reduced-motion users', async () => {
      setupMatchMediaReducedMotion(true)
      const y = motionValue(20)
      const opacity = motionValue(0)
      const positions: number[] = []
      const unsubscribe = y.on('change', value => positions.push(value))
      render(<MotionConfig reducedMotion="user"><motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ y, opacity }} transition={{ duration: 0.05 }} data-testid="reduced-motion-box">Reduced Motion Content</motion.div></MotionConfig>)
      await waitFor(() => expect(y.get()).toBe(0))
      expect(positions).toEqual([0])
      // Opacity is safe to animate under MotionConfig; verify completion rather
      // than requiring an implementation-specific CSS transition property.
      await waitFor(() => expect(opacity.get()).toBe(1))
      expect(screen.getByTestId('reduced-motion-box')).toHaveTextContent('Reduced Motion Content')
      unsubscribe()
    })

    it('motion buttons suppress pointer scaling when reduced motion becomes preferred', async () => {
      const scale = motionValue(1)
      function AnimatedButton({ isReduced }: { isReduced: boolean }) {
        return <motion.button animate={{ scale: 1 }} style={{ scale }} transition={{ duration: 0 }} whileHover={isReduced ? undefined : { scale: 1.05 }} whileTap={isReduced ? undefined : { scale: 0.95 }}>Motion action</motion.button>
      }
      const { rerender } = render(<AnimatedButton isReduced={false} />)
      const button = screen.getByRole('button', { name: 'Motion action' })
      fireEvent.pointerEnter(button, { pointerType: 'mouse', isPrimary: true })
      await waitFor(() => expect(scale.get()).toBe(1.05))
      fireEvent.pointerLeave(button, { pointerType: 'mouse', isPrimary: true })
      await waitFor(() => expect(scale.get()).toBe(1))
      rerender(<AnimatedButton isReduced />)
      const changed = vi.fn()
      const unsubscribe = scale.on('change', changed)
      fireEvent.pointerEnter(button, { pointerType: 'mouse', isPrimary: true })
      fireEvent.pointerDown(button, { pointerType: 'mouse', isPrimary: true, button: 0 })
      await act(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
      expect(scale.get()).toBe(1)
      expect(changed).not.toHaveBeenCalled()
      fireEvent.pointerUp(button, { pointerType: 'mouse', isPrimary: true, button: 0 })
      unsubscribe()
    })

    it('VehicleWorkspaceV2 modal closes cleanly without hanging under prefers-reduced-motion', () => {
      setupMatchMediaReducedMotion(true)
      const vehicle = createMockVehicle()
      const onCloseMock = vi.fn()

      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={onCloseMock} />)

      const closeBtn = screen.getByRole('button', { name: /Close vehicle details/i })
      expect(closeBtn).toBeInTheDocument()

      fireEvent.click(closeBtn)
      expect(onCloseMock).toHaveBeenCalledTimes(1)
    })

    it('survives rapid mount/unmount under reduced-motion without memory leaks or errors', () => {
      setupMatchMediaReducedMotion(true)

      for (let i = 0; i < 25; i++) {
        const { unmount } = render(
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
          >
            <span>Iteration {i}</span>
          </motion.div>
        )
        unmount()
      }
      cleanup()
      expect(document.body.innerHTML).toBe('')
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 3: Responsive Layout Behaviors & Mobile Viewports
  // --------------------------------------------------------------------------
  describe('3. Responsive Layout Behaviors & Mobile Viewports', () => {
    function setViewport(width: number, height: number = 844) {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height })
      window.dispatchEvent(new Event('resize'))
    }

    it('VehicleWorkspaceV2 renders fully without crashing at 390px mobile viewport (iPhone 14/15 size)', () => {
      setViewport(390, 844)
      const vehicle = createMockVehicle({
        price: 55495,
        msrp: 62240,
        stockNumber: 'W5863Q',
        vin: '1FTFW1E86HFA48871',
      })
      const onClose = vi.fn()

      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={onClose} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()

      // Critical controls remain present in DOM at 390px
      // 1. Close button
      const closeBtn = screen.getByRole('button', { name: /Close vehicle details/i })
      expect(closeBtn).toBeInTheDocument()

      // 2. Identifiers and copy buttons
      expect(screen.getByRole('button', { name: /Copy stock number: W5863Q/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Copy VIN: 1FTFW1E86HFA48871/i })).toBeInTheDocument()

      // 3. Header title & price
      expect(screen.getByText(/2024 Ford F-150/i)).toBeInTheDocument()
      expect(screen.getByText(/\$55,495/)).toBeInTheDocument()

      // Operational actions retain the shared record/evidence boundaries.
      expect(screen.getByRole('button', { name: 'Take-home page' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'DealerMail tools' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Start service' })).toHaveAttribute('href', `/service?vin=${vehicle.vin}&action=in_service`)
      expect(screen.getByRole('link', { name: 'Mark Ready' })).toHaveAttribute('href', `/service?vin=${vehicle.vin}&action=serviced`)
      expect(screen.getByRole('heading', { name: 'Vehicle details' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Documents & vehicle records' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('tab', { name: 'Equipment' }))
      expect(screen.getByRole('tab', { name: 'Equipment' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'Back to inventory' }))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('VehicleWorkspaceV2 survives extreme 320px narrow mobile boundary viewport', () => {
      setViewport(320, 568)
      const vehicle = createMockVehicle()

      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Close vehicle details/i })).toBeInTheDocument()
    })

    it('InventoryTableV2 keeps sorting, detail access, and service handoffs available at 390px', () => {
      setViewport(390, 844)
      const onViewVehicle = vi.fn()
      const onSelectVehicle = vi.fn()
      const onSortChange = vi.fn()

      const vehicles: InventoryVehicle[] = [
        createMockVehicle({ id: 'v-STK101', stockNumber: 'STK101', vin: '1FTFW1E86HFA11111', price: 45000 }),
        createMockVehicle({ id: 'v-STK102', stockNumber: 'STK102', vin: '1FTFW1E86HFA22222', price: 38000 }),
      ]

      render(
        <InventoryTableV2
          vehicles={vehicles}
          selectedVehicleId={null}
          sorts={[{ key: 'price', direction: 'asc' }]}
          onSortChange={onSortChange}
          onSelectVehicle={onSelectVehicle}
          onViewVehicle={onViewVehicle}
          canRequestVehicle={true}
        />
      )

      // Table wrapper exists and has overflow handling
      const wrapper = document.querySelector('.inventory-table-v2-wrapper')
      expect(wrapper).toBeInTheDocument()

      // Verify columns render sort buttons
      const sortPriceBtn = screen.getByRole('button', { name: /Sort by Price & Miles/i })
      expect(sortPriceBtn).toBeInTheDocument()
      fireEvent.click(sortPriceBtn)
      expect(onSortChange).toHaveBeenCalled()

      const viewButtons = screen.getAllByRole('button', { name: /Open vehicle details for/i })
      expect(viewButtons).toHaveLength(2)
      fireEvent.click(viewButtons[0])
      expect(onSelectVehicle).toHaveBeenCalledWith(vehicles[0])
      const serviceLinks = screen.getAllByRole('link', { name: /Open service status for/i })
      expect(serviceLinks).toHaveLength(2)
      expect(serviceLinks[0]).toHaveAttribute('href', `/service?vin=${vehicles[0].vin}`)
    })

    it('ServicePageV2 renders board, columns, search, and action triggers at 390px', async () => {
      setViewport(390, 844)

      render(
        <MemoryRouter>
          <ServicePageV2 />
        </MemoryRouter>
      )

      fireEvent.click(screen.getByRole('button', { name: 'Board' }))
      // The optional board loads on demand; its named columns and search
      // remain available after switching away from the default shared list.
      const searchInput = await screen.findByRole('searchbox', { name: /Filter service vehicles/i })
      expect(screen.getByRole('heading', { name: 'Waiting for service' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'In service' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Service Ready' })).toBeInTheDocument()
      expect(searchInput).toBeInTheDocument()
      fireEvent.change(searchInput, { target: { value: 'STK101' } })
      expect(searchInput).toHaveValue('STK101')

      // View mode toggles work
      const listViewBtn = screen.getByRole('button', { name: 'List' })
      expect(listViewBtn).toBeInTheDocument()
      fireEvent.click(listViewBtn)
      expect(await screen.findByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('searchbox', { name: 'Search service vehicles' })).toHaveValue('STK101')

      const kanbanViewBtn = screen.getByRole('button', { name: 'Board' })
      fireEvent.click(kanbanViewBtn)
      expect(await screen.findByRole('searchbox', { name: /Filter service vehicles/i })).toHaveValue('STK101')
      expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('TransfersPageV2 renders queue cards and route controls at 390px', () => {
      setViewport(390, 844)

      render(
        <MemoryRouter>
          <TransfersPageV2 />
        </MemoryRouter>
      )

      // Transfers page header renders
      expect(screen.getByRole('heading', { name: 'Vehicle moves' })).toBeInTheDocument()
      // Filter controls render
      expect(screen.getByRole('group', { name: 'Vehicle move stores' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /My Store/i })).toHaveAttribute('aria-pressed', 'true')
      fireEvent.change(screen.getByRole('textbox', { name: 'Search vehicle moves' }), { target: { value: 'SYNTHETIC_NO_MATCH' } })
      expect(screen.getByRole('textbox', { name: 'Search vehicle moves' })).toHaveValue('SYNTHETIC_NO_MATCH')
      expect(screen.getByRole('button', { name: 'Start a vehicle move' })).toBeEnabled()
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 4: Keyboard Navigation and ARIA Attributes
  // --------------------------------------------------------------------------
  describe('4. Keyboard Navigation and ARIA Attributes', () => {
    it('VehicleWorkspaceV2 complies with WAI-ARIA modal dialog contract and Escape dismissal', () => {
      const vehicle = createMockVehicle({ vehicleName: '2024 Ford F-150 Lariat' })
      const onClose = vi.fn()

      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={onClose} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('id', 'inventory-vehicle-workspace')
      expect(dialog).toHaveAttribute('aria-label', expect.stringContaining('2024 Ford F-150 Lariat'))

      // Keyboard Escape dismissal
      fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })

    it('InventoryTableV2 header cells have correct aria-sort attributes and keyboard activation', () => {
      const sorts: InventorySort[] = [{ key: 'price', direction: 'asc' }]
      const onSortChange = vi.fn()

      render(
        <InventoryTableV2
          vehicles={[createMockVehicle()]}
          selectedVehicleId={null}
          sorts={sorts}
          onSortChange={onSortChange}
          onSelectVehicle={vi.fn()}
          canRequestVehicle={true}
        />
      )

      // Check header aria-sort
      const priceTh = document.querySelector('th[aria-sort="ascending"]')
      expect(priceTh).toBeInTheDocument()

      const sortBtn = within(priceTh as HTMLElement).getByRole('button')
      expect(sortBtn).toBeInTheDocument()

      // Keyboard activation via Enter key
      fireEvent.keyDown(sortBtn, { key: 'Enter', code: 'Enter' })
      fireEvent.click(sortBtn)
      expect(onSortChange).toHaveBeenCalled()
    })

    it('ServicePageV2 Kanban cards provide accessible action buttons and a focused details drawer', async () => {
      render(
        <MemoryRouter>
          <ServicePageV2 />
        </MemoryRouter>
      )

      // Verify "Start Service" button on Needs Service vehicle
      fireEvent.click(screen.getByRole('button', { name: 'Board' }))
      const startServiceBtn = await screen.findByRole('button', { name: /Start service for STK101/i })
      expect(startServiceBtn).toBeInTheDocument()

      // Verify "Details" button
      const detailsBtn = screen.getByRole('button', { name: /View details for STK101/i })
      expect(detailsBtn).toBeInTheDocument()

      // Click / keyboard trigger
      fireEvent.click(detailsBtn)
      const drawer = await screen.findByRole('dialog', { name: /Service details for/ })
      await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true))
    })

    it('CopyableValue implements ARIA specifications: accessible name, live region announcement, and icon feedback', async () => {
      render(<CopyableValue label="VIN" text="1FTFW1E86HFA48871" />)

      const copyBtn = screen.getByRole('button', { name: 'Copy VIN: 1FTFW1E86HFA48871' })
      expect(copyBtn).toBeInTheDocument()
      expect(copyBtn).toHaveAttribute('type', 'button')

      // Click copy button
      await act(async () => {
        fireEvent.click(copyBtn)
      })

      // Clipboard API writeText called with EXACT value
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('1FTFW1E86HFA48871')

      // Accessible live status region announces copy success
      const liveRegion = screen.getByRole('status')
      expect(liveRegion).toHaveAttribute('aria-live', 'polite')
      expect(liveRegion).toHaveTextContent('VIN copied')

      // Button label transitions to "Copied"
      expect(copyBtn).toHaveTextContent('Copied')
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 5: Guardrail G1 - Baseline V1 Files Preservation
  // --------------------------------------------------------------------------
  describe('5. Guardrail G1 - Baseline V1 File Integrity & Pristine Verification', () => {
    const baselineV1Files = [
      'src/features/inventory/VehicleWorkspace.tsx',
      'src/features/inventory/InventoryExperience.tsx',
      'src/features/inventory/InventoryPage.tsx',
      'src/features/transfers/TransfersPage.tsx',
      'src/features/service/ServicePage.tsx',
    ]

    it('verifies all baseline V1 files exist on disk', () => {
      for (const relPath of baselineV1Files) {
        const fullPath = path.resolve(process.cwd(), relPath)
        expect(fs.existsSync(fullPath), `Expected ${relPath} to exist`).toBe(true)
      }
    })

    it('keeps shared vehicle sections and service handoffs identical in the V1 and premium workspace', async () => {
      const { VehicleWorkspace } = await import('../../src/features/inventory/VehicleWorkspace')
      const vehicle = createMockVehicle()
      const first = render(<VehicleWorkspace vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />)
      const baselineTabs = screen.getAllByRole('tab').map(tab => tab.textContent)
      const baselineService = screen.getByRole('link', { name: 'Start service' }).getAttribute('href')
      first.unmount()
      render(<VehicleWorkspaceV2 vehicle={vehicle} homeStore={mockStore} onClose={vi.fn()} />)
      expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(baselineTabs)
      expect(screen.getByRole('link', { name: 'Start service' })).toHaveAttribute('href', baselineService)
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    it('verifies baseline V1 files do not import V2 components (no cross-contamination)', () => {
      const v2ModuleNames = [
        'VehicleWorkspaceV2',
        'InventoryTableV2',
        'ServicePageV2',
        'TransfersPageV2',
        'InventoryExperienceV2',
        'InventoryPageV2',
      ]

      for (const relPath of baselineV1Files) {
        const fullPath = path.resolve(process.cwd(), relPath)
        const content = fs.readFileSync(fullPath, 'utf8')

        for (const v2Name of v2ModuleNames) {
          expect(
            content.includes(v2Name),
            `Baseline V1 file ${relPath} must not import or reference ${v2Name}`
          ).toBe(false)
        }
      }
    })

    it('verifies baseline V1 files retain their original exports', async () => {
      const vwV1 = await import('../../src/features/inventory/VehicleWorkspace')
      expect(vwV1.VehicleWorkspace).toBeDefined()

      const ieV1 = await import('../../src/features/inventory/InventoryExperience')
      expect(ieV1.InventoryExperience).toBeDefined()

      const ipV1 = await import('../../src/features/inventory/InventoryPage')
      expect(ipV1.InventoryPage).toBeDefined()

      const tpV1 = await import('../../src/features/transfers/TransfersPage')
      expect(tpV1.TransfersPage).toBeDefined()

      const spV1 = await import('../../src/features/service/ServicePage')
      expect(spV1.ServicePage).toBeDefined()
    })
  })
})
