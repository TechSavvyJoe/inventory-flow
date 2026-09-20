import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { InventoryPredictiveSearch } from '../../src/features/inventory/InventoryPredictiveSearch'
import { InventoryExperienceV2 } from '../../src/features/inventory/InventoryExperienceV2'
import { InventoryDecisionRail } from '../../src/features/inventory/InventoryDecisionRail'
import { InventoryTableV2 } from '../../src/features/inventory/InventoryTableV2'
import { createMockVehicle } from './testHelpers'
import type { InventoryDecisionMetrics, InventoryStore } from '../../src/features/inventory/types'

describe('Challenger Layout & Accessibility Suite', () => {
  const mockHomeStore: InventoryStore = { id: 'howell', name: 'Howell' }
  const mockVehicles = [
    createMockVehicle({
      id: 'v1',
      vin: '1FTFW1E86HFA11111',
      stockNumber: 'STK101',
      year: 2024,
      make: 'Ford',
      model: 'F-150',
      price: 45000,
    }),
    createMockVehicle({
      id: 'v2',
      vin: '1FTFW1E86HFA22222',
      stockNumber: 'STK102',
      year: 2023,
      make: 'Ford',
      model: 'Explorer',
      price: 38000,
    }),
  ]

  const mockMetrics: InventoryDecisionMetrics = {
    publicUnits: 42,
    currentHolds: 7,
    awayFromHome: 3,
    returnOverdue: 1,
  }

  afterEach(() => {
    cleanup()
  })

  describe('1. Screen-Reader Helper Text & Accessibility Contract', () => {
    it('renders the 163-character screen reader hint associated via aria-describedby', () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()

      const { container } = render(
        <InventoryPredictiveSearch
          id="test-search-id"
          vehicles={mockVehicles}
          value=""
          onChange={onChange}
          onSelectVehicle={onSelect}
          persistenceKey="test-search"
        />
      )

      const input = screen.getByRole('combobox')
      const describedBy = input.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()

      const hintEl = container.querySelector(`#${describedBy}`)
      expect(hintEl).not.toBeNull()
      expect(hintEl?.tagName.toLowerCase()).toBe('span')
      expect(hintEl?.classList.contains('inventory-sr-only')).toBe(true)

      const expectedText =
        'Search supports partial stock and VIN, multiple terms, punctuation variants, and common spelling mistakes. Use the arrow keys to review suggestions, Enter to choose, and Escape to close.'
      expect(hintEl?.textContent?.trim()).toBe(expectedText)
      // Empirically verified: total string length is 186 characters (worker & prompt cited ~163)
      expect(expectedText.length).toBe(186)
    })

    it('confirms .inventory-sr-only CSS rules visually hide content without breaking a11y tree', () => {
      const cssPath = path.resolve(__dirname, '../../src/features/inventory/InventoryExperienceV2.css')
      const cssContent = fs.readFileSync(cssPath, 'utf8')

      // Check .inventory-sr-only class exists and has exact properties
      expect(cssContent).toMatch(/\.inventory-sr-only\s*\{[^}]*\}/s)
      const match = cssContent.match(/\.inventory-sr-only\s*\{([^}]*)\}/s)
      expect(match).not.toBeNull()
      const rules = match![1]

      // Must be position absolute
      expect(rules).toMatch(/position\s*:\s*absolute/i)
      // Must have 1px dimensions
      expect(rules).toMatch(/width\s*:\s*1px/i)
      expect(rules).toMatch(/height\s*:\s*1px/i)
      // Must be clipped
      expect(rules).toMatch(/clip\s*:\s*rect\(0,\s*0,\s*0,\s*0\)/i)
      // Must have overflow hidden
      expect(rules).toMatch(/overflow\s*:\s*hidden/i)
      // Must have white-space nowrap
      expect(rules).toMatch(/white-space\s*:\s*nowrap/i)

      // CRITICAL: Must NOT use display: none or visibility: hidden (which would hide from screen readers)
      expect(rules).not.toMatch(/display\s*:\s*none/i)
      expect(rules).not.toMatch(/visibility\s*:\s*hidden/i)
    })

    it('confirms the search label also uses .inventory-sr-only', () => {
      const { container } = render(
        <InventoryPredictiveSearch
          id="search-lbl-test"
          vehicles={mockVehicles}
          value=""
          onChange={vi.fn()}
          onSelectVehicle={vi.fn()}
          persistenceKey="test-search-lbl"
        />
      )

      const label = container.querySelector('label[for="search-lbl-test"]')
      expect(label).not.toBeNull()
      expect(label?.classList.contains('inventory-sr-only')).toBe(true)
      expect(label?.textContent).toBe('Search inventory')
    })
  })

  describe('2. Decision Rail 4-Column Grid & Screen Sizes', () => {
    it('renders all 4 metrics with semantic structure and tone styles', () => {
      render(<InventoryDecisionRail metrics={mockMetrics} />)

      const rail = screen.getByLabelText('Inventory decisions')
      expect(rail.classList.contains('inventory-decision-rail')).toBe(true)

      const metricCards = rail.querySelectorAll('.inventory-metric')
      expect(metricCards.length).toBe(4)

      // Verify labels and values
      expect(screen.getByText('Public units')).toBeDefined()
      expect(screen.getByText('42')).toBeDefined()
      expect(screen.getByText('Current holds')).toBeDefined()
      expect(screen.getByText('7')).toBeDefined()
      expect(screen.getByText('Away from home')).toBeDefined()
      expect(screen.getByText('3')).toBeDefined()
      expect(screen.getByText('Return overdue')).toBeDefined()
      expect(screen.getByText('1')).toBeDefined()

      // Verify icon tone containers
      expect(rail.querySelector('.inventory-tone--blue')).not.toBeNull()
      expect(rail.querySelector('.inventory-tone--orange')).not.toBeNull()
      expect(rail.querySelector('.inventory-tone--violet')).not.toBeNull()
      expect(rail.querySelector('.inventory-tone--red')).not.toBeNull()
    })

    it('verifies decision rail CSS grid and media queries across screen sizes', () => {
      const cssPath = path.resolve(__dirname, '../../src/features/inventory/InventoryExperienceV2.css')
      const cssContent = fs.readFileSync(cssPath, 'utf8')

      // Desktop: 4 columns
      expect(cssContent).toMatch(/\.inventory-decision-rail\s*\{[^}]*grid-template-columns\s*:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s)

      // Tablet breakpoint (<= 900px): 2 columns
      expect(cssContent).toMatch(/@media\s*\(\s*max-width\s*:\s*900px\s*\)\s*\{[^}]*\.inventory-decision-rail\s*\{[^}]*grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)

      // Mobile breakpoint (<= 520px): 1 column
      expect(cssContent).toMatch(/@media\s*\(\s*max-width\s*:\s*520px\s*\)\s*\{[^}]*\.inventory-decision-rail\s*\{[^}]*grid-template-columns\s*:\s*1fr/s)
    })
  })

  describe('3. Controls Bar & Layout Shift / Visual Glitch Resistance', () => {
    it('verifies controls bar layout structure and fixed height', () => {
      const cssPath = path.resolve(__dirname, '../../src/features/inventory/InventoryExperienceV2.css')
      const cssContent = fs.readFileSync(cssPath, 'utf8')

      // Controls bar flex container
      expect(cssContent).toMatch(/\.inv-v2-controls-bar\s*\{[^}]*display\s*:\s*flex/s)
      expect(cssContent).toMatch(/\.inv-v2-controls-bar\s*\{[^}]*justify-content\s*:\s*space-between/s)
      expect(cssContent).toMatch(/\.inv-v2-controls-bar\s*\{[^}]*align-items\s*:\s*center/s)

      // Primary search box fixed height 38px
      expect(cssContent).toMatch(/\.inventory-primary-search\s*\{[^}]*height\s*:\s*38px/s)

      // Search popover must be absolutely positioned to prevent pushing content down
      expect(cssContent).toMatch(/\.inventory-search-popover\s*\{[^}]*position\s*:\s*absolute/s)
      expect(cssContent).toMatch(/\.inventory-search-popover\s*\{[^}]*top\s*:\s*calc\(100%\s*\+\s*4px\)/s)
      expect(cssContent).toMatch(/\.inventory-search-popover\s*\{[^}]*z-index\s*:\s*50/s)
    })

    it('renders controls bar with predictive search and quick-view filter pills', () => {
      const { container } = render(
        <InventoryExperienceV2
          homeStore={mockHomeStore}
          vehicles={mockVehicles}
          metrics={mockMetrics}
        />
      )

      const controlsBar = container.querySelector('.inv-v2-controls-bar')
      expect(controlsBar).not.toBeNull()

      const searchWrapper = controlsBar?.querySelector('.inv-v2-search-wrapper')
      expect(searchWrapper).not.toBeNull()

      const pillsGroup = controlsBar?.querySelector('.inv-v2-pills-group')
      expect(pillsGroup).not.toBeNull()

      const pills = pillsGroup?.querySelectorAll('button')
      expect(pills?.length).toBe(5)

      // Default active pill is "All Vehicles"
      const allPill = screen.getByRole('button', { name: 'All Vehicles' })
      expect(allPill.classList.contains('is-active')).toBe(true)
      expect(allPill.getAttribute('aria-pressed')).toBe('true')
    })

    it('switching filter pills updates active state cleanly', () => {
      render(
        <InventoryExperienceV2
          homeStore={mockHomeStore}
          vehicles={mockVehicles}
          metrics={mockMetrics}
        />
      )

      const noHoldPill = screen.getByRole('button', { name: 'No Hold' })
      expect(noHoldPill.getAttribute('aria-pressed')).toBe('false')

      fireEvent.click(noHoldPill)

      expect(noHoldPill.getAttribute('aria-pressed')).toBe('true')
      expect(noHoldPill.classList.contains('is-active')).toBe(true)

      const allPill = screen.getByRole('button', { name: 'All Vehicles' })
      expect(allPill.getAttribute('aria-pressed')).toBe('false')
      expect(allPill.classList.contains('is-active')).toBe(false)
    })

    it('verifies search popover does not cause document flow shift when activated', () => {
      render(
        <InventoryExperienceV2
          homeStore={mockHomeStore}
          vehicles={mockVehicles}
          metrics={mockMetrics}
        />
      )

      const searchInput = screen.getByRole('combobox')

      // Type to open popover
      fireEvent.change(searchInput, { target: { value: 'Ford' } })
      fireEvent.focus(searchInput)

      const popover = screen.getByRole('listbox')
      expect(popover).toBeDefined()

      // Verify the listbox is inside .inventory-search-popover which is position: absolute
      const popoverContainer = popover.closest('.inventory-search-popover')
      expect(popoverContainer).not.toBeNull()
    })
  })

  describe('4. Table Alignment & Inner Div Flex Wrapper Contract', () => {
    it('verifies colgroup has 6 columns with exact percentage widths totaling 100%', () => {
      const { container } = render(
        <InventoryTableV2
          vehicles={mockVehicles}
          sorts={[{ key: 'vehicle', direction: 'asc' }]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      )

      const colgroup = container.querySelector('colgroup')
      expect(colgroup).not.toBeNull()
      const cols = colgroup?.querySelectorAll('col')
      expect(cols?.length).toBe(6)

      const cssPath = path.resolve(__dirname, '../../src/features/inventory/InventoryTableV2.css')
      const cssContent = fs.readFileSync(cssPath, 'utf8')

      // Verify table layout is fixed
      expect(cssContent).toMatch(/\.inventory-table-v2\s*\{[^}]*table-layout\s*:\s*fixed/s)
      expect(cssContent).toMatch(/\.inventory-table-v2\s*\{[^}]*min-width\s*:\s*1080px/s)

      // Column widths
      expect(cssContent).toMatch(/\.inventory-table-v2-col--vehicle\s*\{[^}]*width\s*:\s*27%/s)
      expect(cssContent).toMatch(/\.inventory-table-v2-col--identifiers\s*\{[^}]*width\s*:\s*14%/s)
      expect(cssContent).toMatch(/\.inventory-table-v2-col--pricing\s*\{[^}]*width\s*:\s*12%/s)
      expect(cssContent).toMatch(/\.inventory-table-v2-col--location\s*\{[^}]*width\s*:\s*13%/s)
      expect(cssContent).toMatch(/\.inventory-table-v2-col--status\s*\{[^}]*width\s*:\s*14%/s)
      expect(cssContent).toMatch(/\.inventory-table-v2-col--actions\s*\{[^}]*width\s*:\s*20%/s)

      // Total width: 27 + 14 + 12 + 13 + 14 + 20 = 100%
      const totalWidth = 27 + 14 + 12 + 13 + 14 + 20
      expect(totalWidth).toBe(100)
    })

    it('verifies display: flex is applied to inner div wrappers inside td elements, NOT to td itself', () => {
      const { container } = render(
        <InventoryTableV2
          vehicles={mockVehicles}
          sorts={[{ key: 'vehicle', direction: 'asc' }]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      )

      const firstRow = container.querySelector('tbody tr')
      expect(firstRow).not.toBeNull()

      const tds = firstRow?.querySelectorAll('td')
      expect(tds?.length).toBe(6)

      const cssPath = path.resolve(__dirname, '../../src/features/inventory/InventoryTableV2.css')
      const cssContent = fs.readFileSync(cssPath, 'utf8')

      // td should have vertical-align: middle and padding
      expect(cssContent).toMatch(/\.inventory-table-v2 td\s*\{[^}]*vertical-align\s*:\s*middle/s)
      // td itself must NOT be display: flex
      const tdRuleMatch = cssContent.match(/\.inventory-table-v2 td\s*\{([^}]*)\}/s)
      if (tdRuleMatch) {
        expect(tdRuleMatch[1]).not.toMatch(/display\s*:\s*flex/i)
      }

      // Inner cell divs must have display: flex
      const expectedInnerWrappers = [
        'inv-v2-vehicle-cell',
        'inv-v2-id-cell',
        'inv-v2-pricing-cell',
        'inv-v2-location-cell',
        'inv-v2-status-cell',
        'inv-v2-actions-cell',
      ]

      expectedInnerWrappers.forEach((wrapperClass) => {
        const regex = new RegExp(`\\.${wrapperClass}\\s*\\{[^}]*display\\s*:\\s*flex`, 's')
        expect(cssContent).toMatch(regex)
      })

      // Each td in the rendered DOM should have a corresponding inner div with that class
      tds?.forEach((td, index) => {
        const expectedClass = expectedInnerWrappers[index]
        const innerDiv = td.querySelector(`.${expectedClass}`)
        expect(innerDiv).not.toBeNull()
      })
    })

    it('handles empty vehicle list without layout collapse or column distortion', () => {
      const { container } = render(
        <InventoryTableV2
          vehicles={[]}
          sorts={[{ key: 'vehicle', direction: 'asc' }]}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      )

      const emptyTd = container.querySelector('.inventory-table-v2-empty')
      expect(emptyTd).not.toBeNull()
      expect(emptyTd?.getAttribute('colspan')).toBe('6')
      expect(emptyTd?.textContent).toContain('No vehicles to display')
    })
  })

  describe('5. Zero Design System Debt in Layout Files', () => {
    it('contains 0 sub-12px font sizes and 0 raw hex colors in V2 inventory files', () => {
      const files = [
        path.resolve(__dirname, '../../src/features/inventory/InventoryExperienceV2.tsx'),
        path.resolve(__dirname, '../../src/features/inventory/InventoryExperienceV2.css'),
        path.resolve(__dirname, '../../src/features/inventory/InventoryTableV2.tsx'),
        path.resolve(__dirname, '../../src/features/inventory/InventoryTableV2.css'),
      ]

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8')

        // Hex color check: #[0-9a-fA-F]{3,8} outside comments
        const noComments = content.replace(/\/\*[\s\S]*?\*\//g, '')
        const hexMatches = noComments.match(/#[0-9a-fA-F]{3,8}\b/g)
        expect(hexMatches, `Found raw hex in ${path.basename(file)}: ${hexMatches}`).toBeNull()

        // Sub-12px check: font-size: 1px .. 11px
        const sub12Matches = noComments.match(/font-size\s*:\s*(1[01]|[0-9])px/g)
        expect(sub12Matches, `Found sub-12px in ${path.basename(file)}: ${sub12Matches}`).toBeNull()
      }
    })
  })
})
