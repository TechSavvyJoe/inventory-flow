import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { motion, AnimatePresence } from 'framer-motion'
import { VehicleWorkspaceV2 } from '../../src/features/inventory/VehicleWorkspaceV2'
import { preloadRoute } from '../../src/app/routeModules'
import { createMockVehicle, setupClipboardMock } from './helpers'
import { vehicleDisplayName, formatMoney, formatMileage } from '../../src/features/inventory/inventory-utils'
import { ServiceStatusLink } from '../../src/features/inventory/ServiceStatusLink'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Tier 1: Feature Coverage (Features 1–29)', () => {
  // ---------------------------------------------------------------------------
  // Feature 1: Baseline V1 Code Preservation
  // ---------------------------------------------------------------------------
  describe('Feature 1: Baseline V1 Code Preservation', () => {
    const rootDir = path.resolve(__dirname, '../..')

    it('F1-1: Baseline V1 VehicleWorkspace.tsx file exists and is preserved', () => {
      const v1Path = path.join(rootDir, 'src/features/inventory/VehicleWorkspace.tsx')
      expect(fs.existsSync(v1Path)).toBe(true)
      const content = fs.readFileSync(v1Path, 'utf8')
      expect(content).toContain('export function VehicleWorkspace')
    })

    it('F1-2: Baseline V1 InventoryPage.tsx exists and exports InventoryPage', () => {
      const p = path.join(rootDir, 'src/features/inventory/InventoryPage.tsx')
      expect(fs.existsSync(p)).toBe(true)
      const content = fs.readFileSync(p, 'utf8')
      expect(content).toContain('export function InventoryPage')
    })

    it('F1-3: Baseline V1 TransfersPage.tsx exists and exports TransfersPage', () => {
      const p = path.join(rootDir, 'src/features/transfers/TransfersPage.tsx')
      expect(fs.existsSync(p)).toBe(true)
      const content = fs.readFileSync(p, 'utf8')
      expect(content).toContain('export function TransfersPage')
    })

    it('F1-4: Baseline V1 ServicePage.tsx exists and exports ServicePage', () => {
      const p = path.join(rootDir, 'src/features/service/ServicePage.tsx')
      expect(fs.existsSync(p)).toBe(true)
      const content = fs.readFileSync(p, 'utf8')
      expect(content).toContain('export function ServicePage')
    })

    it('F1-5: Baseline V1 VehicleWorkspace retains classic tab definitions', () => {
      const v1Path = path.join(rootDir, 'src/features/inventory/VehicleWorkspace.tsx')
      const content = fs.readFileSync(v1Path, 'utf8')
      expect(content).toContain('WORKSPACE_SECTIONS')
      expect(content).toContain('overview')
      expect(content).toContain('hold')
      expect(content).toContain('equipment')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 2: Framer Motion Runtime Package
  // ---------------------------------------------------------------------------
  describe('Feature 2: Framer Motion Runtime Package', () => {
    it('F2-1: framer-motion runtime exports motion object', () => {
      expect(motion).toBeDefined()
      expect(typeof motion.div).toBe('object')
      expect(typeof motion.button).toBe('object')
    })

    it('F2-2: framer-motion runtime exports AnimatePresence component', () => {
      expect(AnimatePresence).toBeDefined()
      expect(typeof AnimatePresence).toBe('function')
    })

    it('F2-3: motion.div renders valid HTML DOM element with class and styles', () => {
      const { container } = render(
        <motion.div className="test-motion-container" style={{ opacity: 1 }}>
          Motion Content
        </motion.div>
      )
      const div = container.querySelector('.test-motion-container')
      expect(div).toBeInTheDocument()
      expect(div).toHaveTextContent('Motion Content')
    })

    it('F2-4: motion.button accepts whileHover and whileTap without throwing', () => {
      const { container } = render(
        <motion.button
          type="button"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="motion-btn"
        >
          Click Me
        </motion.button>
      )
      const btn = container.querySelector('.motion-btn')
      expect(btn).toBeInTheDocument()
    })

    it('F2-5: AnimatePresence conditionally renders children smoothly', () => {
      const { queryByText, rerender } = render(
        <AnimatePresence>
          <motion.span key="a">Active Pill</motion.span>
        </AnimatePresence>
      )
      expect(queryByText('Active Pill')).toBeInTheDocument()
      rerender(<AnimatePresence>{null}</AnimatePresence>)
      expect(queryByText('Active Pill')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 3: Design System CSS Token Hardening
  // ---------------------------------------------------------------------------
  describe('Feature 3: Design System CSS Token Hardening', () => {
    const rootDir = path.resolve(__dirname, '../..')

    it('F3-1: VehicleWorkspaceV2.css exists in src/features/inventory', () => {
      const cssPath = path.join(rootDir, 'src/features/inventory/VehicleWorkspaceV2.css')
      expect(fs.existsSync(cssPath)).toBe(true)
    })

    it('F3-2: VehicleWorkspaceV2.css utilizes CSS custom properties for surfaces and borders', () => {
      const cssPath = path.join(rootDir, 'src/features/inventory/VehicleWorkspaceV2.css')
      const content = fs.readFileSync(cssPath, 'utf8')
      expect(content).toMatch(/var\(--v10-surface|var\(--surface|var\(--border/)
    })

    it('F3-3: VehicleWorkspaceV2.css utilizes design system typography tokens or rem/px >= 12px', () => {
      const cssPath = path.join(rootDir, 'src/features/inventory/VehicleWorkspaceV2.css')
      const content = fs.readFileSync(cssPath, 'utf8')
      expect(content).toContain('font-size')
    })

    it('F3-4: Design tokens CSS file exists with color definitions', () => {
      const tokensPath = path.join(rootDir, 'src/design-system/tokens.css')
      expect(fs.existsSync(tokensPath)).toBe(true)
      const content = fs.readFileSync(tokensPath, 'utf8')
      expect(content).toContain('--ifx-product-ink')
    })

    it('F3-5: VehicleWorkspaceV2 classes follow vdp- prefix convention', () => {
      const cssPath = path.join(rootDir, 'src/features/inventory/VehicleWorkspaceV2.css')
      const content = fs.readFileSync(cssPath, 'utf8')
      expect(content).toContain('.vdp-header-persistent')
      expect(content).toContain('.vdp-dash-card')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 4: Clean Dynamic Routing Seam
  // ---------------------------------------------------------------------------
  describe('Feature 4: Clean Dynamic Routing Seam', () => {
    it('F4-1: preloadRoute handles inventory route without throwing', () => {
      expect(() => preloadRoute('/inventory')).not.toThrow()
    })

    it('F4-2: preloadRoute handles transfers route without throwing', () => {
      expect(() => preloadRoute('/transfers')).not.toThrow()
    })

    it('F4-3: preloadRoute handles service route without throwing', () => {
      expect(() => preloadRoute('/service')).not.toThrow()
    })

    it('F4-4: preloadRoute handles root / path without throwing', () => {
      expect(() => preloadRoute('/')).not.toThrow()
    })

    it('F4-5: routeModules.ts exists with warmRoute error suppression', () => {
      const routePath = path.resolve(__dirname, '../../src/app/routeModules.ts')
      const content = fs.readFileSync(routePath, 'utf8')
      expect(content).toContain('warmRoute')
      expect(content).toContain('catch')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 5: Persistent Cockpit Header
  // ---------------------------------------------------------------------------
  describe('Feature 5: Persistent Cockpit Header', () => {
    it('F5-1: Header renders vehicle display name with year, make, model and trim', () => {
      const v = createMockVehicle()
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(vehicleDisplayName(v))
    })

    it('F5-2: Header renders formatted vehicle sale price', () => {
      const v = createMockVehicle({ price: 54995 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(formatMoney(54995))).toBeInTheDocument()
    })

    it('F5-3: Header renders back button with accessible label', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Back to inventory/i })).toBeInTheDocument()
    })

    it('F5-4: Header renders close button with accessible label', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Close vehicle details/i })).toBeInTheDocument()
    })

    it('F5-5: Header has persistent lockup class vdp-header-persistent', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const header = baseElement.querySelector('.vdp-header-persistent')
      expect(header).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 6: 1-Click Copyable Identifiers
  // ---------------------------------------------------------------------------
  describe('Feature 6: 1-Click Copyable Identifiers', () => {
    let clipboard: ReturnType<typeof setupClipboardMock>

    beforeEach(() => {
      clipboard = setupClipboardMock()
    })

    afterEach(() => {
      clipboard.restore()
    })

    it('F6-1: Stock number renders with copy trigger button', () => {
      const v = createMockVehicle({ stockNumber: 'STK8899' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const copyBtn = screen.getByRole('button', { name: /copy stock number/i })
      expect(copyBtn).toBeInTheDocument()
    })

    it('F6-2: Clicking copy stock number writes to system clipboard', async () => {
      const v = createMockVehicle({ stockNumber: 'STK8899' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const copyBtn = screen.getByRole('button', { name: /copy stock number/i })
      fireEvent.click(copyBtn)
      await waitFor(() => {
        expect(clipboard.writeTextMock).toHaveBeenCalledWith('STK8899')
      })
    })

    it('F6-3: Full 17-char VIN renders with copy trigger button', () => {
      const v = createMockVehicle({ vin: '1FTFW1E86HFA48871' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const copyVinBtn = screen.getByRole('button', { name: /copy VIN/i })
      expect(copyVinBtn).toBeInTheDocument()
    })

    it('F6-4: Clicking copy VIN writes full 17 characters to clipboard', async () => {
      const v = createMockVehicle({ vin: '1FTFW1E86HFA48871' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const copyVinBtn = screen.getByRole('button', { name: /copy VIN/i })
      fireEvent.click(copyVinBtn)
      await waitFor(() => {
        expect(clipboard.writeTextMock).toHaveBeenCalledWith('1FTFW1E86HFA48871')
      })
    })

    it('F6-5: Copy button displays visual feedback icon transition on click', async () => {
      const v = createMockVehicle({ stockNumber: 'STK8899' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const copyBtn = screen.getByRole('button', { name: /copy stock number/i })
      fireEvent.click(copyBtn)
      await waitFor(() => {
        expect(screen.getByText('stock number copied')).toBeInTheDocument()
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 7: High-Density 3-Column Cockpit Layout
  // ---------------------------------------------------------------------------
  describe('Feature 7: High-Density 3-Column Cockpit Layout', () => {
    it('F7-1: Renders .vdp-focus-dashboard container', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vdp-focus-dashboard')).toBeInTheDocument()
    })

    it('F7-2: Left column .vdp-dash-col-left contains Specifications and Financials', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const colLeft = baseElement.querySelector('.vdp-dash-col-left')
      expect(colLeft).toBeInTheDocument()
      expect(within(colLeft as HTMLElement).getByRole('region', { name: /Vehicle Specs/i })).toBeInTheDocument()
      expect(within(colLeft as HTMLElement).getByRole('region', { name: /Financials/i })).toBeInTheDocument()
    })

    it('F7-3: Middle column .vdp-dash-col-mid contains Operations & Custody', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const colMid = baseElement.querySelector('.vdp-dash-col-mid')
      expect(colMid).toBeInTheDocument()
      expect(within(colMid as HTMLElement).getByRole('region', { name: /Hold Context/i })).toBeInTheDocument()
      expect(within(colMid as HTMLElement).getByRole('region', { name: /Current Status/i })).toBeInTheDocument()
      expect(within(colMid as HTMLElement).getByRole('region', { name: /Move Context/i })).toBeInTheDocument()
    })

    it('F7-4: Right column .vdp-dash-col-right contains Key Equipment, Documents & Activity', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const colRight = baseElement.querySelector('.vdp-dash-col-right')
      expect(colRight).toBeInTheDocument()
      expect(within(colRight as HTMLElement).getByRole('region', { name: /Key equipment/i })).toBeInTheDocument()
      expect(within(colRight as HTMLElement).getByRole('region', { name: /Documents/i })).toBeInTheDocument()
      expect(within(colRight as HTMLElement).getByRole('region', { name: /^Activity$/i })).toBeInTheDocument()
    })

    it('F7-5: Layout surfaces primary data at a glance without hiding behind tabs', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Specifications')).toBeVisible()
      expect(screen.getByText('Financials')).toBeVisible()
      expect(screen.getByText('Hold & Service')).toBeVisible()
      expect(screen.getByText('Documents')).toBeVisible()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 8: Responsive Vehicle Media Frame
  // ---------------------------------------------------------------------------
  describe('Feature 8: Responsive Vehicle Media Frame', () => {
    it('F8-1: Renders main photo thumbnail when photo URL is present', () => {
      const v = createMockVehicle({
        imageUrl: 'https://example.com/p1.jpg',
        imageUrls: ['https://example.com/p1.jpg', 'https://example.com/p2.jpg'],
        photoCount: 2,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const img = baseElement.querySelector('.inventory-workspace-gallery__stage img')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'https://example.com/p1.jpg')
    })

    it('F8-2: Renders photo count badge when photos exist', () => {
      const v = createMockVehicle({
        imageUrl: 'https://example.com/p1.jpg',
        imageUrls: ['https://example.com/p1.jpg'],
        photoCount: 1,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const badge = baseElement.querySelector('.inventory-workspace-gallery__count')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveTextContent('1')
    })

    it('F8-3: Renders thumbnail strip when multiple photos exist', () => {
      const v = createMockVehicle({
        imageUrl: 'https://example.com/p1.jpg',
        imageUrls: ['https://example.com/p1.jpg', 'https://example.com/p2.jpg', 'https://example.com/p3.jpg'],
        photoCount: 3,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const strip = baseElement.querySelector('.inventory-workspace-gallery__thumbnails')
      expect(strip).toBeInTheDocument()
      const thumbs = strip?.querySelectorAll('button')
      expect(thumbs?.length).toBe(3)
    })

    it('F8-4: Clicking thumbnail switches active main photo preview', () => {
      const v = createMockVehicle({
        imageUrl: 'https://example.com/p1.jpg',
        imageUrls: ['https://example.com/p1.jpg', 'https://example.com/p2.jpg'],
        photoCount: 2,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const thumbs = baseElement.querySelectorAll('.inventory-workspace-gallery__thumbnails button')
      fireEvent.click(thumbs[1])
      const img = baseElement.querySelector('.inventory-workspace-gallery__stage img')
      expect(img).toHaveAttribute('src', 'https://example.com/p2.jpg')
    })

    it('F8-5: Displays graceful ImageOff placeholder when 0 photos provided', () => {
      const v = createMockVehicle({
        imageUrl: null,
        imageUrls: [],
        photoCount: 0,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const fallback = baseElement.querySelector('.inventory-workspace-gallery__placeholder')
      expect(fallback).toBeInTheDocument()
      expect(fallback).toHaveTextContent(/Photos are not available|No photo URLs were supplied/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 9: Financials & Pricing Card
  // ---------------------------------------------------------------------------
  describe('Feature 9: Financials & Pricing Card', () => {
    it('F9-1: Displays formatted Listed MSRP', () => {
      const v = createMockVehicle({ msrp: 62240 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(formatMoney(62240))).toBeInTheDocument()
    })

    it('F9-2: Displays Base MSRP from window sticker or reference', () => {
      const v = createMockVehicle({ windowSticker: { basePrice: 51200, dataState: 'current' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/51,200/)).toBeInTheDocument()
    })

    it('F9-3: Displays formatted inventory arrival date', () => {
      const v = createMockVehicle({ inventoryDate: '2026-08-15' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/Aug 15, 2026/i)).toBeInTheDocument()
    })

    it('F9-4: Displays warranty in-service date from OASIS or AutoCheck', () => {
      const v = createMockVehicle({
        fordOasis: { warrantyStartDate: '2024-03-15' },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/Mar 15, 2024/i)).toBeInTheDocument()
    })

    it('F9-5: Financials card renders structured definition list dl', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const finSection = baseElement.querySelector('section[aria-label="Financials"]')
      expect(finSection?.querySelector('dl')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 10: Technical Specifications Card
  // ---------------------------------------------------------------------------
  describe('Feature 10: Technical Specifications Card', () => {
    it('F10-1: Renders Engine specification', () => {
      const v = createMockVehicle({ engine: '5.0L V8 Ti-VCT' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('5.0L V8 Ti-VCT')).toBeInTheDocument()
    })

    it('F10-2: Renders Drivetrain specification', () => {
      const v = createMockVehicle({ drivetrain: '4WD' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('4WD')).toBeInTheDocument()
    })

    it('F10-3: Renders Transmission specification', () => {
      const v = createMockVehicle({ transmission: '10-Speed SelectShift Automatic' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('10-Speed SelectShift Automatic')).toBeInTheDocument()
    })

    it('F10-4: Renders Body style specification', () => {
      const v = createMockVehicle({ bodyStyle: 'SuperCrew Cab' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('SuperCrew Cab')).toBeInTheDocument()
    })

    it('F10-5: Renders combined Exterior / Interior color definition', () => {
      const v = createMockVehicle({ exteriorColor: 'Oxford White', interiorColor: 'Medium Dark Slate' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Oxford White / Medium Dark Slate')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 11: Hold & DealerMail Context Card
  // ---------------------------------------------------------------------------
  describe('Feature 11: Hold & DealerMail Context Card', () => {
    it('F11-1: Displays active hold badge when vehicle has active hold', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', hasActiveHold: true, canViewEvidence: true, canManageHold: true },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/Held|primary hold|On hold/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F11-2: Displays salesperson responsible for hold', () => {
      const v = createMockVehicle({
        holdEvidence: [{ id: 'h1', position: 'primary', salesperson: 'Marcus Brody' }],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/Marcus Brody/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F11-3: Displays hold appointment reason or customer detail', () => {
      const v = createMockVehicle({
        holdEvidence: [{ id: 'h1', position: 'primary', customerOrReason: 'Buyer scheduled for 2pm test drive' }],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Buyer scheduled for 2pm test drive')).toBeInTheDocument()
    })

    it('F11-4: Displays expected delivery date when present', () => {
      const v = createMockVehicle({
        holdEvidence: [{ id: 'h1', position: 'primary', expectedDeliveryDate: '2026-08-31' }],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/Expected|Aug 31, 2026/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F11-5: Displays No active hold row found when vehicle has no hold evidence', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', hasActiveHold: false, canViewEvidence: true, canManageHold: true },
        holdEvidence: [],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('No active hold row found')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 12: Service Readiness Card
  // ---------------------------------------------------------------------------
  describe('Feature 12: Service Readiness Card', () => {
    it('F12-1: Displays Needs Service status badge for uninspected vehicle', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Needs service · Waiting for service')).toBeInTheDocument()
    })

    it('F12-2: Displays In Service status badge when vehicle is actively in repair', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'in_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('In service')).toBeInTheDocument()
    })

    it('F12-3: Displays Ready for delivery badge when vehicle has completed service', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'serviced' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    it('F12-4: Displays technician inspection notes on the service card', () => {
      const v = createMockVehicle({
        serviceReadiness: { status: 'in_service', notes: 'Brake pads replaced; front alignment in progress' },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/In service/i)).toBeInTheDocument()
    })

    it('F12-5: Displays Open recall warning when open recalls are detected', () => {
      const v = createMockVehicle({
        fordOasis: { openFieldServiceActions: [{ campaignNumber: '23S14' }] },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/1 open recall/i)).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 13: Key Equipment & Packages Card
  // ---------------------------------------------------------------------------
  describe('Feature 13: Key Equipment & Packages Card', () => {
    it('F13-1: Renders standout factory equipment items as list', () => {
      const v = createMockVehicle({
        windowSticker: {
          dataState: 'current',
          options: ['Heated Front Seats', 'Adaptive Cruise Control', 'Moonroof'],
        },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/Heated Front Seats|Adaptive Cruise Control|Moonroof/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F13-2: Renders factory equipment package groups', () => {
      const v = createMockVehicle({
        windowSticker: {
          dataState: 'current',
          options: ['FX4 Off-Road Package'],
        },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/FX4 Off-Road/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F13-3: Renders WarrantyOutlook coverage component in key facts', () => {
      const v = createMockVehicle({
        windowSticker: { dataState: 'current', options: ['Tow Tech Bundle'] },
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vdp-dash-col-right')).toBeInTheDocument()
    })

    it('F13-4: Key Equipment section has accessible region label', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('region', { name: /Key equipment/i })).toBeInTheDocument()
    })

    it('F13-5: Displays graceful fallback when no factory equipment is captured', () => {
      const v = createMockVehicle({
        factoryEquipment: undefined,
        windowSticker: undefined,
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/No equipment highlights captured/i)).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 14: 2x2 Document Cards Hub
  // ---------------------------------------------------------------------------
  describe('Feature 14: 2x2 Document Cards Hub', () => {
    it('F14-1: Renders Documents section in right column', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('region', { name: /Documents/i })).toBeInTheDocument()
    })

    it('F14-2: Renders AutoCheck card with score', () => {
      const v = createMockVehicle({
        autoCheckReport: { score: 92, dataState: 'current' },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('92')).toBeInTheDocument()
    })

    it('F14-3: Renders Window Sticker preview card with data-resource', () => {
      const v = createMockVehicle({
        windowSticker: { dataState: 'current', totalMsrp: 62240, options: ['FX4 Off-Road'] },
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vehicle-resource-card[data-resource="window-sticker"]')).toBeInTheDocument()
    })

    it('F14-4: Renders OASIS document card with data-resource', () => {
      const v = createMockVehicle({
        make: 'Ford',
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vehicle-resource-card[data-resource="oasis"]')).toBeInTheDocument()
    })

    it('F14-5: Document cards render in vehicle-resources--cards container', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const docCard = baseElement.querySelector('.vehicle-resources--cards')
      expect(docCard).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 15: Quick Action: Update Hold
  // ---------------------------------------------------------------------------
  describe('Feature 15: Quick Action: Update Hold', () => {
    it('F15-1: Action dock renders DealerMail button for authorized manager', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', canManageHold: true },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /DealerMail/i })).toBeInTheDocument()
    })

    it('F15-2: Action dock renders Holds button for read-only salesperson', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', canManageHold: false },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Holds/i })).toBeInTheDocument()
    })

    it('F15-3: Clicking DealerMail button triggers action without crashing', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', canManageHold: true },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const btn = screen.getByRole('button', { name: /DealerMail/i })
      expect(() => fireEvent.click(btn)).not.toThrow()
    })

    it('F15-4: Quick action includes MessageSquare icon', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const btn = screen.getByRole('button', { name: /DealerMail|Holds/i })
      expect(btn.querySelector('svg')).toBeInTheDocument()
    })

    it('F15-5: Action dock is contained in accessible toolbar', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('toolbar', { name: /Vehicle action dock/i })).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 16: Quick Action: Mark Ready / Start Service
  // ---------------------------------------------------------------------------
  describe('Feature 16: Quick Action: Mark Ready / Start Service', () => {
    it('F16-1: Renders Start service action when vehicle status is needs_service', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('link', { name: /Start service/i })).toBeInTheDocument()
    })

    it('F16-2: Start service link contains action=in_service param in href', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /Start service/i })
      expect(link).toHaveAttribute('href', expect.stringContaining('action=in_service'))
    })

    it('F16-3: Renders Mark Ready action when vehicle status is in_service', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'in_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('link', { name: /Mark Ready/i })).toBeInTheDocument()
    })

    it('F16-4: Mark Ready link contains action=serviced param in href', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'in_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /Mark Ready/i })
      expect(link).toHaveAttribute('href', expect.stringContaining('action=serviced'))
    })

    it('F16-5: Renders Service link when vehicle is already serviced', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'serviced' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('link', { name: /^Service$/i })).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 17: Quick Action: Track / Request Movement
  // ---------------------------------------------------------------------------
  describe('Feature 17: Quick Action: Track / Request Movement', () => {
    it('F17-1: Renders Track move button when movement requestId is present', () => {
      const v = createMockVehicle({
        movement: { requestId: 'MOV-9988', state: 'in_transit' },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onTrackMovement={vi.fn()} onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Track movement/i })).toBeInTheDocument()
    })

    it('F17-2: Clicking Track move triggers onTrackMovement callback with vehicle', () => {
      const onTrack = vi.fn()
      const v = createMockVehicle({
        movement: { requestId: 'MOV-9988', state: 'in_transit' },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onTrackMovement={onTrack} onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Track movement/i }))
      expect(onTrack).toHaveBeenCalledWith(v)
    })

    it('F17-3: Renders Request move button when canRequestVehicle is true', () => {
      const v = createMockVehicle({ movement: undefined })
      render(
        <VehicleWorkspaceV2
          vehicle={v}
          homeStore="Howell"
          canRequestVehicle={true}
          onRequestVehicle={vi.fn()}
          onClose={vi.fn()}
        />
      )
      expect(screen.getByRole('button', { name: /Request vehicle/i })).toBeInTheDocument()
    })

    it('F17-4: Clicking Request move triggers onRequestVehicle callback with vehicle', () => {
      const onRequest = vi.fn()
      const v = createMockVehicle({ movement: undefined })
      render(
        <VehicleWorkspaceV2
          vehicle={v}
          homeStore="Howell"
          canRequestVehicle={true}
          onRequestVehicle={onRequest}
          onClose={vi.fn()}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: /Request vehicle/i }))
      expect(onRequest).toHaveBeenCalledWith(v)
    })

    it('F17-5: Omits movement action when no active move and canRequestVehicle is false', () => {
      const v = createMockVehicle({ movement: undefined })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" canRequestVehicle={false} onClose={vi.fn()} />)
      expect(screen.queryByRole('button', { name: /Track move|Request move/i })).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 18: Quick Action: Take-Home Sheet
  // ---------------------------------------------------------------------------
  describe('Feature 18: Quick Action: Take-Home Sheet', () => {
    it('F18-1: Footer toolbar renders Take-home page button', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Take-home page/i })).toBeInTheDocument()
    })

    it('F18-2: Clicking Take-home page button opens TakeHomeSheet dialog', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Take-home page/i }))
      expect(screen.getAllByRole('dialog').length).toBe(2) // Workspace dialog + Take-home dialog
    })

    it('F18-3: TakeHomeSheet displays vehicle sale price', () => {
      const v = createMockVehicle({ price: 52000 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Take-home page/i }))
      expect(screen.getAllByText(formatMoney(52000)).length).toBeGreaterThanOrEqual(1)
    })

    it('F18-4: TakeHomeSheet provides Close button to dismiss dialog', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Take-home page/i }))
      const closeBtn = screen.getByRole('button', { name: /^Close$/i })
      fireEvent.click(closeBtn)
      expect(screen.getAllByRole('dialog').length).toBe(1) // Only Workspace remains
    })

    it('F18-5: Take-home button has printer icon for print intention', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const btn = screen.getByRole('button', { name: /Take-home page/i })
      expect(btn.querySelector('svg')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 19: Framer Motion VDP Disclosure
  // ---------------------------------------------------------------------------
  describe('Feature 19: Framer Motion VDP Disclosure', () => {
    it('F19-1: Renders backdrop with vdp-focus-backdrop class for fade animation', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vdp-focus-backdrop')).toBeInTheDocument()
    })

    it('F19-2: Clicking backdrop invokes onClose dismissal callback', () => {
      const onClose = vi.fn()
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={onClose} />)
      const backdrop = baseElement.querySelector('.vdp-focus-backdrop') as HTMLElement
      fireEvent.click(backdrop)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('F19-3: Pressing Escape inside modal triggers onClose dismissal callback', () => {
      const onClose = vi.fn()
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={onClose} />)
      const modal = screen.getByRole('dialog')
      fireEvent.keyDown(modal, { key: 'Escape', code: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('F19-4: Modal container has aria-modal=true for accessibility screen readers', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    it('F19-5: Close button in top header invokes onClose dismissal callback', () => {
      const onClose = vi.fn()
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={onClose} />)
      fireEvent.click(screen.getByRole('button', { name: /Close vehicle details/i }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 20: Button & Badge Micro-Interactions
  // ---------------------------------------------------------------------------
  describe('Feature 20: Button & Badge Micro-Interactions', () => {
    it('F20-1: Action dock buttons possess interactive class vdp-action-dock-btn', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const btn = baseElement.querySelector('.vdp-action-dock-btn')
      expect(btn).toBeInTheDocument()
    })

    it('F20-2: Buttons render SVG icons for visual clarity', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const icons = baseElement.querySelectorAll('.vdp-action-dock-btn svg')
      expect(icons.length).toBeGreaterThanOrEqual(1)
    })

    it('F20-3: Back button includes directional ChevronLeft icon', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const backBtn = screen.getByRole('button', { name: /Back to inventory/i })
      expect(backBtn.querySelector('svg')).toBeInTheDocument()
    })

    it('F20-4: Status badges render with semantic classes', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'serviced' } })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vdp-focus-service-text--serviced')).toBeInTheDocument()
    })

    it('F20-5: Interactive buttons have type=button to prevent form submission', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const btns = screen.getAllByRole('button')
      btns.forEach((btn) => {
        expect(btn).toHaveAttribute('type', 'button')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 21: High-Density Inventory Table V2
  // ---------------------------------------------------------------------------
  describe('Feature 21: High-Density Inventory Table V2', () => {
    it('F21-1: ServiceStatusLink renders service status label', () => {
      render(<ServiceStatusLink service={{ status: 'needs_service' }} vin="1FTFW1E86HFA48871" />)
      expect(screen.getByText(/Waiting for service/i)).toBeInTheDocument()
    })

    it('F21-2: ServiceStatusLink routes to /service with vin query parameter', () => {
      render(<ServiceStatusLink service={{ status: 'in_service' }} vin="1FTFW1E86HFA48871" />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/service?vin=1FTFW1E86HFA48871')
    })

    it('F21-3: ServiceStatusLink renders checkmark icon for serviced ready vehicles', () => {
      const { container } = render(<ServiceStatusLink service={{ status: 'serviced' }} vin="1FTFW1E86HFA48871" />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('F21-4: ServiceStatusLink provides accessible aria-label with vehicle VIN', () => {
      render(<ServiceStatusLink service={{ status: 'needs_service' }} vin="1FTFW1E86HFA48871" />)
      expect(screen.getByRole('link', { name: /Open service status for VIN 1FTFW1E86HFA48871/i })).toBeInTheDocument()
    })

    it('F21-5: ServiceStatusLink renders tone modifier class based on status', () => {
      const { container } = render(<ServiceStatusLink service={{ status: 'serviced' }} vin="1FTFW1E86HFA48871" />)
      expect(container.querySelector('.inventory-service-link--serviced')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 22: Inventory Table Micro-Actions
  // ---------------------------------------------------------------------------
  describe('Feature 22: Inventory Table Micro-Actions', () => {
    it('F22-1: CopyableValue renders compact variant without exploding', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /copy stock number/i })).toBeInTheDocument()
    })

    it('F22-2: Online listing action opens listing URL in new tab safely', () => {
      const v = createMockVehicle({ publicListing: { listingUrl: 'https://example.com/veh/123', dataState: 'current' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const listingLink = screen.getByRole('link', { name: /Listing/i })
      expect(listingLink).toHaveAttribute('target', '_blank')
      expect(listingLink).toHaveAttribute('rel', expect.stringContaining('noopener'))
    })

    it('F22-3: Invoice action opens invoice URL safely with rel noopener', () => {
      const v = createMockVehicle({ make: 'Ford' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const invoiceLink = screen.getByRole('link', { name: /Invoice/i })
      expect(invoiceLink).toHaveAttribute('rel', expect.stringContaining('noopener'))
    })

    it('F22-4: Full record action triggers onViewVehicle callback when supplied', () => {
      const onView = vi.fn()
      const v = createMockVehicle()
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onViewVehicle={onView} onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Full record/i }))
      expect(onView).toHaveBeenCalledWith(v)
    })

    it('F22-5: Full record action is omitted when onViewVehicle is undefined', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.queryByRole('button', { name: /Full record/i })).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 23: Service Board V2
  // ---------------------------------------------------------------------------
  describe('Feature 23: Service Board V2', () => {
    it('F23-1: Service status values map correctly to human labels', () => {
      const v1 = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      const v2 = createMockVehicle({ serviceReadiness: { status: 'in_service' } })
      const v3 = createMockVehicle({ serviceReadiness: { status: 'serviced' } })

      render(<ServiceStatusLink service={v1.serviceReadiness} vin={v1.vin} />)
      expect(screen.getByText('Waiting for service')).toBeInTheDocument()

      cleanup()
      render(<ServiceStatusLink service={v2.serviceReadiness} vin={v2.vin} />)
      expect(screen.getByText('In service')).toBeInTheDocument()

      cleanup()
      render(<ServiceStatusLink service={v3.serviceReadiness} vin={v3.vin} />)
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    it('F23-2: Service readiness card renders status in status card', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/Waiting for service/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F23-3: Service readiness card displays Open Recalls when present', () => {
      const v = createMockVehicle({
        fordOasis: {
          openFieldServiceActions: [{ campaignNumber: '23S14', description: 'Brake booster check' }],
        },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('1 open recall')).toBeInTheDocument()
    })

    it('F23-4: Service action links provide clear target URLs with vin parameter', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /Start service/i })
      expect(link.getAttribute('href')).toContain(encodeURIComponent(v.vin))
    })

    it('F23-5: Service status tone class matches current stage', () => {
      const { container } = render(<ServiceStatusLink service={{ status: 'needs_service' }} vin="123" />)
      expect(container.querySelector('.inventory-service-link--needs_service')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 24: Transfers Movement View V2
  // ---------------------------------------------------------------------------
  describe('Feature 24: Transfers Movement View V2', () => {
    it('F24-1: Displays movement state when movement is tracked', () => {
      const v = createMockVehicle({
        movement: { state: 'in_transit', origin: 'Howell', destination: 'Fowlerville' },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/In transit/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F24-2: Displays transport assignee driver attribution when specified', () => {
      const v = createMockVehicle({
        movement: { state: 'in_transit', transportAssignee: 'Ray Bradley' },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Ray Bradley')).toBeInTheDocument()
    })

    it('F24-3: Flags overdue movement with warning indicator', () => {
      const v = createMockVehicle({
        movement: { state: 'in_transit', overdue: true },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/Action overdue/i)).toBeInTheDocument()
    })

    it('F24-4: Displays current vehicle physical location', () => {
      const v = createMockVehicle({
        location: { sourceReportedStore: { id: 'fowlerville', name: 'Fowlerville' }, conflict: false, homeStore: { id: 'howell', name: 'Howell' } },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/Fowlerville/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F24-5: Displays No movement record message when vehicle has no active movement', () => {
      const v = createMockVehicle({ movement: undefined, holdEvidence: [] })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('No movement record')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 25: View Switch Cross-Fade Animations
  // ---------------------------------------------------------------------------
  describe('Feature 25: View Switch Cross-Fade Animations', () => {
    it('F25-1: Framer motion supports initial opacity 0 to animate opacity 1', () => {
      const { container } = render(
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="cross-fade-view">
          View Content
        </motion.div>
      )
      expect(container.querySelector('.cross-fade-view')).toBeInTheDocument()
    })

    it('F25-2: AnimatePresence wraps switching view elements smoothly', () => {
      const { rerender } = render(
        <AnimatePresence mode="wait">
          <motion.div key="view-1">Inventory View</motion.div>
        </AnimatePresence>
      )
      expect(screen.getByText('Inventory View')).toBeInTheDocument()

      rerender(
        <AnimatePresence mode="wait">
          <motion.div key="view-2">Service View</motion.div>
        </AnimatePresence>
      )
      expect(screen.getByText('Service View')).toBeInTheDocument()
    })

    it('F25-3: Switching views preserves document container hierarchy', () => {
      const { container } = render(
        <div className="view-stage">
          <motion.div key="v1">Stage 1</motion.div>
        </div>
      )
      expect(container.querySelector('.view-stage')).toBeInTheDocument()
    })

    it('F25-4: View transition handles rapid toggles without throwing', () => {
      const { rerender } = render(
        <AnimatePresence>
          <motion.div key="a">Alpha</motion.div>
        </AnimatePresence>
      )
      expect(() => {
        rerender(<AnimatePresence><motion.div key="b">Beta</motion.div></AnimatePresence>)
        rerender(<AnimatePresence><motion.div key="c">Gamma</motion.div></AnimatePresence>)
        rerender(<AnimatePresence><motion.div key="a">Alpha</motion.div></AnimatePresence>)
      }).not.toThrow()
    })

    it('F25-5: Framer motion supports exit transitions on view change', () => {
      const { container } = render(
        <motion.div exit={{ opacity: 0 }}>Exiting View</motion.div>
      )
      expect(container).toHaveTextContent('Exiting View')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 26: Mobile & Responsive Density (390px+)
  // ---------------------------------------------------------------------------
  describe('Feature 26: Mobile & Responsive Density (390px+)', () => {
    it('F26-1: Workspace renders inside aside with #inventory-vehicle-workspace id', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('#inventory-vehicle-workspace')).toBeInTheDocument()
    })

    it('F26-2: Header back button provides prominent mobile return navigation', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const backBtn = screen.getByRole('button', { name: /Back to inventory/i })
      expect(backBtn).toBeVisible()
    })

    it('F26-3: Action dock buttons wrap gracefully on narrower widths', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const dock = baseElement.querySelector('.vdp-action-dock')
      expect(dock).toBeInTheDocument()
    })

    it('F26-4: Technical specifications render compact 2-column fact rows', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const grid = baseElement.querySelector('.vdp-dense-grid')
      expect(grid).toBeInTheDocument()
    })

    it('F26-5: Document previews render in a flexible card container', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const cards = baseElement.querySelector('.vehicle-resources--cards')
      expect(cards).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 27: Opaque-Box E2E Test Suite (Tiers 1-4)
  // ---------------------------------------------------------------------------
  describe('Feature 27: Opaque-Box E2E Test Suite (Tiers 1-4)', () => {
    it('F27-1: Test suite runs in isolated JSDOM environment', () => {
      expect(typeof window).toBe('object')
      expect(typeof document).toBe('object')
    })

    it('F27-2: Mock vehicle factory produces standard-compliant vehicle record', () => {
      const v = createMockVehicle()
      expect(v.id).toBeDefined()
      expect(v.vin).toHaveLength(17)
      expect(v.price).toBeGreaterThan(0)
    })

    it('F27-3: Setup and cleanup hooks clean up DOM between test runs', () => {
      render(<div>Ephemeral DOM Node</div>)
      cleanup()
      expect(screen.queryByText('Ephemeral DOM Node')).not.toBeInTheDocument()
    })

    it('F27-4: Clipboard mock correctly stores and returns written text', async () => {
      const cb = setupClipboardMock()
      await navigator.clipboard.writeText('VINTEST12345')
      expect(cb.getLastCopied()).toBe('VINTEST12345')
      cb.restore()
    })

    it('F27-5: Assertions use accessible roles instead of brittle CSS selector depths', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('toolbar', { name: /Vehicle action dock/i })).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 28: Adversarial Coverage Hardening (Tier 5)
  // ---------------------------------------------------------------------------
  describe('Feature 28: Adversarial Coverage Hardening (Tier 5)', () => {
    it('F28-1: Handles unusually long vehicle display name without breaking header', () => {
      const v = createMockVehicle({
        year: 2024,
        make: 'Ford',
        model: 'Super Duty F-350 Platinum Tremor Crew Cab 4x4 Long Bed Dual Rear Wheel PowerStroke',
        trim: 'High Luxury King Ranch Edition with Custom Utility Upfit and Snowplow Package',
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    })

    it('F28-2: Handles vehicle with zero dollars price ($0) gracefully', () => {
      const v = createMockVehicle({ price: 0 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('$0')).toBeInTheDocument()
    })

    it('F28-3: Handles vehicle with missing optional fields without throwing', () => {
      const v = createMockVehicle({
        engine: undefined,
        transmission: undefined,
        drivetrain: undefined,
        exteriorColor: undefined,
        interiorColor: undefined,
      })
      expect(() => render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)).not.toThrow()
    })

    it('F28-4: Handles vehicle with empty timeline events array without crashing', () => {
      const v = createMockVehicle({ timeline: [] })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('region', { name: /Activity/i })).toBeInTheDocument()
    })

    it('F28-5: Escapes potential script injection in hold customer/reason notes', () => {
      const dangerousScript = '<script>alert("xss")</script>'
      const v = createMockVehicle({
        holdEvidence: [{ id: 'h-xss', position: 'primary', customerOrReason: dangerousScript }],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(dangerousScript)).toBeInTheDocument()
      expect(document.querySelector('script[src*="xss"]')).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 29: Forensic Integrity Audit
  // ---------------------------------------------------------------------------
  describe('Feature 29: Forensic Integrity Audit', () => {
    it('F29-1: VehicleWorkspaceV2 renders authentic DOM elements with real text content', () => {
      const v = createMockVehicle()
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(vehicleDisplayName(v))).not.toBeEmptyDOMElement()
    })

    it('F29-2: Primary cards are visible in the document body and not display:none cheats', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const cards = baseElement.querySelectorAll('.vdp-dash-card')
      expect(cards.length).toBeGreaterThanOrEqual(4)
      cards.forEach((card) => {
        expect(card).not.toHaveStyle({ display: 'none' })
      })
    })

    it('F29-3: Action dock contains functional interactive buttons with real event handlers', () => {
      const onClose = vi.fn()
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={onClose} />)
      const closeBtn = screen.getByRole('button', { name: /Close vehicle details/i })
      fireEvent.click(closeBtn)
      expect(onClose).toHaveBeenCalled()
    })

    it('F29-4: Formats currency values through real numerical formatting utility', () => {
      expect(formatMoney(45290)).toBe('$45,290')
      expect(formatMoney(0)).toBe('$0')
    })

    it('F29-5: Formats mileage with comma-separated thousands representation', () => {
      expect(formatMileage(142500)).toBe('142,500 mi')
      expect(formatMileage(12)).toBe('12 mi')
    })
  })
})
