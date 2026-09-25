import { useEffect, useRef, useState, type RefObject } from 'react'
import { createVehicleIssue } from '../../lib/api'
import { apiAccessGeneration } from '../../lib/apiSession'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import type { VehicleIssueCategory, VehicleIssueDetail } from '../../types'
import type { InventoryVehicle } from '../inventory/types'
import { vehicleDisplayName } from '../inventory/inventory-utils'
import { IssueDialog } from './IssueDialog'
import { IssuePhotoPicker, type DraftIssuePhoto } from './IssuePhotos'
import { ISSUE_CATEGORIES, type VehicleIssueContext } from './issue-model'

export function IssueReportDialog({ vehicle, context, onSaved, onClose, returnFocusRef }: {
  vehicle: InventoryVehicle; context: VehicleIssueContext; onSaved: (issue: VehicleIssueDetail) => void
  onClose: () => void; returnFocusRef: RefObject<HTMLElement | null>
}) {
  const [category, setCategory] = useState<VehicleIssueCategory>('cleaning')
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal')
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<DraftIssuePhoto[]>([])
  const [preparing, setPreparing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submitted = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const { markSaved } = useUnsavedChanges(Boolean(description.trim() || photos.length || category !== 'cleaning' || priority !== 'normal'), { saving: saving || preparing })
  async function submit() {
    if (submitted.current || preparing || !description.trim()) return
    submitted.current = true; setSaving(true); setError('')
    const accessGeneration = apiAccessGeneration()
    try {
      const issue = await createVehicleIssue(vehicle.vin, { category, priority, description: description.trim(), ...(photos.length ? { photos: photos.map(({ data }) => ({ data })) } : {}) }, context.role, context.homeStore)
      if (!alive.current || accessGeneration !== apiAccessGeneration()) return
      markSaved(); onSaved(issue)
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'The issue could not be saved. Your report is still here; try again.') }
    finally { submitted.current = false; if (alive.current) setSaving(false) }
  }
  return <IssueDialog title="Report a vehicle issue" onClose={onClose} returnFocusRef={returnFocusRef}>
    <p className="vehicle-issue-identity"><strong>{vehicleDisplayName(vehicle)}</strong><span>Stock {vehicle.stockNumber} · {context.homeStore}</span></p>
    <form className="vehicle-issue-form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="vehicle-issue-form__pair"><label>Category<select value={category} disabled={saving} onChange={event => setCategory(event.target.value as VehicleIssueCategory)}>{Object.entries(ISSUE_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Priority<select value={priority} disabled={saving} onChange={event => setPriority(event.target.value as 'normal' | 'urgent')}><option value="normal">Normal</option><option value="urgent">Urgent</option></select></label></div>
      <label>What needs attention?<textarea rows={3} required maxLength={1000} value={description} disabled={saving} onChange={event => setDescription(event.target.value)} placeholder="Describe the issue and where to find it." /></label>
      <p className="vehicle-issue-muted">Keep customer information out of notes and photos. This report does not change the vehicle’s hold or service status.</p>
      <IssuePhotoPicker photos={photos} onChange={setPhotos} disabled={saving} onPreparing={setPreparing} />
      {error ? <p role="alert" className="vehicle-issue-error">{error}</p> : null}
      <div className="vehicle-issue-form__actions"><button type="submit" className="vehicle-issue-primary" disabled={saving || preparing || !description.trim()}>{saving ? 'Saving issue…' : 'Report issue'}</button></div>
    </form>
  </IssueDialog>
}
