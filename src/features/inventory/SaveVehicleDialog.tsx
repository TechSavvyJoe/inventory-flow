import { useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Heart, X } from 'lucide-react'
import { savedListLabelError } from '../../lib/saved-lists-api'
import { useContainedFocus } from '../../lib/useContainedFocus'
import { useModalBackgroundIsolation } from '../../lib/useModalBackgroundIsolation'
import type { ShortlistManagement } from './useCustomerShortlist'
import './SaveVehicleDialog.css'

/** Naming happens before the first write, including legacy generic lists. */
export function SaveVehicleDialog({ management }: { management: ShortlistManagement }) {
  const id = useId()
  const container = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const opener = useRef(document.activeElement as HTMLElement | null)
  const background = useRef(document.activeElement?.closest<HTMLElement>('[role="dialog"]') ?? document.getElementById('root'))
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [validation, setValidation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pending = management.pendingSave
  const existingLists = management.lists.filter(list => list.label !== 'Customer shortlist' && list.id !== pending?.namingListId)
  const busy = submitting || management.saving
  const close = () => { if (!busy) management.cancelPendingSave?.() }
  useContainedFocus({ active: true, contain: true, containerRef: container, initialFocusRef: input, returnFocusRef: opener, onEscape: close })
  useModalBackgroundIsolation({ active: true, backgroundRef: background })
  if (!pending) return null

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || management.pendingAction || !management.readyForWrites) return
    if (!selectedId) {
      const error = savedListLabelError(name)
      if (error) { setValidation(error); input.current?.focus(); return }
    }
    setValidation(''); setSubmitting(true)
    try {
      if (selectedId) await management.savePendingToExistingList?.(selectedId)
      else await management.savePendingToNamedList?.(name)
    } finally { setSubmitting(false) }
  }

  return createPortal(<div className="save-vehicle-overlay">
    <section ref={container} className="save-vehicle-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
      <header><div><h2 id={`${id}-title`}><Heart size={20} aria-hidden="true" />{pending.namingExistingList ? 'Name this customer list' : 'Save to a customer list'}</h2>
        <p>{pending.displayName} · #{pending.stockNumber}</p></div>
        <button type="button" aria-label="Close save vehicle" onClick={close} disabled={busy}><X size={20} aria-hidden="true" /></button></header>
      <form onSubmit={event => void save(event)}>
        <label htmlFor={`${id}-name`}>List name<input ref={input} id={`${id}-name`} value={name} autoComplete="off" maxLength={80}
          placeholder="e.g. AB · SUV options" disabled={busy || Boolean(selectedId) || management.pendingAction}
          onChange={event => { setName(event.target.value); setValidation('') }} aria-describedby={`${id}-help`} /></label>
        <p id={`${id}-help`}>Use customer initials or a nickname. You can change the name later.</p>
        {existingLists.length ? <label htmlFor={`${id}-existing`}>Or use an existing list<select id={`${id}-existing`} value={selectedId} disabled={busy || management.pendingAction}
          onChange={event => { setSelectedId(event.target.value); setValidation('') }}>
          <option value="">{pending.namingExistingList ? 'Name the current list' : 'Create a named list'}</option>
          {existingLists.map(list => <option key={list.id} value={list.id}>{list.label} ({list.count})</option>)}
        </select></label> : null}
        {validation || management.error ? <p role="alert" className="save-vehicle-error">{validation || management.error}</p> : null}
        {management.pendingAction ? <p role="status">The response was interrupted. Retry the original save to confirm it without creating another list.</p> : null}
        <footer><button type="button" onClick={close} disabled={busy}>Cancel</button>
          {management.pendingAction ? <button type="button" className="save-vehicle-primary" onClick={management.retry} disabled={busy}>Retry save</button> :
            <button type="submit" className="save-vehicle-primary" disabled={busy || !management.readyForWrites}>{busy ? 'Saving…' : 'Save vehicle'}</button>}
        </footer>
      </form>
    </section>
  </div>, document.body)
}
