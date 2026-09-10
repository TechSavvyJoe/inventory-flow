import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoreName, TransferRecord, VehicleRecord } from '../../types';
import { VehicleLocationOverview } from './VehicleLocationOverview';

afterEach(cleanup);
function vehicle(stock: string, homeStore: StoreName, currentLocation: string, confidence = 'verified'): VehicleRecord {
  return {
    vin: `TESTDATA${stock.padStart(9, '0')}`,
    stockNumber: stock,
    vehicleName: `Demo Ford ${stock}`,
    homeStore,
    sourceReportedLocation: homeStore,
    movement: { currentLocation, locationConfidence: confidence },
  } as VehicleRecord;
}

describe('inventory location overview', () => {
  it('distinguishes home inventory, away vehicles, visiting vehicles and all stores', () => {
    render(<MemoryRouter><VehicleLocationOverview homeStore="Howell" transfers={[]} vehicles={[
      vehicle('HOME', 'Howell', 'Howell'),
      vehicle('AWAY', 'Howell', 'Ford Detroit'),
      vehicle('VISIT', 'Lincoln', 'Howell'),
      vehicle('UNKNOWN', 'Howell', 'Ford Detroit', 'unknown'),
    ]} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Howell home inventory 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home inventory away 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Visiting Howell 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Home inventory away 1' }));
    const result = screen.getByRole('region', { name: 'Home inventory away' });
    expect(within(result).getByRole('link', { name: 'Demo Ford AWAY' })).toHaveAttribute('href', '/inventory?scope=group&q=TESTDATA00000AWAY');
    expect(result).toHaveTextContent('Departure time unavailable');
    expect(result).not.toHaveTextContent('Demo Ford UNKNOWN');
    expect(result).not.toHaveTextContent('Demo Ford VISIT');
  });

  it('lets a user search other-store vehicle locations without exposing private transfer records', () => {
    render(<MemoryRouter><VehicleLocationOverview homeStore="Howell" transfers={[]} vehicles={[vehicle('HOME', 'Howell', 'Howell'), vehicle('OTHER', 'Lincoln', 'Lincoln')]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'All stores 2' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search inventory locations' }), { target: { value: 'OTHER' } });
    expect(screen.getByRole('link', { name: 'Demo Ford OTHER' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Demo Ford HOME' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 1 vehicles')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close locations' }));
    expect(screen.queryByRole('region', { name: 'All stores' })).not.toBeInTheDocument();
  });

  it('times only the current move, not another move for the same VIN', () => {
    const away = vehicle('AWAY', 'Howell', 'Lincoln');
    away.movement.transferId = 'active-move';
    const event = (hours: number) => ({ type: 'vehicle_departed', occurredAt: new Date(Date.now() - hours * 3_600_000).toISOString() });
    const transfers = [
      { id: 'active-move', vin: away.vin, events: [event(49)] },
      { id: 'old-move', vin: away.vin, events: [event(240)] },
    ] as TransferRecord[];
    render(<MemoryRouter><VehicleLocationOverview homeStore="Howell" transfers={transfers} vehicles={[away]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Home inventory away 1' }));
    expect(screen.getByRole('region', { name: 'Home inventory away' })).toHaveTextContent('2 days away');
    expect(screen.queryByText('10 days away')).not.toBeInTheDocument();
  });

  it('uses shared actual-departure timing without requiring private transfer access', () => {
    const other = vehicle('OTHER', 'Lincoln', 'Ford Detroit');
    other.movement.departedAt = new Date(Date.now() - 73 * 3_600_000).toISOString();
    render(<MemoryRouter><VehicleLocationOverview homeStore="Howell" transfers={[]} vehicles={[other]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'All stores 1' }));
    const result = screen.getByRole('region', { name: 'All stores' });
    expect(result).toHaveTextContent('3 days away');
    expect(within(result).getByRole('link', { name: 'Demo Ford OTHER' })).toHaveAttribute('href', '/inventory?scope=group&q=TESTDATA0000OTHER');
  });
});
