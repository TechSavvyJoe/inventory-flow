import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InventoryExperience, normalizedPageSize } from './InventoryExperience';
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

  it('uses 10 rows as the safe default', () => {
    expect(normalizedPageSize(8)).toBe(10);
    render(
      <InventoryExperience
        homeStore={homeStore}
        vehicles={Array.from({ length: 12 }, (_, index) => vehicle(index))}
        metrics={{ publicUnits: 12, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }}
      />,
    );

    expect(screen.getByText('Showing 1–10 of 12')).toBeInTheDocument();
  });

  it('uses concise visible mobile search and quick-view copy without shortening accessible names', () => {
    const { container } = render(
      <InventoryExperience
        homeStore={homeStore}
        vehicles={[vehicle(1)]}
        metrics={{ publicUnits: 1, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }}
      />,
    );

    expect(screen.getByPlaceholderText('Search stock, VIN, vehicle, packages, or equipment…')).toHaveAccessibleName('Search inventory');
    expect(screen.getByRole('button', { name: 'No current hold: 1 vehicles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Being moved: 0 vehicles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New today: 0 vehicles' })).toBeInTheDocument();
    expect(container.querySelector('.inventory-quick-filter-label--compact')).toHaveTextContent('All');
    expect(container.querySelectorAll('.inventory-quick-filter-label--compact')).toHaveLength(6);
  });

  it('labels home scope accurately and only exposes a location filter for all locations', () => {
    render(
      <InventoryExperience
        homeStore={homeStore}
        groupStores={[homeStore, { id: 'fowlerville', name: 'Fowlerville' }]}
        vehicles={[vehicle(1)]}
        metrics={{ publicUnits: 1, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Howell inventory, 1 of 1 group vehicles' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    expect(screen.getByLabelText('Home inventory: Howell')).toBeInTheDocument();
    expect(screen.queryByLabelText('Location')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All locations, 1 group vehicles' }));
    expect(screen.getByLabelText('Location')).toBeInTheDocument();
  });

  it('exposes five-level sort composition with explicit direction and priority controls', () => {
    render(
      <InventoryExperience
        homeStore={homeStore}
        vehicles={[vehicle(1), vehicle(2)]}
        metrics={{ publicUnits: 2, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }}
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
    fireEvent.click(screen.getAllByRole('button', { name: /^Open details for 2024 Ford F-150/i })[0]);
    return screen.getByRole('dialog');
  }

  function closeWorkspace() {
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close vehicle details' }));
  }

  it('returns focus to the vehicle trigger after Escape closes the workspace', async () => {
    render(
      <InventoryExperience
        homeStore={homeStore}
        vehicles={[vehicle(3)]}
        metrics={{ publicUnits: 1, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }}
      />,
    );
    const trigger = screen.getAllByRole('button', { name: /^Open details for 2024 Ford F-150/i })[0];
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('locks scrolling, isolates only the page background, and restores prior inline state', () => {
    document.body.style.setProperty('overflow', 'clip', 'important');
    document.body.style.setProperty('overscroll-behavior', 'contain');
    const { container } = render(
      <InventoryExperience
        homeStore={homeStore}
        vehicles={[vehicle(1)]}
        metrics={{ publicUnits: 1, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }}
      />,
    );
    const experience = container.querySelector<HTMLElement>('.inventory-experience');
    const background = container.querySelector<HTMLElement>('.inventory-experience__content');
    expect(experience).toBeTruthy();
    expect(background).toBeTruthy();
    background!.setAttribute('aria-hidden', 'false');

    const dialog = openWorkspace();

    expect(background).toHaveAttribute('inert', '');
    expect(background).toHaveAttribute('aria-hidden', 'true');
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
      <InventoryExperience
        homeStore={homeStore}
        vehicles={[vehicle(2)]}
        metrics={{ publicUnits: 1, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }}
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
