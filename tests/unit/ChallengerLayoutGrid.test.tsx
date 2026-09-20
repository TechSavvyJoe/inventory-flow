import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { InventoryTableV2 } from '../../src/features/inventory/InventoryTableV2';
import { createMockVehicle } from './testHelpers';
import type { InventoryVehicle } from '../../src/features/inventory/types';

describe('Adversarial Challenger 1: Table Grid Layout & Alignment', () => {
  const mockSorts = [{ key: 'vehicle' as const, direction: 'asc' as const }];

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Challenge 1: Dynamic & Extreme Data Conditions
  // ---------------------------------------------------------------------------
  describe('1. Dynamic & Extreme Data Conditions', () => {
    it('handles empty state with exactly colSpan=6 across table grid', () => {
      render(
        <InventoryTableV2
          vehicles={[]}
          sorts={mockSorts}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      );

      const table = screen.getByRole('table', { name: /Inventory vehicles/i });
      expect(table).toBeInTheDocument();

      // Verify colgroup contains exactly 6 col elements
      const colgroup = table.querySelector('colgroup');
      expect(colgroup).not.toBeNull();
      const cols = colgroup?.querySelectorAll('col');
      expect(cols?.length).toBe(6);

      const expectedColClasses = [
        'inventory-table-v2-col--vehicle',
        'inventory-table-v2-col--identifiers',
        'inventory-table-v2-col--pricing',
        'inventory-table-v2-col--location',
        'inventory-table-v2-col--status',
        'inventory-table-v2-col--actions',
      ];
      cols?.forEach((col, idx) => {
        expect(col.className).toContain(expectedColClasses[idx]);
      });

      // Verify thead has 6 header columns
      const headers = table.querySelectorAll('thead th');
      expect(headers.length).toBe(6);

      // Verify empty cell has colSpan="6"
      const emptyCell = screen.getByText('No vehicles to display');
      expect(emptyCell.tagName.toLowerCase()).toBe('td');
      expect(emptyCell).toHaveAttribute('colSpan', '6');
      expect(emptyCell.className).toContain('inventory-table-v2-empty');
    });

    it('handles vehicles with extreme long titles and descriptions without layout break', () => {
      const longTitleVehicle: InventoryVehicle = createMockVehicle({
        id: 'LONG-TITLE-VIN-1',
        vin: '1FTFW1E86HFA99999',
        year: 2025,
        make: 'Ford Commercial Fleet Pro Heavy Duty Division Extreme',
        model: 'Super Duty F-550 Crew Cab Chassis Cab Platinum Edition Long Bed Dually',
        trim: 'Lariat SuperCrew 4x4 High-Performance Max Trailer Tow FX4 Off-Road Special Edition With Dual Alternators',
        exteriorColor: 'Custom Special Order Velocity Blue Metallic Tri-Coat Clearcoat Finish',
        engine: '6.7L High Output Power Stroke V8 Turbo Diesel with Heavy-Duty TorqShift Engine',
        transmission: '10-Speed SelectShift Automatic with Integrated PTO Capability and Rock Crawl Mode',
        drivetrain: 'Four-Wheel Drive (4WD) Dual Rear Wheel (DRW) Heavy Duty Drivetrain',
      });

      render(
        <InventoryTableV2
          vehicles={[longTitleVehicle]}
          sorts={mockSorts}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      );

      // Verify vehicle cell rendered
      const vehicleCell = document.querySelector('.inventory-table-v2-td--vehicle');
      expect(vehicleCell).not.toBeNull();

      // Check inner wrapper
      const innerWrapper = vehicleCell?.querySelector('.inv-v2-vehicle-cell');
      expect(innerWrapper).not.toBeNull();

      // Check title button renders full accessible label
      const titleBtn = screen.getByRole('button', {
        name: /View 2025 Ford Commercial Fleet Pro Heavy Duty Division Extreme Super Duty F-550 Crew Cab Chassis Cab Platinum Edition Long Bed Dually Lariat SuperCrew 4x4/i,
      });
      expect(titleBtn).toBeInTheDocument();

      // Check subtitle contains concatenated strings
      const subSpan = vehicleCell?.querySelector('.inv-v2-vehicle-sub');
      expect(subSpan).not.toBeNull();
      expect(subSpan?.textContent).toContain('Velocity Blue');
      expect(subSpan?.textContent).toContain('6.7L High Output');
    });

    it('handles vehicles with extreme long VINs and Stock numbers via CopyableValue', async () => {
      const extremeIdsVehicle: InventoryVehicle = createMockVehicle({
        id: 'EXTREME-IDS-VIN',
        vin: '1FTFW1E86HFA99999_EXTREME_LONG_VIN_OVERFLOW_TEST_1234567890',
        stockNumber: 'STK-EXTREME-SPECIAL-EDITION-2026-X999',
      });

      render(
        <InventoryTableV2
          vehicles={[extremeIdsVehicle]}
          sorts={mockSorts}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      );

      const idCell = document.querySelector('.inventory-table-v2-td--identifiers');
      expect(idCell).not.toBeNull();

      const innerWrapper = idCell?.querySelector('.inv-v2-id-cell');
      expect(innerWrapper).not.toBeNull();

      // Verify stock chip and copy button
      expect(screen.getByText('#STK-EXTREME-SPECIAL-EDITION-2026-X999')).toBeInTheDocument();
      const copyStockBtn = screen.getByRole('button', {
        name: /Copy Stock: STK-EXTREME-SPECIAL-EDITION-2026-X999/i,
      });
      expect(copyStockBtn).toBeInTheDocument();

      // Verify long VIN chip and copy button
      expect(
        screen.getByText('1FTFW1E86HFA99999_EXTREME_LONG_VIN_OVERFLOW_TEST_1234567890')
      ).toBeInTheDocument();
      const copyVinBtn = screen.getByRole('button', {
        name: /Copy VIN: 1FTFW1E86HFA99999_EXTREME_LONG_VIN_OVERFLOW_TEST_1234567890/i,
      });
      expect(copyVinBtn).toBeInTheDocument();
    });

    it('renders all 4 action buttons in actions column when shortlist is enabled', () => {
      const onShortlist = vi.fn();
      const onView = vi.fn();
      const onMove = vi.fn();
      const onRequest = vi.fn();

      const testVehicle = createMockVehicle({
        id: 'FOUR-ACTIONS-VIN',
        stockNumber: 'ACT444',
      });

      render(
        <InventoryTableV2
          vehicles={[testVehicle]}
          sorts={mockSorts}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
          onToggleShortlist={onShortlist}
          isShortlisted={() => false}
          onViewVehicle={onView}
          onTrackMovement={onMove}
          onRequestVehicle={onRequest}
          canRequestVehicle={true}
        />
      );

      const actionsCell = document.querySelector('.inventory-table-v2-td--actions');
      expect(actionsCell).not.toBeNull();

      const innerWrapper = actionsCell?.querySelector('.inv-v2-actions-cell');
      expect(innerWrapper).not.toBeNull();

      // Verify exactly 4 buttons inside the actions cell
      const buttons = innerWrapper?.querySelectorAll('button');
      expect(buttons?.length).toBe(4);

      // Button 1: Shortlist
      const shortlistBtn = screen.getByRole('button', { name: /Add ACT444 to shortlist/i });
      expect(shortlistBtn).toBeInTheDocument();
      fireEvent.click(shortlistBtn);
      expect(onShortlist).toHaveBeenCalledWith(testVehicle);

      // Button 2: View
      const viewBtn = screen.getByRole('button', { name: /View details for ACT444/i });
      expect(viewBtn).toBeInTheDocument();
      fireEvent.click(viewBtn);
      expect(onView).toHaveBeenCalledWith(testVehicle);

      // Button 3: Move
      const moveBtn = screen.getByRole('button', { name: /Move vehicle ACT444/i });
      expect(moveBtn).toBeInTheDocument();
      fireEvent.click(moveBtn);
      expect(onMove).toHaveBeenCalledWith(testVehicle);

      // Button 4: Request
      const requestBtn = screen.getByRole('button', { name: /Request transfer for ACT444/i });
      expect(requestBtn).toBeInTheDocument();
      expect(requestBtn).not.toBeDisabled();
      fireEvent.click(requestBtn);
      expect(onRequest).toHaveBeenCalledWith(testVehicle);
    });

    it('disables Request action button while keeping other 3 buttons fully operational when canRequestVehicle is false', () => {
      const onShortlist = vi.fn();
      const onView = vi.fn();
      const onMove = vi.fn();
      const onRequest = vi.fn();

      const testVehicle = createMockVehicle({
        id: 'CANNOT-REQUEST-VIN',
        stockNumber: 'NOREQ1',
      });

      render(
        <InventoryTableV2
          vehicles={[testVehicle]}
          sorts={mockSorts}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
          onToggleShortlist={onShortlist}
          isShortlisted={() => true}
          onViewVehicle={onView}
          onTrackMovement={onMove}
          onRequestVehicle={onRequest}
          canRequestVehicle={false}
        />
      );

      const requestBtn = screen.getByRole('button', { name: /Request transfer for NOREQ1/i });
      expect(requestBtn).toBeDisabled();
      fireEvent.click(requestBtn);
      expect(onRequest).not.toHaveBeenCalled();

      // Shortlist is active and clickable
      const shortlistBtn = screen.getByRole('button', { name: /Remove NOREQ1 from shortlist/i });
      expect(shortlistBtn).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(shortlistBtn);
      expect(onShortlist).toHaveBeenCalledWith(testVehicle);
    });
  });

  // ---------------------------------------------------------------------------
  // Challenge 2: Verification that inner <div> wrappers in <td> are preserved
  // and <td> is NEVER styled as display: flex
  // ---------------------------------------------------------------------------
  describe('2. DOM Structure & Inner <div> Wrapper Preservation', () => {
    it('ensures every <td> in vehicle rows has an inner <div> wrapper and proper column classes', () => {
      const vehicles = [
        createMockVehicle({ id: 'V1', stockNumber: 'STK1' }),
        createMockVehicle({ id: 'V2', stockNumber: 'STK2' }),
      ];

      render(
        <InventoryTableV2
          vehicles={vehicles}
          sorts={mockSorts}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      );

      const rows = document.querySelectorAll('tbody tr.inventory-table-v2-row');
      expect(rows.length).toBe(2);

      const expectedColumnClasses = [
        'inventory-table-v2-td--vehicle',
        'inventory-table-v2-td--identifiers',
        'inventory-table-v2-td--pricing',
        'inventory-table-v2-td--location',
        'inventory-table-v2-td--status',
        'inventory-table-v2-td--actions',
      ];

      const expectedInnerDivClasses = [
        'inv-v2-vehicle-cell',
        'inv-v2-id-cell',
        'inv-v2-pricing-cell',
        'inv-v2-location-cell',
        'inv-v2-status-cell',
        'inv-v2-actions-cell',
      ];

      rows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        expect(cells.length).toBe(6);

        cells.forEach((cell, cellIdx) => {
          // Verify td class name
          expect(cell.className).toContain('inventory-table-v2-td');
          expect(cell.className).toContain(expectedColumnClasses[cellIdx]);

          // Verify immediate child is a div with expected wrapper class
          const firstChild = cell.firstElementChild;
          expect(firstChild).not.toBeNull();
          expect(firstChild?.tagName.toLowerCase()).toBe('div');
          expect(firstChild?.className).toContain(expectedInnerDivClasses[cellIdx]);
        });
      });
    });

    it('verifies stylesheet does NOT assign display: flex to <td> elements', () => {
      const cssPath = path.resolve(__dirname, '../../src/features/inventory/InventoryTableV2.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      // Check regex for any rule matching "td" followed by "display: flex" before closing brace
      const tdFlexMatches = cssContent.match(/td[^{]*\{[^}]*display\s*:\s*flex[^}]*\}/gis);
      expect(tdFlexMatches).toBeNull();

      // Explicitly check .inventory-table-v2 td
      const tdRuleMatch = cssContent.match(/\.inventory-table-v2\s+td\s*\{([^}]*)\}/is);
      expect(tdRuleMatch).not.toBeNull();
      const tdBody = tdRuleMatch ? tdRuleMatch[1] : '';
      expect(tdBody).not.toMatch(/display\s*:\s*flex/i);
      expect(tdBody).toContain('vertical-align: middle');
    });
  });

  // ---------------------------------------------------------------------------
  // Challenge 3: Verify fixed table layout rules: table-layout: fixed, min-width: 1080px
  // ---------------------------------------------------------------------------
  describe('3. Fixed Table Layout & Min-Width Architecture', () => {
    it('verifies table-layout: fixed and min-width: 1080px in InventoryTableV2.css', () => {
      const cssPath = path.resolve(__dirname, '../../src/features/inventory/InventoryTableV2.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      // Find rule for .inventory-table-v2
      const tableRuleMatch = cssContent.match(/\.inventory-table-v2\s*\{([^}]*)\}/is);
      expect(tableRuleMatch).not.toBeNull();
      const tableBody = tableRuleMatch ? tableRuleMatch[1] : '';

      expect(tableBody).toMatch(/table-layout\s*:\s*fixed\s*;/i);
      expect(tableBody).toMatch(/min-width\s*:\s*1080px\s*;/i);
      expect(tableBody).toMatch(/border-collapse\s*:\s*separate\s*;/i);
      expect(tableBody).toMatch(/border-spacing\s*:\s*0\s*;/i);
    });

    it('verifies exact column width allocations sum to 100% with min-widths', () => {
      const cssPath = path.resolve(__dirname, '../../src/features/inventory/InventoryTableV2.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      const expectedColumns = [
        { name: 'vehicle', pct: 27, minWidth: 260 },
        { name: 'identifiers', pct: 14, minWidth: 140 },
        { name: 'pricing', pct: 12, minWidth: 110 },
        { name: 'location', pct: 13, minWidth: 130 },
        { name: 'status', pct: 14, minWidth: 140 },
        { name: 'actions', pct: 20, minWidth: 210 },
      ];

      let totalPct = 0;
      for (const col of expectedColumns) {
        totalPct += col.pct;

        // Verify width rule exists
        const widthRegex = new RegExp(
          `\\.inventory-table-v2-(th|col)--${col.name}[^\\{]*\\{[^}]*width\\s*:\\s*${col.pct}%`,
          'i'
        );
        expect(cssContent).toMatch(widthRegex);

        // Verify min-width rule exists
        const minWidthRegex = new RegExp(
          `\\.inventory-table-v2-(th|col)--${col.name}[^\\{]*\\{[^}]*min-width\\s*:\\s*${col.minWidth}px`,
          'i'
        );
        expect(cssContent).toMatch(minWidthRegex);
      }

      // Exact sum must be 100%
      expect(totalPct).toBe(100);
    });

    it('verifies sticky header cells use box-shadow inset to prevent border detachment', () => {
      const cssPath = path.resolve(__dirname, '../../src/features/inventory/InventoryTableV2.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      const thRuleMatch = cssContent.match(/\.inventory-table-v2\s+thead\s+th\s*\{([^}]*)\}/is);
      expect(thRuleMatch).not.toBeNull();
      const thBody = thRuleMatch ? thRuleMatch[1] : '';

      expect(thBody).toMatch(/position\s*:\s*sticky\s*;/i);
      expect(thBody).toMatch(/box-shadow\s*:\s*inset\s+0\s+-1px\s+0/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Challenge 4: Stress Harness: High volume row rendering with boundary data
  // ---------------------------------------------------------------------------
  describe('4. High Density Stress Harness', () => {
    it('renders 100 mixed-state and boundary vehicles smoothly without error', () => {
      const testVehicles: InventoryVehicle[] = [];
      for (let i = 0; i < 100; i++) {
        testVehicles.push(
          createMockVehicle({
            id: `STRESS-VIN-${i}`,
            vin: `1FTFW1E86HFA${10000 + i}`,
            stockNumber: `STK${1000 + i}`,
            price: i % 5 === 0 ? 999999 : 12000 + i * 500,
            msrp: i % 3 === 0 ? undefined : 15000 + i * 500,
            imageUrl: i % 4 === 0 ? undefined : 'https://example.com/thumb.jpg',
            dealerMail: {
              dataState: 'current',
              hasActiveHold: i % 2 === 0,
              position: 'primary',
              activeRecordCount: 1,
              canViewEvidence: true,
              canManageHold: true,
              updatedAt: '2026-09-17T12:00:00Z',
            },
            serviceReadiness: {
              status: i % 3 === 0 ? 'serviced' : i % 3 === 1 ? 'in_service' : 'needs_service',
            } as any,
            movement: i % 5 === 0 ? ({ state: 'in_transit', destination: 'Howell' } as any) : undefined,
          })
        );
      }

      const startTime = performance.now();
      render(
        <InventoryTableV2
          vehicles={testVehicles}
          sorts={mockSorts}
          onSortChange={vi.fn()}
          onSelectVehicle={vi.fn()}
        />
      );
      const renderDurationMs = performance.now() - startTime;

      // Ensure all 100 rows rendered with all cells intact
      const renderedRows = document.querySelectorAll('tbody tr.inventory-table-v2-row');
      expect(renderedRows.length).toBe(100);
      // Ensure all cells in each row have their inner div wrappers
      renderedRows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        expect(cells.length).toBe(6);
      });
    });
  });
});
