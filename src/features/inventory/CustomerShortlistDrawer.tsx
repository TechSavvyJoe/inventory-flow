import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CarFront, ChevronDown, ChevronUp, FileText, Heart, Pencil, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { formatMoney } from './inventory-utils'
import { TakeHomeSheet } from './TakeHomeSheet'
import { formatNumber } from '../../lib/format'
import { standoutEquipment } from './vehicle-feature-utils'
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
  modalOpen?: boolean
}

export function CustomerShortlistDrawer({ entries, onRemove, onClear, onSelectVehicle, management, authorizedVehicles = [], accessContext, modalOpen = false }: CustomerShortlistDrawerProps) {
  const [expanded, setExpanded] = useState(false)
  const [managementMode, setManagementMode] = useState<'create' | 'manage' | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [renameLabel, setRenameLabel] = useState(management?.activeLabel ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [sheetSnapshot, setSheetSnapshot] = useState<{ listId: string | null; label: string; vehicles: InventoryVehicle[] } | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const sheetButtonRef = useRef<HTMLButtonElement>(null)
  const newListRef = useRef<HTMLButtonElement>(null)
  const manageRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const managementPanelId = useId()
  const writesBlocked = Boolean(management && (!management.readyForWrites || management.saving || management.pendingAction || management.accessRevoked))
  const vehiclesByVin = useMemo(() => new Map(authorizedVehicles.map(vehicle => [vehicle.vin, vehicle])), [authorizedVehicles])
  const restoreManagementFocus = (mode: 'create' | 'manage') => window.requestAnimationFrame(() => (mode === 'create' ? newListRef : manageRef).current?.focus({ preventScroll: true }))
  const closeManagement = (mode: 'create' | 'manage', clearNewLabel = false) => {
    setManagementMode(null)
    setConfirmDelete(false)
    if (clearNewLabel) setNewLabel('')
    restoreManagementFocus(mode)
  }
  const closeShortlist = (restoreFocus = false) => {
    setExpanded(false)
    setManagementMode(null)
    setConfirmDelete(false)
    setConfirmClear(false)
    if (restoreFocus) window.requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll:true }))
  }
  useLayoutEffect(() => {
    if (!expanded) return
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll:true }))
    const isActiveSurface = () => !Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some(dialog => !dialogRef.current?.contains(dialog))
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isActiveSurface()) return
      event.preventDefault()
      closeShortlist(true)
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || !isActiveSurface() || dialogRef.current?.contains(target) || toggleRef.current?.contains(target)) return
      closeShortlist(false)
    }
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [expanded])
  useEffect(() => { setRenameLabel(management?.activeLabel ?? ''); setConfirmDelete(false); setConfirmClear(false) }, [management?.activeListId, management?.activeLabel])
  useEffect(() => {
    if (managementMode) closeManagement(managementMode)
  // Closing on a server-selected list change is deliberate; managementMode
  // would make this effect re-run while the user is typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [management?.activeListId])
  useLayoutEffect(() => { setExpanded(false); setManagementMode(null); setConfirmClear(false); setSheetSnapshot(null) }, [accessContext, management?.accessRevoked])
  if (!entries.length && !management) return null
  const selectedVehicles = entries.flatMap(entry => {
    if (entry.available === false) return []
    const vehicle = vehiclesByVin.get(entry.vin)
    return vehicle ? [vehicle] : []
  })
  const dialog = expanded ? <section id={panelId} className="shortlist-drawer__dialog" ref={dialogRef} role="region" aria-labelledby={`${panelId}-title`} inert={modalOpen || Boolean(sheetSnapshot)} aria-hidden={modalOpen || Boolean(sheetSnapshot) ? true : undefined} tabIndex={-1}>
      <header className="shortlist-drawer__dialog-header">
        <div><Heart size={18} aria-hidden="true" /><h2 id={`${panelId}-title`}>{management?.activeLabel ?? 'Customer shortlist'} <span>{entries.length}</span></h2></div>
        <div>{entries.length ? confirmClear ? <><button type="button" className="shortlist-drawer__clear is-danger" onClick={() => { onClear(); setConfirmClear(false) }} disabled={writesBlocked}>Confirm clear</button><button type="button" className="shortlist-drawer__clear" onClick={() => setConfirmClear(false)}>Cancel clear</button></> : <button type="button" className="shortlist-drawer__clear" onClick={() => setConfirmClear(true)} disabled={writesBlocked}><Trash2 size={16} aria-hidden="true" />Clear list</button> : null}<button ref={closeRef} type="button" className="shortlist-drawer__close" onClick={() => closeShortlist(true)} aria-label="Close customer shortlist"><X size={18} aria-hidden="true" /></button></div>
      </header>
      <div className="shortlist-drawer__content" role="region" aria-label={management ? 'Customer saved lists' : 'Customer shortlist'}>
      {management ? <div className="shortlist-manager">
        <div className="shortlist-manager__toolbar">
          <label><span className="shortlist-manager__label">Customer</span><select aria-label="Customer list" value={management.activeListId ?? ''} onChange={event => { setConfirmClear(false); management.selectList(event.target.value) }} disabled={management.loading || management.saving || management.pendingAction || management.accessRevoked || !management.lists.length}>
            {!management.lists.length ? <option value="">No saved lists yet</option> : null}
            {management.lists.map(list => <option key={list.id} value={list.id}>{list.label} ({list.count})</option>)}
          </select></label>
          <button ref={newListRef} type="button" aria-label="New list" aria-expanded={managementMode === 'create'} aria-controls={managementPanelId} disabled={writesBlocked} onClick={() => { if (managementMode === 'create') closeManagement('create', true); else { setManagementMode('create'); setConfirmDelete(false) } }}><Plus size={16} aria-hidden="true" /><span>New list</span></button>
          {management.activeListId ? <button ref={manageRef} type="button" aria-label="Manage" aria-expanded={managementMode === 'manage'} aria-controls={managementPanelId} onClick={() => { if (managementMode === 'manage') closeManagement('manage'); else { setManagementMode('manage'); setConfirmDelete(false) } }}><Pencil size={16} aria-hidden="true" /><span>Manage</span><ChevronDown className="shortlist-manager__chevron" size={15} aria-hidden="true" /></button> : null}
        </div>
        {managementMode ? <div id={managementPanelId} className="shortlist-manager__panel">
          {managementMode === 'create' ? <form className="shortlist-manager__form" onSubmit={async event => { event.preventDefault(); if (await management.createList(newLabel)) closeManagement('create', true) }}>
            <label><span>New customer list</span><input value={newLabel} onChange={event => setNewLabel(event.target.value)} maxLength={80} placeholder="Initials or nickname" /></label>
            <p>Use initials or a nickname only. No contact information.</p>
            <div className="shortlist-manager__actions"><button type="submit" disabled={writesBlocked || !newLabel.trim()}><Plus size={16} aria-hidden="true" />Create</button><button type="button" onClick={() => closeManagement('create', true)}>Cancel</button></div>
          </form> : management.activeListId ? <form className="shortlist-manager__form" onSubmit={async event => { event.preventDefault(); if (await management.renameActiveList(renameLabel)) closeManagement('manage') }}>
            <label><span>Customer list name</span><input value={renameLabel} onChange={event => setRenameLabel(event.target.value)} maxLength={80} /></label>
            <p>Use initials or a nickname only. No contact information.</p>
            <div className="shortlist-manager__actions"><button type="submit" disabled={writesBlocked || !renameLabel.trim()}>Save name</button>{confirmDelete ? <><button type="button" className="is-danger" disabled={writesBlocked} onClick={() => { void management.deleteActiveList(); setConfirmDelete(false) }}>Confirm delete</button><button type="button" onClick={() => setConfirmDelete(false)}>Cancel delete</button></> : <button type="button" className="is-danger" disabled={writesBlocked} onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true" />Delete list</button>}</div>
          </form> : null}
        </div> : null}
        {management.error ? <div className="shortlist-manager__error" role="alert"><span>{management.error}</span><button type="button" onClick={management.retry}><RotateCw size={16} aria-hidden="true" />Retry</button></div> : null}
      </div> : null}
      <div className="shortlist-drawer__intro">
        {management && selectedVehicles.length ? <button ref={sheetButtonRef} type="button" onClick={() => setSheetSnapshot({ listId: management.activeListId, label: management.activeLabel, vehicles: [...selectedVehicles] })}><FileText size={16} aria-hidden="true" />Customer sheet ({selectedVehicles.length})</button> : null}
        <p>{management ? <><span className="shortlist-manager__status" role="status">{management.saving ? 'Saving…' : management.pendingAction ? 'Needs retry' : management.loading ? 'Syncing…' : management.lastConfirmedAt ? 'Synced' : 'Not synced'}</span><span aria-hidden="true"> · </span></> : null}Confirm availability with the home store.</p>
      </div>
      {entries.length ? <ul className="shortlist-drawer__vehicles">
        {entries.map(entry => { const currentVehicle = entry.available === false ? undefined : vehiclesByVin.get(entry.vin); const standouts = currentVehicle ? [...new Set([currentVehicle.engine, ...standoutEquipment(currentVehicle, 2).map(item => item.label)].filter((item): item is string => Boolean(item)))].slice(0, 2) : []
          const displayName = currentVehicle?.vehicleName || [entry.displayName, currentVehicle?.trim].filter(Boolean).join(' ')
          return <li key={entry.id} aria-label={`${displayName} saved vehicle`} className={`shortlist-drawer__vehicle${entry.available === false ? ' is-unavailable' : ''}`}>
          <div className="shortlist-drawer__vehicle-summary">
            <span className="shortlist-drawer__photo">{entry.imageUrl ? <img src={entry.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <CarFront size={28} aria-hidden="true" />}</span>
            <div className="shortlist-drawer__details"><strong>{displayName}</strong>{entry.available === false ? <span>Unavailable in current access</span> : <><span>Stock {entry.stockNumber}</span><b>{formatMoney(currentVehicle ? currentVehicle.price ?? null : entry.price)}{currentVehicle?.mileage != null ? <span className="shortlist-drawer__mileage">{formatNumber(currentVehicle.mileage)} mi</span> : null}</b>{standouts.length ? <span className="shortlist-drawer__standouts">{standouts.join(' · ')}</span> : entry.exteriorColor ? <span className="shortlist-drawer__standouts">{entry.exteriorColor}</span> : null}</>}</div>
          </div>
          <div className="shortlist-drawer__vehicle-actions"><button type="button" className="shortlist-drawer__open-action" aria-label={entry.available === false ? `Saved vehicle ${entry.vin} is unavailable in current access` : `Open shortlisted ${displayName}, stock ${entry.stockNumber}`} disabled={entry.available === false} onClick={event => onSelectVehicle?.({ id: entry.id }, event.currentTarget)}>Open</button><button type="button" className="shortlist-drawer__remove" disabled={writesBlocked} aria-label={`Remove ${entry.available === false ? entry.vin : entry.stockNumber} from list`} onClick={() => onRemove(entry.id)}><X size={16} aria-hidden="true" />Remove</button></div>
        </li>})}
      </ul> : <p className="shortlist-drawer__empty">Choose a list or create one, then use Save on a vehicle.</p>}
      </div>
    </section> : null
  return <>
    <section className="shortlist-drawer" aria-label="Customer shortlist launcher">
      <button ref={toggleRef} type="button" className="shortlist-drawer__toggle" aria-label={`${management?.activeLabel ?? 'Shortlist'} ${entries.length}`} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(true)}>
        <Heart size={18} aria-hidden="true" /><span>{management?.activeLabel ?? 'Shortlist'}</span><strong>{entries.length}</strong><ChevronUp size={18} aria-hidden="true" />
      </button>
    </section>
    {dialog && typeof document !== 'undefined' ? createPortal(dialog, document.body) : null}
    {sheetSnapshot && !management?.accessRevoked ? <TakeHomeSheet vehicles={sheetSnapshot.vehicles} listLabel={sheetSnapshot.label} onClose={() => setSheetSnapshot(null)} returnFocusRef={sheetButtonRef} /> : null}
  </>
}
