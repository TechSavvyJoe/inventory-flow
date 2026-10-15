import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryExpansionControl, InventoryExpansionProvider } from './InventoryExpansion';
import { InventoryMobileList, InventoryTable } from './InventoryTable';
import type { InventoryVehicle } from './types';

const preferenceKey = 'inventory-flow.inventory-detail-density';
beforeEach(() => localStorage.removeItem(preferenceKey));
afterEach(() => { cleanup(); localStorage.removeItem(preferenceKey); });
function vehicle(suffix = '1'): InventoryVehicle {
  return {
    id:`SYNTHETIC-VIN-${suffix}`, vin:`SYNTHETIC-VIN-${suffix}`, stockNumber:`DEMO-${suffix}`, year:2024, make:'Ford', model:`Example ${suffix}`, trim:'Test', price:24000, mileage:12000,
    engine:'Synthetic engine', transmission:'Synthetic automatic', exteriorColor:'Synthetic blue', interiorColor:'Synthetic gray',
    publicListing:{ dataState:'current', isListed:true, listingUrl:'https://example.com/vehicle' },
    dealerOn:{ dataState:'current', inStock:true, inTransit:false, inProduction:false },
    dealerMail:{ dataState:'current', hasActiveHold:false, canViewEvidence:false },
    location:{ homeStore:{ id:'howell', name:'Howell' } },
    windowSticker:{ dataState:'current', basePrice:30000, pricingCurrency:'USD', equipmentGroup:'Synthetic package', options:['Synthetic seat'] },
    autoCheckReport:{ dataState:'stale', score:90, ownerCount:1, checks:[{ label:'Odometer Check', status:'No issues', detail:'Mileage discrepancy reported' }] },
    fordOasis:{ dataState:'incomplete', openActionsCaptured:false, openFieldServiceActions:[{ code:'DEMO-01', description:'Synthetic remedy is not yet available' }], warrantyCoverages:[], extendedCoverageExpirations:[] },
  };
}
function Surface({ vehicles, context = 'employee-a', both = false }: { vehicles: InventoryVehicle[]; context?: string; both?: boolean }) {
  return <InventoryExpansionProvider key={context}><InventoryExpansionControl/>
    <InventoryTable vehicles={vehicles} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()}/>
    {both ? <InventoryMobileList vehicles={vehicles} onSelectVehicle={vi.fn()}/> : null}
  </InventoryExpansionProvider>;
}

describe('inventory expansion preference and vehicle disclosures', () => {
  it('defaults compact while keeping copies, operational truth, source warnings and Records direct', async () => {
    const record = vehicle();
    render(<Surface vehicles={[record]}/>);
    const toggle = screen.getByRole('button', { name:'Expand details for 2024 Ford Example 1 Test' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(panel).toHaveAttribute('inert');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('region', { name:'Additional details for 2024 Ford Example 1 Test' })).not.toBeInTheDocument();
    for (const name of ['Copy stock number: DEMO-1', 'Copy VIN: SYNTHETIC-VIN-1', 'Copy mileage: 12000', 'Copy window sticker base MSRP: 30000']) expect(screen.getByRole('button', { name })).toBeEnabled();
    expect(screen.getByRole('button', { name:/Open hold details/ })).toHaveTextContent('No current hold');
    const warnings = screen.getByRole('note', { name:'Source qualifications for SYNTHETIC-VIN-1' });
    expect(warnings).toHaveTextContent('Mileage discrepancy reported');
    expect(warnings).toHaveTextContent('Saved report · refresh at source');
    expect(warnings).toHaveTextContent('result incomplete');
    expect(warnings).toHaveTextContent('Synthetic remedy is not yet available');
    expect(warnings).toHaveTextContent('Partial captured record');
    await userEvent.click(screen.getByRole('button', { name:'Open vehicle records for 2024 Ford Example 1 Test' }));
    expect(screen.getByRole('dialog', { name:'2024 Ford Example 1 Test records' })).toBeVisible();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('shares VIN expansion across layouts with unique panel IDs and a persisted global enum only', async () => {
    render(<Surface vehicles={[vehicle()]} both/>);
    const toggles = screen.getAllByRole('button', { name:'Expand details for 2024 Ford Example 1 Test' });
    expect(new Set(toggles.map(toggle => toggle.getAttribute('aria-controls'))).size).toBe(2);
    toggles[0].focus();
    await userEvent.keyboard('{Enter}');
    for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('region', { name:'Additional details for 2024 Ford Example 1 Test' })).toHaveLength(2);
    expect(localStorage.getItem(preferenceKey)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name:'Expand all vehicle details' }));
    expect(localStorage.getItem(preferenceKey)).toBe('expanded');
    await userEvent.click(screen.getAllByRole('button', { name:'Collapse details for 2024 Ford Example 1 Test' })[0]);
    expect(screen.getByRole('button', { name:'Expand all vehicle details' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name:'Expand all vehicle details' }));
    await userEvent.click(screen.getByRole('button', { name:'Collapse all vehicle details' }));
    expect(localStorage.getItem(preferenceKey)).toBe('collapsed');
    for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps per-VIN choices through filtering, order changes and refreshed records; access changes clear them', () => {
    const first = vehicle('1'), second = vehicle('2');
    const view = render(<Surface vehicles={[first, second]}/>);
    fireEvent.click(screen.getByRole('button', { name:'Expand details for 2024 Ford Example 1 Test' }));
    view.rerender(<Surface vehicles={[second]}/>);
    expect(screen.getByRole('button', { name:'Expand details for 2024 Ford Example 2 Test' })).toHaveAttribute('aria-expanded','false');
    view.rerender(<Surface vehicles={[{...second}, {...first}]}/>);
    expect(screen.getByRole('button', { name:'Collapse details for 2024 Ford Example 1 Test' })).toHaveAttribute('aria-expanded','true');
    view.rerender(<Surface context="employee-b" vehicles={[first,second]}/>);
    expect(screen.getByRole('button', { name:'Expand details for 2024 Ford Example 1 Test' })).toHaveAttribute('aria-expanded','false');
    fireEvent.click(screen.getByRole('button', { name:'Expand all vehicle details' }));
    view.rerender(<Surface vehicles={[first,second,vehicle('3')]} context="employee-b"/>);
    expect(screen.getByRole('button', { name:'Collapse details for 2024 Ford Example 3 Test' })).toHaveAttribute('aria-expanded','true');
    view.unmount();
    render(<Surface vehicles={[vehicle('4')]}/>);
    expect(screen.getByRole('button', { name:'Collapse details for 2024 Ford Example 4 Test' })).toHaveAttribute('aria-expanded','true');
    expect(within(screen.getByRole('region', { name:'Additional details for 2024 Ford Example 4 Test' })).getByRole('group', { name:'Configuration for 2024 Ford Example 4 Test' })).toBeVisible();
  });
});
