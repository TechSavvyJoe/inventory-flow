import { useId, useState } from 'react';
import { ChevronDown, MapPin, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { StoreName, TransferRecord, VehicleRecord } from '../../types';
import { awayFromHomeSummary } from './moveSummary';
import './transfer-simple.css';

type LocationView = 'home' | 'away' | 'visiting' | 'group';

export function VehicleLocationOverview({ vehicles, transfers, homeStore }: {
  vehicles: VehicleRecord[];
  transfers: TransferRecord[];
  homeStore: StoreName;
}) {
  const [view, setView] = useState<LocationView | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const regionId = useId();
  const home = vehicles.filter(vehicle => vehicle.homeStore === homeStore);
  const knownLocation = (vehicle: VehicleRecord) => ['verified', 'reported'].includes(vehicle.movement.locationConfidence);
  const location = (vehicle: VehicleRecord) => vehicle.movement.currentLocation || vehicle.sourceReportedLocation || 'Not confirmed';
  const away = home.filter(vehicle => knownLocation(vehicle) && location(vehicle) !== homeStore);
  const visiting = vehicles.filter(vehicle => vehicle.homeStore !== homeStore && knownLocation(vehicle) && location(vehicle) === homeStore);
  const scopes = { home, away, visiting, group: vehicles };
  const normalizedQuery = query.trim().toLowerCase();
  const matches = view ? scopes[view].filter(vehicle => [vehicle.vehicleName, vehicle.stockNumber, vehicle.vin, vehicle.homeStore, location(vehicle)].some(value => value.toLowerCase().includes(normalizedQuery))) : [];
  const visible = showAll ? matches : matches.slice(0, 12);
  const records = new Map(transfers.map(transfer => [transfer.id, transfer]));
  const labels: Record<LocationView, string> = { home: `${homeStore} home inventory`, away: 'Home inventory away', visiting: `Visiting ${homeStore}`, group: 'All stores' };
  function choose(next: LocationView) {
    setView(current => current === next ? null : next);
    setQuery('');
    setShowAll(false);
  }
  return <section className="vehicle-location-overview" aria-label="Inventory locations">
    <div className="vehicle-location-views">
      {(['home', 'away', 'visiting', 'group'] as const).map(key => <button key={key} type="button" onClick={() => choose(key)} aria-label={`${labels[key]} ${scopes[key].length}`} aria-expanded={view === key} aria-controls={regionId}>
        <span>{labels[key]}</span><strong>{scopes[key].length}</strong><ChevronDown aria-hidden="true" size={15} />
      </button>)}
    </div>
    {view ? <div id={regionId} className="vehicle-location-results" role="region" aria-label={labels[view]}>
      <div className="vehicle-location-results-heading"><h2>{labels[view]}</h2><label><Search aria-hidden="true" size={16} /><input aria-label="Search inventory locations" value={query} onChange={event => setQuery(event.target.value)} placeholder="Stock, VIN, vehicle or store" /></label></div>
      <p>Location updates only. Confirm with the store before promising a vehicle to a customer.</p>
      {matches.length ? <div className="vehicle-location-table-wrap"><table><thead><tr><th>Vehicle</th><th>Home store</th><th>Current location</th><th>Time away</th></tr></thead><tbody>{visible.map(vehicle => {
        const current = location(vehicle);
        const record = vehicle.movement.transferId ? records.get(vehicle.movement.transferId) : undefined;
        const departureEvidence = vehicle.movement.departedAt ? [{ type: 'vehicle_departed', occurredAt: vehicle.movement.departedAt }] : [];
        const timing = knownLocation(vehicle) ? awayFromHomeSummary(vehicle.homeStore, current, record?.events ?? departureEvidence) : { label: 'Location needs checking' };
        const timingLabel = timing.label === 'Departure not recorded' && !record ? 'Departure time unavailable' : timing.label;
        return <tr key={vehicle.vin}><td><Link to={`/inventory?scope=group&q=${encodeURIComponent(vehicle.vin)}`}>{vehicle.vehicleName}</Link><small>Stock {vehicle.stockNumber}</small></td><td data-label="Home">{vehicle.homeStore}</td><td data-label="Current"><span><MapPin aria-hidden="true" size={14} />{current}</span>{!knownLocation(vehicle) ? <small>Not confirmed</small> : null}</td><td data-label="Away">{timingLabel}</td></tr>;
      })}</tbody></table></div> : <p className="vehicle-location-empty">No vehicles match this location view.</p>}
      <footer><span aria-live="polite">Showing {visible.length} of {matches.length} vehicles</span>{matches.length > visible.length ? <button type="button" onClick={() => setShowAll(true)}>Show all {matches.length}</button> : null}<button type="button" onClick={() => setView(null)}>Close locations</button></footer>
    </div> : null}
  </section>;
}
