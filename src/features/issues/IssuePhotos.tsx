import { useEffect, useRef, useState } from 'react'
import { getVehicleIssuePhoto } from '../../lib/api'
import type { StoreName, UserRole, VehicleIssuePhoto } from '../../types'
import { prepareIssuePhoto } from './issue-photo'

export interface DraftIssuePhoto { data: string; name: string }

export function IssuePhotoPicker({ photos, onChange, disabled, remaining = 3, onPreparing }: {
  photos: DraftIssuePhoto[]; onChange: (photos: DraftIssuePhoto[]) => void; disabled?: boolean; remaining?: number; onPreparing: (preparing: boolean) => void
}) {
  const [error, setError] = useState('')
  const [preparing, setPreparing] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const limit = Math.min(3, remaining)
  async function select(files: FileList | null) {
    if (!files?.length) return
    if (files.length + photos.length > limit) { setError(`Choose up to ${limit} photos for this update.`); return }
    setPreparing(true); onPreparing(true); setError('')
    const prepared: DraftIssuePhoto[] = []
    const failures: string[] = []
    for (const file of Array.from(files)) {
      try { prepared.push({ ...await prepareIssuePhoto(file), name: file.name }) }
      catch (caught) { failures.push(caught instanceof Error ? caught.message : 'This photo could not be prepared.') }
    }
    if (!alive.current) return
    onChange([...photos, ...prepared]); setError(failures.join(' ')); setPreparing(false); onPreparing(false)
  }
  return <div className="vehicle-issue-photo-picker">
    {limit > 0 ? <label>Photos <span className="vehicle-issue-muted">Optional · up to {limit}</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || preparing || photos.length >= limit} onChange={event => { void select(event.currentTarget.files); event.currentTarget.value = '' }} /></label> : <p className="vehicle-issue-muted">This issue already has 12 photos. You can still add a written update.</p>}
    {preparing ? <p role="status">Preparing photos…</p> : null}
    {photos.length ? <ul className="vehicle-issue-photos">{photos.map((photo, index) => <li key={`${photo.name}-${index}`}><img src={`data:image/jpeg;base64,${photo.data}`} alt={`Selected issue photo ${index + 1}`} /><button type="button" disabled={disabled || preparing} onClick={() => onChange(photos.filter((_, item) => item !== index))}>Remove photo {index + 1}</button></li>)}</ul> : null}
    {error ? <p role="alert" className="vehicle-issue-error">{error}</p> : null}
  </div>
}

function IssuePhoto({ issueId, photo, role, store }: { issueId: string; photo: VehicleIssuePhoto; role: UserRole; store: StoreName }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    setUrl(''); setError('')
    void getVehicleIssuePhoto(issueId, photo.id, role, store, controller.signal).then(blob => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl)
    }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Photo could not load.') })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [issueId, photo.id, role, store, retry])
  return <li>{url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Vehicle issue evidence" onError={() => { setUrl(''); setError('This photo could not be displayed. Try loading it again.') }} /><span>Open photo</span></a> : error ? <><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry photo</button></> : <span role="status">Loading photo…</span>}</li>
}

export function IssuePhotos({ issueId, photos, role, store }: { issueId: string; photos: VehicleIssuePhoto[]; role: UserRole; store: StoreName }) {
  const [expanded, setExpanded] = useState(false)
  return photos.length ? <details className="vehicle-issue-photo-evidence" onToggle={event => setExpanded(event.currentTarget.open)}><summary>Photos ({photos.length})</summary>{expanded ? <ul className="vehicle-issue-photos">{photos.map(photo => <IssuePhoto key={`${role}:${store}:${issueId}:${photo.id}`} issueId={issueId} photo={photo} role={role} store={store} />)}</ul> : null}</details> : null
}
