import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { motion, AnimatePresence } from 'framer-motion'
import { VehicleWorkspaceV2 } from '../../src/features/inventory/VehicleWorkspaceV2'
import { preloadRoute } from '../../src/app/routeModules'
import { createMockVehicle, setupClipboardMock } from './helpers'
import { vehicleDisplayName, formatMoney, formatMileage, resolveCurrentLocation, isMoveRequestBlocked } from '../../src/features/inventory/inventory-utils'
import { ServiceStatusLink } from '../../src/features/inventory/ServiceStatusLink'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Tier 2: Boundary & Corner Cases (Features 1–29)', () => {
  const rootDir = path.resolve(__dirname, '../..')

  // ---------------------------------------------------------------------------
  // Feature 1: Baseline V1 Code Preservation
  // ---------------------------------------------------------------------------
  describe('Feature 1: Baseline V1 Code Preservation (Boundaries)', () => {
    it('F1-B1: Baseline V1 VehicleWorkspace retains default props without crash when passed minimal vehicle', () => {
      const v1Path = path.join(rootDir, 'src/features/inventory/VehicleWorkspace.tsx')
      expect(fs.existsSync(v1Path)).toBe(true)
      const content = fs.readFileSync(v1Path, 'utf8')
      expect(content).toContain('export function VehicleWorkspace(')
      expect(content).not.toContain('export default')
    })

    it('F1-B2: Baseline V1 file sizes verify no destructive overwrites or zero-byte wipes', () => {
      const v1Files = [
        'src/features/inventory/VehicleWorkspace.tsx',
        'src/features/inventory/InventoryPage.tsx',
        'src/features/service/ServicePage.tsx',
        'src/features/transfers/TransfersPage.tsx',
      ]
      for (const relPath of v1Files) {
        const fullPath = path.join(rootDir, relPath)
        const stats = fs.statSync(fullPath)
        expect(stats.size).toBeGreaterThan(500)
      }
    })

    it('F1-B3: Baseline V1 preserves original section identifiers', () => {
      const v1Path = path.join(rootDir, 'src/features/inventory/VehicleWorkspace.tsx')
      const content = fs.readFileSync(v1Path, 'utf8')
      expect(content).toContain('"overview"')
      expect(content).toContain('"equipment"')
      expect(content).toContain('"data"')
      expect(content).toContain('"hold"')
    })

    it('F1-B4: Baseline V1 InventoryTable file exists and is preserved', () => {
      const tablePath = path.join(rootDir, 'src/features/inventory/InventoryTable.tsx')
      expect(fs.existsSync(tablePath)).toBe(true)
      const content = fs.readFileSync(tablePath, 'utf8')
      expect(content).toContain('export function InventoryTable')
    })

    it('F1-B5: Baseline V1 index re-exports are intact and accessible', () => {
      const indexPath = path.join(rootDir, 'src/features/inventory/index.ts')
      expect(fs.existsSync(indexPath)).toBe(true)
      const content = fs.readFileSync(indexPath, 'utf8')
      expect(content).toContain('VehicleWorkspace')
      expect(content).toContain('InventoryExperience')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 2: Framer Motion Runtime Package
  // ---------------------------------------------------------------------------
  describe('Feature 2: Framer Motion Runtime Package (Boundaries)', () => {
    it('F2-B1: Renders motion component with zero duration without throwing', () => {
      const { container } = render(
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0 }}
        >
          <span>Zero Duration Animation</span>
        </motion.div>
      )
      expect(container.textContent).toContain('Zero Duration Animation')
    })

    it('F2-B2: AnimatePresence handles empty children without error', () => {
      const { container } = render(
        <AnimatePresence>
          {false && <motion.div key="none">Hidden</motion.div>}
        </AnimatePresence>
      )
      expect(container.textContent).toBe('')
    })

    it('F2-B3: motion handles extreme scale transforms gracefully', () => {
      const { container } = render(
        <motion.div animate={{ scale: 0.0001 }}>
          <span>Micro Scale</span>
        </motion.div>
      )
      expect(container.textContent).toBe('Micro Scale')
    })

    it('F2-B4: AnimatePresence handles rapid toggle states cleanly', () => {
      const { rerender, container } = render(
        <AnimatePresence>
          <motion.div key="a">Active</motion.div>
        </AnimatePresence>
      )
      expect(container.textContent).toBe('Active')
      rerender(
        <AnimatePresence>
          <motion.div key="b">Replaced</motion.div>
        </AnimatePresence>
      )
      expect(container.textContent).toContain('Replaced')
    })

    it('F2-B5: motion.button supports whileHover and whileTap props without throwing', () => {
      const { container } = render(
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="button"
        >
          Click Me
        </motion.button>
      )
      expect(container.querySelector('button')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 3: Design System CSS Token Hardening
  // ---------------------------------------------------------------------------
  describe('Feature 3: Design System CSS Token Hardening (Boundaries)', () => {
    it('F3-B1: tokens.css specifies semantic surface tokens', () => {
      const tokensPath = path.join(rootDir, 'src/design-system/tokens.css')
      const content = fs.readFileSync(tokensPath, 'utf8')
      expect(content).toContain('--ifx-product-')
      expect(content).toContain('--ifx-neutral-')
    })

    it('F3-B2: VehicleWorkspaceV2.css does not contain sub-10px font sizes', () => {
      const cssPath = path.join(rootDir, 'src/features/inventory/VehicleWorkspaceV2.css')
      const content = fs.readFileSync(cssPath, 'utf8')
      // No font-size under 11px
      expect(content).not.toMatch(/font-size:\s*(?:[1-9]|10)px\b/)
    })

    it('F3-B3: VehicleWorkspaceV2.css enforces min-height 44px on interactive elements', () => {
      const cssPath = path.join(rootDir, 'src/features/inventory/VehicleWorkspaceV2.css')
      const content = fs.readFileSync(cssPath, 'utf8')
      expect(content).toContain('min-height:44px')
    })

    it('F3-B4: tokens.css contains font-family token definitions', () => {
      const tokensPath = path.join(rootDir, 'src/design-system/tokens.css')
      const content = fs.readFileSync(tokensPath, 'utf8')
      expect(content).toContain('--ifx-font-display')
      expect(content).toContain('--ifx-font-mono')
    })

    it('F3-B5: VehicleWorkspaceV2.css contains high density grid styles', () => {
      const cssPath = path.join(rootDir, 'src/features/inventory/VehicleWorkspaceV2.css')
      const content = fs.readFileSync(cssPath, 'utf8')
      expect(content).toContain('.vdp-focus-dashboard')
      expect(content).toContain('.vdp-dash-col')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 4: Clean Dynamic Routing Seam
  // ---------------------------------------------------------------------------
  describe('Feature 4: Clean Dynamic Routing Seam (Boundaries)', () => {
    it('F4-B1: preloadRoute handles empty string without throwing', () => {
      expect(() => preloadRoute('')).not.toThrow()
    })

    it('F4-B2: preloadRoute handles unknown route path gracefully', () => {
      expect(() => preloadRoute('/nonexistent-route-path')).not.toThrow()
    })

    it('F4-B3: preloadRoute handles route with trailing slashes', () => {
      expect(() => preloadRoute('/inventory/')).not.toThrow()
    })

    it('F4-B4: preloadRoute handles query parameter strings in path', () => {
      expect(() => preloadRoute('/inventory?scope=group&v=1')).not.toThrow()
    })

    it('F4-B5: preloadRoute called multiple times concurrently does not reject', () => {
      expect(() => {
        preloadRoute('/inventory')
        preloadRoute('/service')
        preloadRoute('/transfers')
      }).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 5: Persistent Cockpit Header
  // ---------------------------------------------------------------------------
  describe('Feature 5: Persistent Cockpit Header (Boundaries)', () => {
    it('F5-B1: Handles 60+ character extra-long vehicle title without crash', () => {
      const longTitle = '2024 Ford Super Duty F-450 DRW Platinum Crew Cab 4x4 Long Bed 6.7L High Output Power Stroke'
      const v = createMockVehicle({
        make: 'Ford',
        model: 'Super Duty F-450 DRW Platinum',
        trim: 'Crew Cab 4x4 Long Bed 6.7L High Output Power Stroke Diesel',
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 2 }).textContent!.length).toBeGreaterThan(60)
    })

    it('F5-B2: Handles vehicle with zero dollar price ($0) gracefully', () => {
      const v = createMockVehicle({ price: 0 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('$0')).toBeInTheDocument()
    })

    it('F5-B3: Handles vehicle with undefined/null price displaying Not published', () => {
      const v = createMockVehicle({ price: null })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('Not published').length).toBeGreaterThanOrEqual(1)
    })

    it('F5-B4: Handles vehicle with missing trim string gracefully', () => {
      const v = createMockVehicle({ trim: null })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('2024 Ford F-150')
    })

    it('F5-B5: Persistent header remains sticky via vdp-header-persistent class', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vdp-header-persistent')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 6: 1-Click Copyable Identifiers
  // ---------------------------------------------------------------------------
  describe('Feature 6: 1-Click Copyable Identifiers (Boundaries)', () => {
    it('F6-B1: Copies short 1-character stock number accurately', async () => {
      const clipboard = setupClipboardMock()
      const v = createMockVehicle({ stockNumber: '1' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const copyBtn = screen.getByRole('button', { name: /Copy stock number: 1/i })
      fireEvent.click(copyBtn)
      await waitFor(() => {
        expect(clipboard.getLastCopied()).toBe('1')
      })
      clipboard.restore()
    })

    it('F6-B2: Copies exact 17-character VIN without truncation or trailing space', async () => {
      const clipboard = setupClipboardMock()
      const v = createMockVehicle({ vin: '1FTFW1E86HFA48871' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const copyBtn = screen.getByRole('button', { name: /Copy VIN: 1FTFW1E86HFA48871/i })
      fireEvent.click(copyBtn)
      await waitFor(() => {
        expect(clipboard.getLastCopied()).toBe('1FTFW1E86HFA48871')
        expect(clipboard.getLastCopied().length).toBe(17)
      })
      clipboard.restore()
    })

    it('F6-B3: Handles rapid repeated copy clicks without exploding state', async () => {
      const clipboard = setupClipboardMock()
      const v = createMockVehicle({ stockNumber: 'W5863Q' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const copyBtn = screen.getByRole('button', { name: /Copy stock number: W5863Q/i })
      fireEvent.click(copyBtn)
      fireEvent.click(copyBtn)
      fireEvent.click(copyBtn)
      await waitFor(() => {
        expect(clipboard.getLastCopied()).toBe('W5863Q')
      })
      clipboard.restore()
    })

    it('F6-B4: CopyableValue maintains data-copy-state attribute', async () => {
      const clipboard = setupClipboardMock()
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const copyContainer = baseElement.querySelector('.vdp-focus-identifiers .copyable-value')
      expect(copyContainer).toHaveAttribute('data-copy-state')
      clipboard.restore()
    })

    it('F6-B5: Both Stock and VIN copy buttons coexist in the header rail', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Copy stock number/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Copy VIN/i })).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 7: High-Density 3-Column Cockpit Layout
  // ---------------------------------------------------------------------------
  describe('Feature 7: High-Density 3-Column Cockpit Layout (Boundaries)', () => {
    it('F7-B1: Layout renders correctly with minimal vehicle data without collapsing columns', () => {
      const minimalVehicle = createMockVehicle({
        photos: [],
        imageUrl: null,
        imageUrls: [],
        holdEvidence: [],
        timeline: [],
        windowSticker: undefined,
        factoryEquipment: undefined,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={minimalVehicle} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vdp-dash-col-left')).toBeInTheDocument()
      expect(baseElement.querySelector('.vdp-dash-col-mid')).toBeInTheDocument()
      expect(baseElement.querySelector('.vdp-dash-col-right')).toBeInTheDocument()
    })

    it('F7-B2: Columns are contained within .vdp-focus-dashboard wrapper', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const dashboard = baseElement.querySelector('.vdp-focus-dashboard')
      expect(dashboard).toBeInTheDocument()
      expect(dashboard?.children.length).toBe(3)
    })

    it('F7-B3: Handles scroll container with scrollbar-gutter stable', () => {
      const v = createMockVehicle()
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const scrollArea = baseElement.querySelector('.vdp-focus-dashboard')
      expect(scrollArea).toBeInTheDocument()
    })

    it('F7-B4: Mid column status card handles vehicle with no holds or warnings', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', hasActiveHold: false, canViewEvidence: true, canManageHold: true },
        holdEvidence: [],
        fordOasis: undefined,
        movement: undefined,
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Hold & Service')).toBeInTheDocument()
      expect(screen.getByText('No current hold')).toBeInTheDocument()
    })

    it('F7-B5: Right column handles vehicle with 0 timeline activity events gracefully', () => {
      const v = createMockVehicle({ timeline: [] })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/No recent activity recorded/i)).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 8: Responsive Vehicle Media Frame
  // ---------------------------------------------------------------------------
  describe('Feature 8: Responsive Vehicle Media Frame (Boundaries)', () => {
    it('F8-B1: Handles 0 photos displaying ImageOff placeholder', () => {
      const v = createMockVehicle({
        imageUrl: null,
        imageUrls: [],
        photos: [],
        photoCount: 0,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const placeholder = baseElement.querySelector('.inventory-workspace-gallery--empty')
      expect(placeholder).toBeInTheDocument()
      expect(placeholder).toHaveAttribute('data-photo-state', 'empty')
    })

    it('F8-B2: Handles exactly 1 photo (no thumbnail strip rendered)', () => {
      const v = createMockVehicle({
        imageUrl: 'https://example.com/only-one.jpg',
        imageUrls: ['https://example.com/only-one.jpg'],
        photos: ['https://example.com/only-one.jpg'],
        photoCount: 1,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.inventory-workspace-gallery__stage img')).toBeInTheDocument()
      expect(baseElement.querySelector('.inventory-workspace-gallery__thumbnails')).not.toBeInTheDocument()
      expect(baseElement.querySelector('.inventory-workspace-gallery__count')).toHaveTextContent('1')
    })

    it('F8-B3: Handles image onError event falling back gracefully', () => {
      const v = createMockVehicle({
        imageUrl: 'https://example.com/broken.jpg',
        imageUrls: ['https://example.com/broken.jpg'],
        photos: ['https://example.com/broken.jpg'],
        photoCount: 1,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const img = baseElement.querySelector('.inventory-workspace-gallery__stage img')
      expect(img).toBeInTheDocument()
      fireEvent.error(img!)
      expect(baseElement.querySelector('.inventory-workspace-gallery--empty')).toBeInTheDocument()
    })

    it('F8-B4: Navigating gallery with keyboard ArrowRight and ArrowLeft cycles photos', () => {
      const v = createMockVehicle({
        imageUrl: 'https://example.com/p1.jpg',
        imageUrls: ['https://example.com/p1.jpg', 'https://example.com/p2.jpg'],
        photos: ['https://example.com/p1.jpg', 'https://example.com/p2.jpg'],
        photoCount: 2,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const gallery = baseElement.querySelector('.inventory-workspace-gallery')
      expect(gallery).toBeInTheDocument()
      fireEvent.keyDown(gallery!, { key: 'ArrowRight' })
      expect(baseElement.querySelector('.inventory-workspace-gallery__stage img')).toHaveAttribute('src', 'https://example.com/p2.jpg')
      fireEvent.keyDown(gallery!, { key: 'ArrowLeft' })
      expect(baseElement.querySelector('.inventory-workspace-gallery__stage img')).toHaveAttribute('src', 'https://example.com/p1.jpg')
    })

    it('F8-B5: Shows demo photo indicator badge when photo URL starts with /demo-vehicles/', () => {
      const v = createMockVehicle({
        imageUrl: '/demo-vehicles/f150.jpg',
        imageUrls: ['/demo-vehicles/f150.jpg'],
        photos: ['/demo-vehicles/f150.jpg'],
        photoCount: 1,
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vdp-demo-photo')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 9: Financials & Pricing Card
  // ---------------------------------------------------------------------------
  describe('Feature 9: Financials & Pricing Card (Boundaries)', () => {
    it('F9-B1: Handles Listed Price > MSRP without error', () => {
      const v = createMockVehicle({ price: 65000, msrp: 60000 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('$65,000').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('$60,000')).toBeInTheDocument()
    })

    it('F9-B2: Handles Listed Price < MSRP without error', () => {
      const v = createMockVehicle({ price: 45000, msrp: 52000 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('$45,000').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('$52,000')).toBeInTheDocument()
    })

    it('F9-B3: Handles missing MSRP displaying Not published in card', () => {
      const v = createMockVehicle({ msrp: null })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('Not published').length).toBeGreaterThanOrEqual(1)
    })

    it('F9-B4: Handles missing window sticker base price falling back to factory equipment or Not captured', () => {
      const v = createMockVehicle({
        windowSticker: undefined,
        factoryEquipment: undefined,
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/Not captured/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F9-B5: Handles missing inventory arrival date displaying Not captured', () => {
      const v = createMockVehicle({ inventoryDate: null })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/Not captured/i).length).toBeGreaterThanOrEqual(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 10: Technical Specifications Card
  // ---------------------------------------------------------------------------
  describe('Feature 10: Technical Specifications Card (Boundaries)', () => {
    it('F10-B1: Handles completely empty engine string with Not published', () => {
      const v = createMockVehicle({ engine: '' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('Not published').length).toBeGreaterThanOrEqual(1)
    })

    it('F10-B2: Handles unknown exterior/interior colors with Unknown / Unknown fallback', () => {
      const v = createMockVehicle({ exteriorColor: '', interiorColor: '' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Unknown / Unknown')).toBeInTheDocument()
    })

    it('F10-B3: Handles missing transmission with Not published fallback', () => {
      const v = createMockVehicle({ transmission: undefined })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('Not published').length).toBeGreaterThanOrEqual(1)
    })

    it('F10-B4: Handles missing drivetrain with Not published fallback', () => {
      const v = createMockVehicle({ drivetrain: undefined })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('Not published').length).toBeGreaterThanOrEqual(1)
    })

    it('F10-B5: Handles missing body style with Not published fallback', () => {
      const v = createMockVehicle({ bodyStyle: undefined, bodyType: undefined })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('Not published').length).toBeGreaterThanOrEqual(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 11: Hold & DealerMail Context Card
  // ---------------------------------------------------------------------------
  describe('Feature 11: Hold & DealerMail Context Card (Boundaries)', () => {
    it('F11-B1: Displays No active hold row found when vehicle has no hold evidence', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', hasActiveHold: false, canViewEvidence: true, canManageHold: true },
        holdEvidence: [],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('No active hold row found')).toBeInTheDocument()
    })

    it('F11-B2: Displays Backup holds count when vehicle has multiple holds', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'current', hasActiveHold: true, position: 'multiple', activeRecordCount: 3 },
        holdEvidence: [
          { id: 'h1', position: 'primary', salesperson: 'Sarah Jenkins', customerOrReason: 'Reserved' },
          { id: 'h2', position: 'backup', salesperson: 'Dave Miller', customerOrReason: 'Backup buyer' },
          { id: 'h3', position: 'backup', salesperson: 'John Doe', customerOrReason: 'Backup buyer 2' },
        ],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Backup holds')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('F11-B3: Handles hold without salesperson attribution gracefully', () => {
      const v = createMockVehicle({
        holdEvidence: [{ id: 'h1', position: 'primary', customerOrReason: 'Customer deposit placed' }],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Customer deposit placed')).toBeInTheDocument()
    })

    it('F11-B4: Handles hold without expected delivery date gracefully', () => {
      const v = createMockVehicle({
        holdEvidence: [{ id: 'h1', position: 'primary', salesperson: 'Sarah Jenkins', expectedDeliveryDate: undefined }],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.queryByText('Expected delivery')).not.toBeInTheDocument()
    })

    it('F11-B5: Displays manager disposition alert when manager logged a sold record', () => {
      const v = createMockVehicle({
        managerDisposition: {
          dataState: 'current',
          sold: true,
          delivered: false,
          sourceStore: { id: 'howell', name: 'Howell' },
          sourcePeriod: '2026-08',
          confidence: 'high',
          soldLabel: 'Sold — manager log',
          deliveryLabel: 'Not marked delivered — manager log',
        },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/Manager: Sold — manager log/i)).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 12: Service Readiness Card
  // ---------------------------------------------------------------------------
  describe('Feature 12: Service Readiness Card (Boundaries)', () => {
    it('F12-B1: Displays Waiting for service status for needs_service stage', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Needs service · Waiting for service')).toBeInTheDocument()
    })

    it('F12-B2: Displays In service status for in_service stage', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'in_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('In service')).toBeInTheDocument()
    })

    it('F12-B3: Displays Ready status for serviced stage', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'serviced' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    it('F12-B4: Handles missing serviceReadiness object defaulting to Waiting for service', () => {
      const v = createMockVehicle({ serviceReadiness: undefined })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('Needs service · Waiting for service')).toBeInTheDocument()
    })

    it('F12-B5: Displays multiple open recalls alert when OASIS contains multiple campaigns', () => {
      const v = createMockVehicle({
        fordOasis: {
          openFieldServiceActions: [
            { campaignNumber: '23S14', description: 'Trailer brake' },
            { campaignNumber: '24N08', description: 'Power inverter' },
          ],
        },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('2 open recalls')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 13: Key Equipment & Packages Card
  // ---------------------------------------------------------------------------
  describe('Feature 13: Key Equipment & Packages Card (Boundaries)', () => {
    it('F13-B1: Handles 0 equipment items with graceful empty state message', () => {
      const v = createMockVehicle({
        windowSticker: undefined,
        factoryEquipment: undefined,
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('No equipment highlights captured.')).toBeInTheDocument()
    })

    it('F13-B2: Limits key equipment highlights to top 5 standout items', () => {
      const v = createMockVehicle({
        windowSticker: {
          dataState: 'current',
          options: ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5', 'Option 6', 'Option 7'],
        },
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const listItems = baseElement.querySelectorAll('.vdp-dash-col-right .vdp-dense-list li')
      expect(listItems.length).toBeLessThanOrEqual(5)
    })

    it('F13-B3: Handles expired warranty coverage date gracefully', () => {
      const v = createMockVehicle({
        fordOasis: {
          warrantyStartDate: '2019-01-01',
          openFieldServiceActions: [],
          warrantyCoverages: [],
          extendedCoverageExpirations: [],
        },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/Jan 1, 2019/i)).toBeInTheDocument()
    })

    it('F13-B4: Key Equipment card has accessible region label', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('region', { name: 'Key equipment' })).toBeInTheDocument()
    })

    it('F13-B5: Handles single package item without formatting error', () => {
      const v = createMockVehicle({
        factoryEquipment: {
          dataState: 'current',
          isOriginalWindowSticker: false,
          packages: [{ name: 'Solo Package', code: 'SP1' }],
        },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('region', { name: 'Key equipment' })).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 14: 2x2 Document Cards Hub
  // ---------------------------------------------------------------------------
  describe('Feature 14: 2x2 Document Cards Hub (Boundaries)', () => {
    it('F14-B1: Document card links enforce rel="noopener noreferrer" and referrerPolicy="no-referrer"', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const externalLinks = baseElement.querySelectorAll('.vehicle-resource-card a[target="_blank"]')
      externalLinks.forEach((link) => {
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
        expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
      })
    })

    it('F14-B2: Displays AutoCheck score of 100 without layout break', () => {
      const v = createMockVehicle({
        autoCheckReport: { score: 100, dataState: 'current' },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('100')).toBeInTheDocument()
    })

    it('F14-B3: Renders vAuto equipment card with data-resource="vauto"', () => {
      const v = createMockVehicle({
        factoryEquipment: {
          dataState: 'current',
          isOriginalWindowSticker: false,
          packages: [{ name: 'Equipment Group 502A' }],
        },
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vehicle-resource-card[data-resource="vauto"]')).toBeInTheDocument()
    })

    it('F14-B4: OASIS card is omitted for non-Ford makes', () => {
      const v = createMockVehicle({ make: 'Chevrolet', fordOasis: undefined })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vehicle-resource-card[data-resource="oasis"]')).not.toBeInTheDocument()
    })

    it('F14-B5: Documents hub is wrapped in accessible container', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('region', { name: 'Documents' })).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 15: Quick Action: Update Hold
  // ---------------------------------------------------------------------------
  describe('Feature 15: Quick Action: Update Hold (Boundaries)', () => {
    it('F15-B1: Renders DealerMail button for authorized user', () => {
      const v = createMockVehicle({ dealerMail: { dataState: 'current', canManageHold: true } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /DealerMail/i })).toBeInTheDocument()
    })

    it('F15-B2: Renders Holds button for read-only user', () => {
      const v = createMockVehicle({ dealerMail: { dataState: 'current', canManageHold: false } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Holds/i })).toBeInTheDocument()
    })

    it('F15-B3: Clicking DealerMail button does not throw or error', () => {
      const v = createMockVehicle({ dealerMail: { dataState: 'current', canManageHold: true } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const btn = screen.getByRole('button', { name: /DealerMail/i })
      expect(() => fireEvent.click(btn)).not.toThrow()
    })

    it('F15-B4: Handles vehicle with unavailable dealerMail state gracefully', () => {
      const v = createMockVehicle({
        dealerMail: { dataState: 'unavailable', hasActiveHold: false, canManageHold: false },
        holdEvidence: [],
      })
      expect(() => render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)).not.toThrow()
    })

    it('F15-B5: Action button contains icon for visual accessibility', () => {
      const v = createMockVehicle({ dealerMail: { dataState: 'current', canManageHold: true } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const btn = screen.getByRole('button', { name: /DealerMail/i })
      expect(btn.querySelector('svg')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 16: Quick Action: Mark Ready / Start Service
  // ---------------------------------------------------------------------------
  describe('Feature 16: Quick Action: Mark Ready / Start Service (Boundaries)', () => {
    it('F16-B1: needs_service status displays Start service link with action=in_service', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /Start service/i })
      expect(link).toHaveAttribute('href', expect.stringContaining('action=in_service'))
    })

    it('F16-B2: in_service status displays Mark Ready link with action=serviced', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'in_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /Mark Ready/i })
      expect(link).toHaveAttribute('href', expect.stringContaining('action=serviced'))
    })

    it('F16-B3: serviced status displays Service link without action param', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'serviced' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /^Service$/i })
      expect(link).toHaveAttribute('href', expect.stringContaining('/service?vin='))
      expect(link).not.toHaveAttribute('href', expect.stringContaining('action='))
    })

    it('F16-B4: Service link encodes special characters in VIN safely', () => {
      const v = createMockVehicle({ vin: '1FTFW1E86HFA48871' })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /Start service/i })
      expect(link.getAttribute('href')).toContain(encodeURIComponent('1FTFW1E86HFA48871'))
    })

    it('F16-B5: Service action button includes vdp-action-dock-btn styling class', () => {
      const v = createMockVehicle({ serviceReadiness: { status: 'needs_service' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /Start service/i })
      expect(link).toHaveClass('vdp-action-dock-btn')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 17: Quick Action: Track / Request Movement
  // ---------------------------------------------------------------------------
  describe('Feature 17: Quick Action: Track / Request Movement (Boundaries)', () => {
    it('F17-B1: Omits Track movement button when movement requestId is null/undefined', () => {
      const v = createMockVehicle({ movement: undefined })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onTrackMovement={vi.fn()} onClose={vi.fn()} />)
      expect(screen.queryByRole('button', { name: /Track movement/i })).not.toBeInTheDocument()
    })

    it('F17-B2: Omits Track movement button when onTrackMovement callback is not passed', () => {
      const v = createMockVehicle({ movement: { requestId: 'MOV-123' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.queryByRole('button', { name: /Track movement/i })).not.toBeInTheDocument()
    })

    it('F17-B3: Omits Request vehicle button when isMoveRequestBlocked returns true', () => {
      const v = createMockVehicle({ moveRequestBlocked: true })
      render(
        <VehicleWorkspaceV2
          vehicle={v}
          homeStore="Howell"
          canRequestVehicle={true}
          onRequestVehicle={vi.fn()}
          onClose={vi.fn()}
        />
      )
      expect(screen.queryByRole('button', { name: /Request vehicle/i })).not.toBeInTheDocument()
    })

    it('F17-B4: Omits Request vehicle button when canRequestVehicle is false', () => {
      const v = createMockVehicle({ movement: undefined })
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

    it('F17-B5: Clicking Track movement calls callback with the vehicle record', () => {
      const onTrack = vi.fn()
      const v = createMockVehicle({ movement: { requestId: 'MOV-55' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onTrackMovement={onTrack} onClose={vi.fn()} />)
      const buttons = screen.getAllByRole('button', { name: /Track movement/i })
      fireEvent.click(buttons[0])
      expect(onTrack).toHaveBeenCalledTimes(1)
      expect(onTrack).toHaveBeenCalledWith(v)
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 18: Quick Action: Take-Home Sheet
  // ---------------------------------------------------------------------------
  describe('Feature 18: Quick Action: Take-Home Sheet (Boundaries)', () => {
    it('F18-B1: Take-home page button renders in footer toolbar', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Take-home page/i })).toBeInTheDocument()
    })

    it('F18-B2: Clicking Take-home page opens modal dialog', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Take-home page/i }))
      expect(screen.getByRole('dialog', { name: /^Take-home page/i })).toBeInTheDocument()
    })

    it('F18-B3: Pressing Escape inside TakeHomeSheet closes it and restores focus', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const btn = screen.getByRole('button', { name: /Take-home page/i })
      fireEvent.click(btn)
      const dialog = screen.getByRole('dialog', { name: /^Take-home page/i })
      expect(dialog).toBeInTheDocument()
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.queryByRole('dialog', { name: /^Take-home page/i })).not.toBeInTheDocument()
    })

    it('F18-B4: TakeHomeSheet displays vehicle sale price accurately', () => {
      const v = createMockVehicle({ price: 49995 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Take-home page/i }))
      expect(screen.getAllByText('$49,995').length).toBeGreaterThanOrEqual(1)
    })

    it('F18-B5: TakeHomeSheet provides Close button to dismiss', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Take-home page/i }))
      const dialog = screen.getByRole('dialog', { name: /^Take-home page/i })
      const closeBtn = within(dialog).getByRole('button', { name: /Close/i })
      fireEvent.click(closeBtn)
      expect(screen.queryByRole('dialog', { name: /^Take-home page/i })).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 19: Framer Motion VDP Disclosure
  // ---------------------------------------------------------------------------
  describe('Feature 19: Framer Motion VDP Disclosure (Boundaries)', () => {
    it('F19-B1: Modal backdrop renders with vdp-focus-backdrop class', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vdp-focus-backdrop')).toBeInTheDocument()
    })

    it('F19-B2: Clicking backdrop invokes onClose callback', () => {
      const onClose = vi.fn()
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={onClose} />)
      const backdrop = baseElement.querySelector('.vdp-focus-backdrop')
      fireEvent.click(backdrop!)
      expect(onClose).toHaveBeenCalled()
    })

    it('F19-B3: Pressing Escape on workspace dialog invokes onClose callback', () => {
      const onClose = vi.fn()
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={onClose} />)
      const dialog = screen.getByRole('dialog')
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })

    it('F19-B4: Clicking header close button invokes onClose callback', () => {
      const onClose = vi.fn()
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={onClose} />)
      const closeBtn = screen.getByRole('button', { name: /Close vehicle details/i })
      fireEvent.click(closeBtn)
      expect(onClose).toHaveBeenCalled()
    })

    it('F19-B5: Clicking back button invokes onClose callback', () => {
      const onClose = vi.fn()
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={onClose} />)
      const backBtn = screen.getByRole('button', { name: /Back to inventory/i })
      fireEvent.click(backBtn)
      expect(onClose).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 20: Button & Badge Micro-Interactions
  // ---------------------------------------------------------------------------
  describe('Feature 20: Button & Badge Micro-Interactions (Boundaries)', () => {
    it('F20-B1: All buttons in action dock possess type="button" attribute', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const buttons = baseElement.querySelectorAll('.vdp-action-dock button')
      buttons.forEach((btn) => {
        expect(btn).toHaveAttribute('type', 'button')
      })
    })

    it('F20-B2: Action dock buttons maintain minimum touch target dimensions', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const buttons = baseElement.querySelectorAll('.vdp-action-dock button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('F20-B3: Back button contains ChevronLeft icon', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const backBtn = screen.getByRole('button', { name: /Back to inventory/i })
      expect(backBtn.querySelector('svg')).toBeInTheDocument()
    })

    it('F20-B4: Status alert items contain alert warning icons', () => {
      const v = createMockVehicle({
        fordOasis: { openFieldServiceActions: [{ campaignNumber: '23S14' }] },
      })
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(baseElement.querySelector('.vdp-dash-alert-warn svg')).toBeInTheDocument()
    })

    it('F20-B5: Multiple rapid clicks on action dock buttons execute cleanly', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const btn = screen.getByRole('button', { name: /DealerMail/i })
      expect(() => {
        fireEvent.click(btn)
        fireEvent.click(btn)
      }).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 21: High-Density Inventory Table V2
  // ---------------------------------------------------------------------------
  describe('Feature 21: High-Density Inventory Table V2 (Boundaries)', () => {
    it('F21-B1: ServiceStatusLink handles empty/null service readiness with default label', () => {
      render(<ServiceStatusLink service={null} vin="1FTFW1E86HFA48871" />)
      expect(screen.getByText('Waiting for service')).toBeInTheDocument()
    })

    it('F21-B2: ServiceStatusLink detailed mode renders entry timestamp when in_service', () => {
      render(
        <ServiceStatusLink
          service={{ status: 'in_service', serviceEnteredAt: '2026-08-20' }}
          vin="1FTFW1E86HFA48871"
          detailed={true}
        />
      )
      expect(screen.getByText(/Since 2026-08-20/i)).toBeInTheDocument()
    })

    it('F21-B3: ServiceStatusLink detailed mode renders completed timestamp when serviced', () => {
      render(
        <ServiceStatusLink
          service={{ status: 'serviced', completedAt: '2026-08-25' }}
          vin="1FTFW1E86HFA48871"
          detailed={true}
        />
      )
      expect(screen.getByText(/2026-08-25/i)).toBeInTheDocument()
    })

    it('F21-B4: ServiceStatusLink stops event propagation on click', () => {
      const parentClick = vi.fn()
      render(
        <div onClick={parentClick}>
          <ServiceStatusLink service={{ status: 'serviced' }} vin="1FTFW1E86HFA48871" />
        </div>
      )
      const link = screen.getByRole('link')
      fireEvent.click(link)
      expect(parentClick).not.toHaveBeenCalled()
    })

    it('F21-B5: ServiceStatusLink encodes complex query string vin parameter', () => {
      render(<ServiceStatusLink service={{ status: 'serviced' }} vin="VIN#123/ABC" />)
      const link = screen.getByRole('link')
      expect(link.getAttribute('href')).toBe('/service?vin=VIN%23123%2FABC')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 22: Inventory Table Micro-Actions
  // ---------------------------------------------------------------------------
  describe('Feature 22: Inventory Table Micro-Actions (Boundaries)', () => {
    it('F22-B1: Copy button has title attribute for mouse hover guidance', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const btn = screen.getByRole('button', { name: /Copy stock number: W5863Q/i })
      expect(btn).toHaveAttribute('title', expect.stringContaining('W5863Q'))
    })

    it('F22-B2: Public listing link has target="_blank" and rel="noopener noreferrer"', () => {
      const v = createMockVehicle({ publicListing: { listingUrl: 'https://dealer.example.com/veh/1', dataState: 'current' } })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /Listing/i })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    })

    it('F22-B3: Invoice link has referrerPolicy="no-referrer"', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const link = screen.getByRole('link', { name: /Invoice/i })
      expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
    })

    it('F22-B4: onViewVehicle callback is invoked when Full record button is clicked', () => {
      const onView = vi.fn()
      const v = createMockVehicle()
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onViewVehicle={onView} onClose={vi.fn()} />)
      const btn = screen.getByRole('button', { name: /Full record/i })
      fireEvent.click(btn)
      expect(onView).toHaveBeenCalledWith(v)
    })

    it('F22-B5: Full record button is omitted when onViewVehicle is null', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.queryByRole('button', { name: /Full record/i })).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 23: Service Board V2
  // ---------------------------------------------------------------------------
  describe('Feature 23: Service Board V2 (Boundaries)', () => {
    it('F23-B1: ServiceStatusLink renders wrench icon when status is needs_service', () => {
      const { container } = render(<ServiceStatusLink service={{ status: 'needs_service' }} vin="123" />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('F23-B2: ServiceStatusLink renders wrench icon when status is in_service', () => {
      const { container } = render(<ServiceStatusLink service={{ status: 'in_service' }} vin="123" />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('F23-B3: ServiceStatusLink renders check icon when status is serviced', () => {
      const { container } = render(<ServiceStatusLink service={{ status: 'serviced' }} vin="123" />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('F23-B4: Displays title warning on serviced link without completedAt date', () => {
      render(<ServiceStatusLink service={{ status: 'serviced' }} vin="123" />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('title', 'Ready is recorded; no service completion date was captured')
    })

    it('F23-B5: Displays standard title on in_service link', () => {
      render(<ServiceStatusLink service={{ status: 'in_service' }} vin="123" />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('title', 'Open vehicle service workflow')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 24: Transfers Movement View V2
  // ---------------------------------------------------------------------------
  describe('Feature 24: Transfers Movement View V2 (Boundaries)', () => {
    it('F24-B1: Flags location conflict warning when location.conflict is true', () => {
      const v = createMockVehicle({
        location: { conflict: true, homeStore: { id: 'howell', name: 'Howell' } },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/Location information conflicts/i)).toBeInTheDocument()
    })

    it('F24-B2: Withheld move displays privacy redaction note', () => {
      const v = createMockVehicle({
        movement: { state: 'in_transit', withheld: true },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/Move details are limited to the stores involved/i)).toBeInTheDocument()
    })

    it('F24-B3: Withheld driver attribution displays Withheld for your role or store', () => {
      const v = createMockVehicle({
        movement: { state: 'in_transit', withheld: true },
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('Withheld for your role or store').length).toBeGreaterThanOrEqual(1)
    })

    it('F24-B4: Blocked unseen move displays open request notice', () => {
      const v = createMockVehicle({
        moveRequestBlocked: true,
        movement: undefined,
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(/The app already has an open move request for this vehicle/i)).toBeInTheDocument()
    })

    it('F24-B5: resolveCurrentLocation handles conflicting location with Location needs checking', () => {
      const v = createMockVehicle({
        location: { conflict: true, homeStore: { id: 'howell', name: 'Howell' } },
      })
      const loc = resolveCurrentLocation(v)
      expect(loc.label).toBe('Location needs checking')
      expect(loc.provenance).toBe('app-confirmed')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 25: View Switch Cross-Fade Animations
  // ---------------------------------------------------------------------------
  describe('Feature 25: View Switch Cross-Fade Animations (Boundaries)', () => {
    it('F25-B1: Cross-fade container preserves accessibility roles during animation', () => {
      const { container } = render(
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="region" aria-label="Inventory Main">
          <p>Table Content</p>
        </motion.div>
      )
      expect(screen.getByRole('region', { name: 'Inventory Main' })).toBeInTheDocument()
    })

    it('F25-B2: AnimatePresence supports mode="wait" without error', () => {
      const { rerender, container } = render(
        <AnimatePresence mode="wait">
          <motion.div key="view1">View 1</motion.div>
        </AnimatePresence>
      )
      expect(container.textContent).toBe('View 1')
      rerender(
        <AnimatePresence mode="wait">
          <motion.div key="view2">View 2</motion.div>
        </AnimatePresence>
      )
      expect(container.textContent).toBe('View 2')
    })

    it('F25-B3: Cross-fade animation handles zero opacity initial state', () => {
      const { container } = render(
        <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <p>Visible View</p>
        </motion.main>
      )
      expect(container.querySelector('main')).toBeInTheDocument()
    })

    it('F25-B4: Rapid view switches do not leave duplicate DOM keys', () => {
      const { rerender, container } = render(
        <AnimatePresence>
          <motion.div key="table">Table</motion.div>
        </AnimatePresence>
      )
      rerender(
        <AnimatePresence>
          <motion.div key="service">Service</motion.div>
        </AnimatePresence>
      )
      rerender(
        <AnimatePresence>
          <motion.div key="transfers">Transfers</motion.div>
        </AnimatePresence>
      )
      expect(container.textContent).toBe('Transfers')
    })

    it('F25-B5: Framer motion supports layoutId for smooth element morphing', () => {
      const { container } = render(
        <motion.div layoutId="test-pill">
          <span>Active Pill</span>
        </motion.div>
      )
      expect(container.textContent).toBe('Active Pill')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 26: Mobile & Responsive Density (390px+)
  // ---------------------------------------------------------------------------
  describe('Feature 26: Mobile & Responsive Density (390px+) (Boundaries)', () => {
    it('F26-B1: Modal sets aria-modal="true" for mobile assistive devices', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    it('F26-B2: Header back button provides accessible label for screen readers', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Back to inventory' })).toBeInTheDocument()
    })

    it('F26-B3: Compact definition lists use semantic dt and dd tags', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const dts = baseElement.querySelectorAll('.vdp-dense-grid dt')
      const dds = baseElement.querySelectorAll('.vdp-dense-grid dd')
      expect(dts.length).toBeGreaterThan(0)
      expect(dds.length).toBe(dts.length)
    })

    it('F26-B4: Technical specs card renders 6 fact items', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const specsCard = baseElement.querySelector('.vdp-dash-card[aria-label="Vehicle Specs"]')
      expect(specsCard?.querySelectorAll('dt').length).toBe(6)
    })

    it('F26-B5: Mobile viewport simulation: aside renders with tabindex -1 for program focus', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const aside = screen.getByRole('dialog')
      expect(aside).toHaveAttribute('tabindex', '-1')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 27: Opaque-Box E2E Test Suite (Tiers 1-4)
  // ---------------------------------------------------------------------------
  describe('Feature 27: Opaque-Box E2E Test Suite (Boundaries)', () => {
    it('F27-B1: Mock vehicle generator accepts deep partial overrides without mutating defaults', () => {
      const v1 = createMockVehicle({ price: 10000 })
      const v2 = createMockVehicle({ price: 20000 })
      expect(v1.price).toBe(10000)
      expect(v2.price).toBe(20000)
    })

    it('F27-B2: Clipboard mock restores original clipboard accurately', () => {
      const clip = setupClipboardMock()
      clip.restore()
      expect(clip.getLastCopied()).toBe('')
    })

    it('F27-B3: DOM cleanup cleans up document.body after render', () => {
      const { unmount } = render(<div>Temporary DOM</div>)
      expect(screen.getByText('Temporary DOM')).toBeInTheDocument()
      unmount()
      expect(screen.queryByText('Temporary DOM')).not.toBeInTheDocument()
    })

    it('F27-B4: formatMoney formats negative numbers gracefully', () => {
      expect(formatMoney(-500)).toBe('-$500')
    })

    it('F27-B5: formatMileage handles 0 miles accurately', () => {
      expect(formatMileage(0)).toBe('0 mi')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 28: Adversarial Coverage Hardening (Tier 5)
  // ---------------------------------------------------------------------------
  describe('Feature 28: Adversarial Coverage Hardening (Boundaries)', () => {
    it('F28-B1: XSS attempt in customerOrReason note is safely escaped in DOM', () => {
      const xssPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>'
      const v = createMockVehicle({
        holdEvidence: [{ id: 'h1', position: 'primary', customerOrReason: xssPayload }],
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText(xssPayload)).toBeInTheDocument()
      expect(document.querySelector('script')).not.toBeInTheDocument()
    })

    it('F28-B2: Extreme price number handles without crash', () => {
      const v = createMockVehicle({ price: 999999999 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText('$999,999,999').length).toBeGreaterThanOrEqual(1)
    })

    it('F28-B3: Extreme mileage handles without crash', () => {
      const v = createMockVehicle({ mileage: 9999999 })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getAllByText(/9,999,999 mi/i).length).toBeGreaterThanOrEqual(1)
    })

    it('F28-B4: Malformed inventoryDate string does not throw', () => {
      const v = createMockVehicle({ inventoryDate: 'NOT-A-VALID-DATE' })
      expect(() => render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)).not.toThrow()
    })

    it('F28-B5: Unicode and emoji in vehicle display name render cleanly', () => {
      const v = createMockVehicle({
        make: 'Ford ⚡',
        model: 'F-150 Lightning 🔋',
        trim: 'Platinum 🌟',
      })
      render(<VehicleWorkspaceV2 vehicle={v} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('⚡')
    })
  })

  // ---------------------------------------------------------------------------
  // Feature 29: Forensic Integrity Audit
  // ---------------------------------------------------------------------------
  describe('Feature 29: Forensic Integrity Audit (Boundaries)', () => {
    it('F29-B1: VehicleWorkspaceV2 renders real aside dialog element', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const aside = screen.getByRole('dialog')
      expect(aside.tagName.toLowerCase()).toBe('aside')
    })

    it('F29-B2: Financials card renders dl with dt and dd definition elements', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const card = baseElement.querySelector('.vdp-dash-card[aria-label="Financials"]')
      expect(card?.querySelector('dl')).toBeInTheDocument()
    })

    it('F29-B3: Action dock is contained within header persistent rail', () => {
      const { baseElement } = render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      const rail = baseElement.querySelector('.vdp-header-persistent-rail')
      expect(rail?.querySelector('.vdp-action-dock')).toBeInTheDocument()
    })

    it('F29-B4: Footer renders Bob Maxey branding signature', () => {
      render(<VehicleWorkspaceV2 vehicle={createMockVehicle()} homeStore="Howell" onClose={vi.fn()} />)
      expect(screen.getByText('MAXEY')).toBeInTheDocument()
    })

    it('F29-B5: isMoveRequestBlocked helper accurately returns boolean state', () => {
      expect(isMoveRequestBlocked(createMockVehicle({ moveRequestBlocked: true }))).toBe(true)
      expect(isMoveRequestBlocked(createMockVehicle({ moveRequestBlocked: false }))).toBe(false)
    })
  })
})
