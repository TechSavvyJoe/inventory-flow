import { useEffect, useId, useRef, useState } from 'react'
import { CarFront, ChevronUp, FileText, Heart, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { formatMoney } from './inventory-utils'
import { TakeHomeSheet } from './TakeHomeSheet'
import type { InventoryVehicle } from './types'
import type { ShortlistEntry, ShortlistManagement } from './useCustomerShortlist'
import './CustomerShortlistDrawer.css'

export interface CustomerShortlistDrawerProps {
  entries: ShortlistEntry[]
  onRemove: (id: string) => void
  onClear: () => void
  onSelectVehicle?: (vehicle: { id: string }, trigger: HTMLButtonElement) => void
  management?: ShortlistManagement
  authorizedVehicles?: InventoryVehicle[]
  accessContext?: string
}

export function CustomerShortlistDrawer({ entries, onRemove, onClear, onSelectVehicle, management, authorizedVehicles = [], accessContext }: CustomerShortlistDrawerProps) {
  const [expanded, setExpanded] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [renameLabel, setRenameLabel] = useState(management?.activeLabel ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sheetSnapshot, setSheetSnapshot] = useState<{ listId: string | null; label: string; vehicles: InventoryVehicle[] } | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  useEffect(() => { setRenameLabel(management?.activeLabel ?? ''); setConfirmDelete(false) }, [management?.activeListId, management?.activeLabel])
  useEffect(() => { setSheetSnapshot(null) }, [accessContext, management?.accessRevoked])
  if (!entries.length && !management) return null
  const selectedVehicles = entries.flatMap(entry => {
    if (entry.available === false) return []
    const vehicle = authorizedVehicles.find(candidate => candidate.vin === entry.vin)
    return vehicle ? [vehicle] : []
  })
  return <section className="shortlist-drawer" aria-label={management ? 'Customer saved lists' : 'Customer shortlist'}>
    <header className="shortlist-drawer__header">
      <button ref={toggleRef} type="button" className="shortlist-drawer__toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>
        <Heart size={18} aria-hidden="true" /><span>{management?.activeLabel ?? 'Shortlist'} <strong>{entries.length}</strong></span><ChevronUp size={18} aria-hidden="true" />
      </button>
      {entries.length ? <button type="button" className="shortlist-drawer__clear" onClick={onClear} disabled={management?.saving || management?.pendingAction}><Trash2 size={16} aria-hidden="true" />Clear list</button> : null}
    </header>
    {expanded ? <div id={panelId} className="shortlist-drawer__content">
      {management ? <div className="shortlist-manager">
        <div className="shortlist-manager__row">
          <label><span>Customer list</span><select aria-label="Customer list" value={management.activeListId ?? ''} onChange={event => management.selectList(event.target.value)} disabled={management.loading || management.saving || management.pendingAction || !management.lists.length}>
            {!management.lists.length ? <option value="">No saved lists yet</option> : null}
            {management.lists.map(list => <option key={list.id} value={list.id}>{list.label} ({list.count})</option>)}
          </select></label>
          <span className="shortlist-manager__status" role="status">{management.saving ? 'Saving…' : management.pendingAction ? 'Action needs confirmation' : management.loading ? 'Checking for updates…' : management.lastConfirmedAt ? `Saved ${new Date(management.lastConfirmedAt).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })}` : 'Not yet confirmed'}</span>
        </div>
        <p>Use initials or a nickname. Do not enter contact information.</p>
        <form className="shortlist-manager__form" onSubmit={async event => { event.preventDefault(); if (await management.createList(newLabel)) setNewLabel('') }}>
          <label><span>New list</span><input value={newLabel} onChange={event => setNewLabel(event.target.value)} maxLength={80} placeholder="Initials or nickname" /></label>
          <button type="submit" disabled={management.saving || management.pendingAction}><Plus size={16} aria-hidden="true" />Create</button>
        </form>
        {management.activeListId ? <form className="shortlist-manager__form" onSubmit={event => { event.preventDefault(); void management.renameActiveList(renameLabel) }}>
          <label><span>Rename list</span><input value={renameLabel} onChange={event => setRenameLabel(event.target.value)} maxLength={80} /></label>
          <button type="submit" disabled={management.saving || management.pendingAction}>Rename</button>
          {confirmDelete ? <><button type="button" className="is-danger" disabled={management.saving || management.pendingAction} onClick={() => { void management.deleteActiveList(); setConfirmDelete(false) }}>Confirm delete</button><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button></> : <button type="button" disabled={management.pendingAction} onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true" />Delete</button>}
        </form> : null}
        {management.error ? <div className="shortlist-manager__error" role="alert"><span>{management.error}</span><button type="button" onClick={management.retry}><RotateCw size={16} aria-hidden="true" />Retry</button></div> : null}
      </div> : null}
      <div className="shortlist-drawer__intro">
        <p>Current authorized inventory facts are shown below. Confirm availability with the home store.</p>
        {management && selectedVehicles.length ? <button type="button" onClick={() => setSheetSnapshot({ listId: management.activeListId, label: management.activeLabel, vehicles: [...selectedVehicles] })}><FileText size={16} aria-hidden="true" />Customer sheet ({selectedVehicles.length})</button> : null}
      </div>
      {entries.length ? <ul className="shortlist-drawer__vehicles">
        {entries.map(entry => <li key={entry.id} className={`shortlist-drawer__vehicle${entry.available === false ? ' is-unavailable' : ''}`}>
          <button type="button" className="shortlist-drawer__open" disabled={entry.available === false} onClick={event => onSelectVehicle?.({ id: entry.id }, event.currentTarget)} aria-label={entry.available === false ? `Saved vehicle ${entry.vin} is unavailable in current access` : `Open shortlisted ${entry.displayName}, stock ${entry.stockNumber}`}>
            {entry.imageUrl ? <img src={entry.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <CarFront size={28} aria-hidden="true" />}
            <strong>{entry.displayName}</strong>{entry.available === false ? <span>Unavailable in current access</span> : <><span>Stock {entry.stockNumber}</span><b>{formatMoney(entry.price)}</b>{entry.exteriorColor ? <span>{entry.exteriorColor}</span> : null}</>}
          </button>
          <button type="button" className="shortlist-drawer__remove" aria-label={`Remove ${entry.available === false ? entry.vin : entry.stockNumber} from list`} onClick={() => onRemove(entry.id)}><X size={16} aria-hidden="true" /></button>
        </li>)}
      </ul> : <p className="shortlist-drawer__empty">Choose a list or create one, then use Save on a vehicle.</p>}
    </div> : <div id={panelId} hidden />}
    {sheetSnapshot && !management?.accessRevoked ? <TakeHomeSheet vehicles={sheetSnapshot.vehicles} listLabel={sheetSnapshot.label} onClose={() => setSheetSnapshot(null)} returnFocusRef={toggleRef} /> : null}
  </section>
}
