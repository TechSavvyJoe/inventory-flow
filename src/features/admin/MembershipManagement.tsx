import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Pencil, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { getMembershipDirectory, saveMembershipAccess } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { STORE_NAMES, type StoreName, type UserRole } from '../../types'
import type { ManagedMember, MembershipDirectory, MembershipInput } from './types'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { useWorkspaceLifetime } from '../../lib/useWorkspaceLifetime'

const ROLE_LABELS: Record<UserRole, string> = { sales: 'Salesperson', manager: 'Store manager', group_manager: 'Group manager', coordinator: 'Transport coordinator', porter: 'Porter', driver: 'Driver' }
const ASSIGNABLE_ROLES: UserRole[] = ['sales', 'manager', 'group_manager']
const ROLE_HELP: Record<UserRole, string> = {
  sales: 'Search inventory, review holds, and request vehicles.',
  manager: 'Manage service and store workflows for the assigned home store.',
  group_manager: 'Manage all stores and employee access in Control center.',
  coordinator: 'Coordinate vehicle moves and transport assignments.',
  porter: 'Carry out assigned vehicle moves and record progress.',
  driver: 'View and update assigned transport work.',
}

export function MembershipManagement({ role, store, onSaved }: { role: UserRole; store: StoreName; onSaved: () => void }) {
  return <MembershipEditor key={`${role}:${store}`} role={role} store={store} onSaved={onSaved} />
}

function MembershipEditor({ role, store, onSaved }: { role: UserRole; store: StoreName; onSaved: () => void }) {
  const [directory, setDirectory] = useState<MembershipDirectory | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState<MembershipInput | null>(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const initialDraft = useRef('')
  const captureWorkspace = useWorkspaceLifetime(`${role}:${store}`)
  const { confirmDiscard, markSaved } = useUnsavedChanges(Boolean(draft && JSON.stringify(draft) !== initialDraft.current), { saving })
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void getMembershipDirectory(role, store, controller.signal).then(value => {
      if (!controller.signal.aborted) setDirectory(value)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load employee access.') })
    return () => controller.abort()
  }, [role, store, loadAttempt])

  useEffect(() => {
    if (draft) {
      formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
      formRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    }
  }, [draft?.id, Boolean(draft)])

  function edit(member?: ManagedMember) {
    if (!directory || saving || !confirmDiscard()) return
    setError(''); setNotice('')
    const next = { ...(member ?? { email: '', name: '', role: 'sales' as const, homeStore: store, enabled: true }), reason: '', expectedRevision: directory.revision }
    initialDraft.current = JSON.stringify(next)
    setDraft(next)
  }
  function change<K extends keyof MembershipInput>(key: K, value: MembershipInput[K]) {
    setDraft(current => current ? { ...current, [key]: value } : current)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return
    const isCurrentWorkspace = captureWorkspace()
    setSaving(true); setError('')
    try {
      await saveMembershipAccess(draft, role, store)
      if (!isCurrentWorkspace()) return
      markSaved()
      setNotice(`${draft.name}'s access was saved.`)
      setDraft(null)
      setLoadAttempt(value => value + 1)
      onSaved()
    } catch (cause) {
      if (isCurrentWorkspace()) setError(cause instanceof Error ? cause.message : 'Access could not be saved.')
    } finally { if (isCurrentWorkspace()) setSaving(false) }
  }
  const filtered = directory?.members.filter(member => `${member.name} ${member.email} ${ROLE_LABELS[member.role]} ${member.homeStore}`.toLowerCase().includes(query.toLowerCase())) ?? []
  const self = draft?.id === directory?.currentUserId
  const legacyDraftRole = draft && !ASSIGNABLE_ROLES.includes(draft.role) ? draft.role : null
  return <section className="admin-section admin-section--people" id="admin-people" aria-labelledby="admin-people-title">
    <header className="admin-section__header">
      <div><h2 id="admin-people-title">People &amp; access</h2><p>Choose each employee's role, home store, and sign-in access.</p></div>
      <button className="admin-primary-button" type="button" disabled={!directory || saving} onClick={() => edit()}><Plus size={16} /> Add employee</button>
    </header>
    <div className="admin-member-toolbar">
      <label className="admin-member-search"><Search size={16} /><input aria-label="Search employees" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, email, role, or store" /></label>
      <button className="admin-secondary-button" type="button" disabled={saving} onClick={() => { if (confirmDiscard()) { setDraft(null); setLoadAttempt(value => value + 1) } }}><RefreshCw size={15} /> Reload</button>
    </div>
    {notice && <p className="admin-save-notice" role="status"><Check size={16} />{notice}</p>}
    {error && <p className="admin-save-error" role="alert">{error}</p>}
    {draft && <form className="admin-member-form" ref={formRef} onSubmit={event => void save(event)}>
      <header><h3>{draft.id ? `Edit ${directory?.members.find(member => member.id === draft.id)?.name}` : 'Add employee'}</h3><button type="button" className="admin-secondary-button" disabled={saving} aria-label="Cancel employee changes" onClick={() => { if (confirmDiscard()) setDraft(null) }}><X size={16} /> Cancel</button></header>
      <div className="admin-member-fields">
        <label>Full name<input required maxLength={160} value={draft.name} disabled={saving} onChange={event => change('name', event.target.value)} /></label>
        <label>Sign-in email<input aria-label="Sign-in email" required type="email" maxLength={254} value={draft.email} disabled={saving || Boolean(draft.id)} onChange={event => change('email', event.target.value)} />{draft.id && <small>Email stays tied to this employee's history.</small>}</label>
        <label>Role<select aria-label="Role" value={draft.role} disabled={saving || self} onChange={event => change('role', event.target.value as UserRole)}>{legacyDraftRole && <option value={legacyDraftRole} disabled>{ROLE_LABELS[legacyDraftRole]} · Legacy</option>}{ASSIGNABLE_ROLES.map(value => <option value={value} key={value}>{ROLE_LABELS[value]}</option>)}</select><small>{ROLE_HELP[draft.role]}</small></label>
        <label>Home store<select aria-label="Home store" value={draft.homeStore} disabled={saving} onChange={event => change('homeStore', event.target.value as StoreName)}>{STORE_NAMES.map(value => <option key={value}>{value}</option>)}</select><small>{draft.role === 'group_manager' ? 'Group managers can manage every store.' : 'Store permissions follow this home store.'}</small></label>
      </div>
      <fieldset className="admin-access-toggle" disabled={saving || self}><legend>Sign-in access</legend><label><input type="radio" name="member-enabled" checked={draft.enabled} onChange={() => change('enabled', true)} /> Active</label><label><input type="radio" name="member-enabled" checked={!draft.enabled} onChange={() => change('enabled', false)} /> Disabled</label></fieldset>
      {self && <p className="admin-member-help">Another group manager must change your own role or disable your access.</p>}
      <label className="admin-change-reason">Reason for change<input required minLength={3} maxLength={500} value={draft.reason} disabled={saving} placeholder="For example: promoted to Howell sales manager" onChange={event => change('reason', event.target.value)} /></label>
      <footer><p><ShieldCheck size={16} />Changes take effect on the next request and are recorded below. New employees also need approval in the site's sign-in policy before they can enter. Adding an employee does not send an invitation.</p><button className="admin-primary-button" ref={saveButtonRef} disabled={saving} type="submit">{saving ? 'Saving…' : 'Save access'}</button></footer>
    </form>}
    {!directory ? <p role="status">{error ? 'Use Reload to try again.' : 'Loading employees…'}</p> : <div className="admin-member-list">
      {filtered.map(member => <article className="admin-member-card" key={member.id}>
        <div><strong>{member.name}{member.id === directory.currentUserId && <span className="admin-you-tag">You</span>}</strong><small>{member.email}</small></div>
        <div><span>{ROLE_LABELS[member.role]}</span><small>{member.homeStore}{member.role === 'group_manager' ? ' · All stores' : ''}</small></div>
        <span className={`admin-status admin-status--${member.enabled ? 'active' : 'disabled'}`}><span />{member.enabled ? 'Active' : 'Disabled'}</span>
        <button className="admin-secondary-button" type="button" disabled={saving} aria-label={`Edit ${member.name}`} onClick={() => edit(member)}><Pencil size={15} /> Edit</button>
      </article>)}
      {!filtered.length && <p>No employees match this search.</p>}
    </div>}
    {directory && <div className="admin-access-history"><h3>Access change history</h3>{directory.audit.length ? directory.audit.map(entry => <article key={entry.id}><div><strong>{entry.targetName} · {entry.action === 'created' ? 'Added' : 'Access updated'}</strong><p>{entry.reason}</p><small>{entry.actor} · {formatDateTime(entry.occurredAt)}</small></div></article>) : <p>Access changes will appear here after the first save.</p>}</div>}
  </section>
}
