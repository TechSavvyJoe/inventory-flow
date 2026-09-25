import { useId, useState } from 'react'
import { CarFront, ChevronUp, Heart, Trash2, X } from 'lucide-react'
import { formatMoney } from './inventory-utils'
import type { ShortlistEntry } from './useCustomerShortlist'

export interface CustomerShortlistDrawerProps {
  entries: ShortlistEntry[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onSelectVehicle?: (vehicle: { id: string }, trigger: HTMLButtonElement) => void;
}

/** A small session shortlist; every displayed fact comes from current inventory. */
export function CustomerShortlistDrawer({ entries, onRemove, onClear, onSelectVehicle }: CustomerShortlistDrawerProps) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  if (!entries.length) return null
  return <section className="shortlist-drawer" aria-label="Customer shortlist">
    <header className="shortlist-drawer__header">
      <button type="button" className="shortlist-drawer__toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>
        <Heart size={18} aria-hidden="true" /><span>Shortlist <strong>{entries.length}</strong></span><ChevronUp size={18} aria-hidden="true" />
      </button>
      <button type="button" className="shortlist-drawer__clear" onClick={onClear}><Trash2 size={16} aria-hidden="true" />Clear shortlist</button>
    </header>
    {expanded ? <div id={panelId} className="shortlist-drawer__content">
      <p>Compare current inventory details. Confirm availability with the home store.</p>
      <ul className="shortlist-drawer__vehicles">
        {entries.map(entry => <li key={entry.id} className="shortlist-drawer__vehicle">
          <button type="button" className="shortlist-drawer__open" onClick={event => onSelectVehicle?.({ id: entry.id }, event.currentTarget)} aria-label={`Open shortlisted ${entry.displayName}, stock ${entry.stockNumber}`}>
            {entry.imageUrl ? <img src={entry.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <CarFront size={28} aria-hidden="true" />}
            <strong>{entry.displayName}</strong><span>Stock {entry.stockNumber}</span><b>{formatMoney(entry.price)}</b>
            {entry.exteriorColor ? <span>{entry.exteriorColor}</span> : null}
          </button>
          <button type="button" className="shortlist-drawer__remove" aria-label={`Remove ${entry.stockNumber} from shortlist`} onClick={() => onRemove(entry.id)}><X size={16} aria-hidden="true" /></button>
        </li>)}
      </ul>
    </div> : <div id={panelId} hidden />}
  </section>
}
