import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizedPageSize } from './InventoryExperience';
import { InventoryExperienceHarness } from '../../../tests/unit/inventory-experience-harness';
import type { InventoryVehicle } from './types';

const homeStore = { id: 'howell', name: 'Howell' };

afterEach(() => {
  cleanup();
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('overscroll-behavior');
});

function vehicle(index: number): InventoryVehicle {
  return {
    id: `vehicle-${index}`,
    vin: `1FTFW1E84RKF${String(index).padStart(5, '0')}`,
    stockNumber: `H${String(index).padStart(5, '0')}`,
    year: 2024,
    make: 'Ford',
    model: 'F-150',
    trim: `XLT ${index}`,
    price: 40000 + index,
    mileage: 1000 + index,
    publicListing: { dataState: 'current', isListed: true },
    dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
    dealerMail: { dataState: 'current', hasActiveHold: false, position: null },
    location: { homeStore },
  };
}

describe('modern inventory scope and paging', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('keeps a collapsed service filter visible and counts it with Held', () => {
    const readyHeld = { ...vehicle(1), dealerMail: { dataState: 'current' as const, hasActiveHold: true, position: null }, serviceReadiness: { vin: vehicle(1).vin, status: 'serviced' as const, version: 1, serviceEnteredAt: null, completedAt: '2026-09-14', updatedAt: '2026-09-14T12:00:00Z', updatedBy: 'Synthetic manager', updatedByRole: 'manager' as const, updatedAtStore: 'Howell' as const, store: 'Howell' as const, canManage: false } };
    render(<InventoryExperienceHarness homeStore={homeStore} vehicles={[readyHeld, vehicle(2)]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Held:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ready:/ }));
    expect(screen.getByRole('button', { name: 'Filters 2' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Clear service filter: Ready' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All:/ }));
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ready:/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Clear service filter: Ready' }));
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All service:/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('never loses a secondary view restriction when Filters closes', () => {
    render(<InventoryExperienceHarness homeStore={homeStore} vehicles={[vehicle(1)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: /^New today/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show 0 vehicles' }));
    expect(screen.getByRole('button', { name: 'Filters 1' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Clear view filter: New today' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear 1 filter' }));
    expect(screen.queryByRole('group', { name: 'Active inventory filters' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();
  });

  it('restores a saved service filter with its visible summary, and persists clearing it', () => {
    const key = 'inventory-service:v1:session:howell';
    window.sessionStorage.setItem(key, 'serviced');
    const props = { homeStore, vehicles: [vehicle(1)] };
    const mounted = render(<InventoryExperienceHarness {...props} />);
    expect(screen.getByRole('button', { name: 'Clear service filter: Ready' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear 1 filter' }));
    expect(window.sessionStorage.getItem(key)).toBe('all');
    mounted.unmount();
    render(<InventoryExperienceHarness {...props} />);
    expect(screen.queryByRole('group', { name: 'Active inventory filters' })).not.toBeInTheDocument();
  });

  it('connects the disclosure to both filter areas and returns focus on Escape', async () => {
    render(<InventoryExperienceHarness homeStore={homeStore} vehicles={[vehicle(1)]} />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    const ids = trigger.getAttribute('aria-controls')!.split(' ');
    expect(ids).toHaveLength(2);
    ids.forEach(id => expect(document.getElementById(id)).not.toBeNull());
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(screen.getByRole('button', { name: /^Waiting for service:/ }), { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('region', { name: 'Inventory filters' })).not.toBeInTheDocument();
  });

  it('uses 10 rows as the safe default', () => {
    expect(normalizedPageSize(8)).toBe(10);
    render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={Array.from({ length: 12 }, (_, index) => vehicle(index))}
      />,
    );

    expect(screen.getByText('Showing 1–10 of 12')).toBeInTheDocument();
  });

  it('uses concise visible mobile search and quick-view copy without shortening accessible names', () => {
    const { container } = render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[vehicle(1)]}
      />,
    );

    expect(screen.getByPlaceholderText('Search stock, VIN, vehicle, packages, or equipment…')).toHaveAccessibleName('Search inventory');
    expect(screen.getByRole('button', { name: 'All service: 1 vehicles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waiting for service: 1 vehicles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Being moved: 0 vehicles' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Inventory quick view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Inventory service status' })).not.toBeInTheDocument();
    expect(container.querySelector('.inventory-quick-filter-label--compact')).toHaveTextContent('All');
    expect(container.querySelectorAll('.inventory-quick-filter-label--compact')).toHaveLength(3);
  });

  it('keeps the filtered row actionable after an exact VIN or stock search', async () => {
    const target = vehicle(1);
    render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[target]}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Search inventory' });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: target.vin } });

    await waitFor(() => expect(search).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByRole('listbox', { name: 'Inventory suggestions' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: new RegExp(`Open vehicle details for ${target.year} ${target.make} ${target.model}`, 'i') })[0]).toBeVisible();
  });

  it('filters visible rows as typing changes, without letting shared source text keep unrelated vehicles on screen', () => {
    const lincoln = { ...vehicle(1), make: 'Lincoln', model: 'Nautilus', trim: 'Reserve', vehicleName: '2024 Lincoln Nautilus Reserve' };
    const sourceNoise = { ...vehicle(2), vehicleName: '2024 Ford Explorer XLT', authorizedSearchText: 'Ford Lincoln dealer source metadata' };
    const unrelated = { ...vehicle(3), vehicleName: '2024 Ford F-150 XLT' };
    render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[lincoln, sourceNoise, unrelated]}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Search inventory' }), { target: { value: 'lincoln' } });

    const resultCount = document.querySelector<HTMLElement>('.inventory-results-count')!;
    expect(resultCount).toHaveTextContent('1 shown');
    expect(resultCount).toHaveTextContent('3 group');
    expect(screen.getByRole('button', { name: /Open vehicle details for 2024 Lincoln Nautilus Reserve/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Open vehicle details for 2024 Ford Explorer XLT/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open vehicle details for 2024 Ford F-150 XLT/i })).not.toBeInTheDocument();
  });

  it('clears a query-only empty state instead of leaving the search active', () => {
    render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[vehicle(1)]}
      />,
    );
    const search = screen.getByRole('combobox', { name: 'Search inventory' });
    fireEvent.change(search, { target: { value: 'missing vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();
  });

  it('labels home scope accurately and only exposes a location filter for all locations', () => {
    render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        groupStores={[homeStore, { id: 'fowlerville', name: 'Fowlerville' }]}
        vehicles={[vehicle(1)]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Howell inventory, 1 of 1 group vehicles' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    expect(screen.getByLabelText('Home inventory: Howell')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Location' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All locations, 1 group vehicles' }));
    expect(screen.getByRole('combobox', { name: 'Location' })).toBeInTheDocument();
  });

  it('exposes five-level sort composition with explicit direction and priority controls', () => {
    render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[vehicle(1), vehicle(2)]}
        initialSorts={[{ key: 'vehicle', direction: 'asc' }]}
      />,
    );

    const sortDisclosure = screen.getByRole('button', { name: /Sort inventory/i });
    expect(sortDisclosure).toHaveAttribute('aria-expanded', 'false');
    expect(sortDisclosure).toHaveAttribute('aria-controls');
    fireEvent.click(sortDisclosure);
    expect(sortDisclosure).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByLabelText('Add another inventory sort'), {
      target: { value: 'holdStatus' },
    });
    fireEvent.change(screen.getByLabelText('Add another inventory sort'), {
      target: { value: 'recentActivity' },
    });

    expect(screen.getByLabelText('Sort priority 2 field')).toHaveValue('holdStatus');
    expect(screen.getByLabelText('Sort priority 3 field')).toHaveValue('recentActivity');
    fireEvent.click(screen.getByRole('button', { name: /Hold status: change to descending/i }));
    expect(screen.getByRole('button', { name: /Hold status: change to ascending/i })).toHaveTextContent('Descending');
    fireEvent.click(screen.getByRole('button', { name: /Move Latest source update earlier/i }));
    expect(screen.getByLabelText('Sort priority 2 field')).toHaveValue('recentActivity');
  });
});

describe('vehicle workspace background isolation', () => {
  beforeEach(() => window.sessionStorage.clear());

  function openWorkspace() {
    fireEvent.click(screen.getByRole('button', { name: /^Open vehicle details for 2024 Ford F-150/i }));
    return screen.getByRole('dialog');
  }

  function closeWorkspace() {
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close vehicle details' }));
  }

  it('opens the matching workspace section from each inventory table data control', async () => {
    const unit = vehicle(4);
    unit.features = ['Heated Steering Wheel'];
    unit.changeSummary = 'Price changed today';
    render(<InventoryExperienceHarness homeStore={homeStore} vehicles={[unit]}
      />);

    for (const [control, section, target] of [
      [/View all 1 equipment items for/i, 'Equipment', 'equipment'],
      [/View change history for/i, 'Activity', 'timeline'],
      [/Open hold details for/i, 'Holds & moves', 'hold'],
    ] as const) {
      const table = screen.getByRole('region', { name: 'Inventory results table' });
      fireEvent.click(within(table).getByRole('button', { name: control }));
      const dialog = screen.getByRole('dialog');
      await waitFor(() => expect(dialog).toHaveAttribute('data-active-target', target));
      expect(within(dialog).getByRole('tab', { name: section, selected: true })).toBeVisible();
      expect(within(dialog).getByRole('heading', { name: '2024 Ford F-150 XLT 4' })).toBeVisible();
      closeWorkspace();
    }
  });

  it('returns focus to the vehicle trigger after Escape closes the workspace', async () => {
    render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[vehicle(3)]}
      />,
    );
    const trigger = screen.getByRole('button', { name: /^Open vehicle details for 2024 Ford F-150/i });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('returns focus to the vehicle trigger after the visible Close action', async () => {
    render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[vehicle(5)]}
      />,
    );
    const trigger = screen.getByRole('button', { name: /^Open vehicle details for 2024 Ford F-150/i });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close vehicle details' }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('uses the primary View action as the fallback when a pointer click does not focus it', async () => {
    const unit = vehicle(6);
    unit.features = ['FX4 Off-Road Package'];
    render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[unit]}
      />,
    );
    const trigger = document.querySelector<HTMLButtonElement>('button[data-row-action="open-details"]')!;
    const secondary = document.querySelector<HTMLButtonElement>('.inv-desk-equipment')!;
    const visibleRects = { length: 1 } as DOMRectList;
    const triggerRects = vi.spyOn(trigger, 'getClientRects').mockReturnValue(visibleRects);
    const secondaryRects = vi.spyOn(secondary, 'getClientRects').mockReturnValue(visibleRects);
    trigger.focus();
    trigger.blur();
    expect(trigger).not.toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close vehicle details' }));

    await waitFor(() => expect(trigger).toHaveFocus());
    triggerRects.mockRestore();
    secondaryRects.mockRestore();
  });

  it('moves focus out before hiding the page, locks scrolling, and restores prior inline state', async () => {
    document.body.style.setProperty('overflow', 'clip', 'important');
    document.body.style.setProperty('overscroll-behavior', 'contain');
    const { container } = render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[vehicle(1)]}
      />,
    );
    const experience = container.querySelector<HTMLElement>('.inventory-experience');
    const background = container.querySelector<HTMLElement>('.inventory-experience__content');
    expect(experience).toBeTruthy();
    expect(background).toBeTruthy();
    background!.setAttribute('aria-hidden', 'false');

    const opener = screen.getByRole('button', { name: /^Open vehicle details for 2024 Ford F-150/i });
    opener.focus();
    expect(opener).toHaveFocus();
    const dialog = openWorkspace();

    expect(background).toHaveAttribute('inert', '');
    await waitFor(() => expect(background).toHaveAttribute('aria-hidden', 'true'));
    expect(background).not.toContainElement(document.activeElement as HTMLElement);
    expect(dialog).not.toHaveAttribute('inert');
    expect(dialog).not.toHaveAttribute('aria-hidden', 'true');
    expect(experience).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.overscrollBehavior).toBe('none');

    closeWorkspace();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(background).not.toHaveAttribute('inert');
    expect(background).toHaveAttribute('aria-hidden', 'false');
    expect(document.body.style.overflow).toBe('clip');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
    expect(document.body.style.overscrollBehavior).toBe('contain');
  });

  it('cleans up on unmount and remains correct across repeated open and close cycles', () => {
    document.body.style.setProperty('overflow', 'auto');
    const { container, unmount } = render(
      <InventoryExperienceHarness
        homeStore={homeStore}
        vehicles={[vehicle(2)]}
      />,
    );
    const background = container.querySelector<HTMLElement>('.inventory-experience__content')!;

    openWorkspace();
    expect(background).toHaveAttribute('inert');
    closeWorkspace();
    expect(background).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('auto');

    openWorkspace();
    expect(background).toHaveAttribute('aria-hidden', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(background).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).toBe('auto');

    openWorkspace();
    unmount();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.overscrollBehavior).toBe('');
  });
});
