import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Building2, Check, ChevronRight, Plus, RefreshCw, Search, ShieldCheck, Users, X } from 'lucide-react'
import { FlowBrandLockup } from '../../design-system'
import { formatDateTime } from '../../lib/format'
import type { PlatformOverview, PlatformMembers, PlatformGroup } from './types'
import './platform.css'

const ROLES = {sales:'Salesperson',manager:'Store manager',group_manager:'Group manager',coordinator:'Coordinator',porter:'Porter',driver:'Driver'}
const healthLabel:Record<string,string> = {current:'Current publication',stale:'Publication overdue',not_connected:'Not connected',no_release:'No publication',needs_review:'Review publication',unavailable:'Connection unavailable'}
type Field = {key:string;label:string;type?:'email'|'checkbox';options?:{value:string;label:string}[];readOnly?:boolean;optional?:boolean}
type Edit = {title:string;path:string;values:Record<string,string|boolean|number>;fields:Field[];help?:string}
class PlatformRequestError extends Error {constructor(message:string,readonly status:number) {super(message)}}

function ChangeForm({edit,busy,save,cancel}:{edit:Edit;busy:boolean;save:(edit:Edit,values:Record<string,string|boolean|number>,key:string)=>Promise<void>;cancel:()=>void}) {
  const [values,setValues] = useState<Record<string,string|boolean|number>>({...edit.values,reason:''})
  const retry = useRef({signature:'',key:''})
  const first = useRef<HTMLInputElement>(null)
  useEffect(()=>{first.current?.focus()},[])
  const submit = (event:FormEvent) => {
    event.preventDefault()
    const signature = JSON.stringify(values)
    if (retry.current.signature !== signature) retry.current = {signature,key:crypto.randomUUID()}
    void save(edit,values,retry.current.key)
  }
  return <form className="platform-form" aria-label={edit.title} onSubmit={submit}>
    <header><h3>{edit.title}</h3><button type="button" onClick={cancel} disabled={busy} aria-label="Cancel change"><X aria-hidden="true"/></button></header>
    {edit.help && <p>{edit.help}</p>}
    <div className="platform-fields">{edit.fields.map((field,index)=><label key={field.key}>{field.label}
      {field.options ? <select value={String(values[field.key])} disabled={busy} onChange={event=>setValues({...values,[field.key]:event.target.value})}>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : field.type === 'checkbox' ? <input type="checkbox" checked={Boolean(values[field.key])} disabled={busy} onChange={event=>setValues({...values,[field.key]:event.target.checked})}/>
        : <input ref={index===0?first:undefined} type={field.type ?? 'text'} value={String(values[field.key] ?? '')} maxLength={field.key==='website'?500:field.type==='email'?254:160} readOnly={field.readOnly} disabled={busy} required={!field.optional} onChange={event=>setValues({...values,[field.key]:event.target.value})}/>}
    </label>)}</div>
    <label>Reason for this change<input required minLength={3} maxLength={500} value={String(values.reason)} disabled={busy} onChange={event=>setValues({...values,reason:event.target.value})} placeholder="Account administration only; no customer information"/></label>
    <footer><button type="button" onClick={cancel} disabled={busy}>Cancel</button><button className="platform-primary" disabled={busy} type="submit"><Check aria-hidden="true"/>{busy?'Saving…':'Save change'}</button></footer>
  </form>
}

export default function PlatformAdminPage() {
  const [data,setData] = useState<PlatformOverview|null>(null)
  const [memberState,setMembers] = useState<PlatformMembers|null>(null)
  const [memberError,setMemberError] = useState('')
  const [memberAttempt,setMemberAttempt] = useState(0)
  const [selected,setSelected] = useState('')
  const [tab,setTab] = useState<'dealerships'|'people'|'health'>('dealerships')
  const [section,setSection] = useState<'groups'|'owners'|'audit'>('groups')
  const [search,setSearch] = useState('')
  const [edit,setEdit] = useState<Edit|null>(null)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [denied,setDenied] = useState(false)
  const epoch = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  const loadSequence = useRef(0)
  const ownerId = useRef('')
  const request = useCallback(async <T,>(path:string,body?:Record<string,string|boolean|number>,key?:string):Promise<T> => {
    const generation = epoch.current, controller = new AbortController()
    controllers.current.add(controller)
    try {
      const response = await fetch(`/api/platform${path}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key ?? ''},body:JSON.stringify(body)}:{})})
      if (generation !== epoch.current) throw new DOMException('Access changed','AbortError')
      const result = await response.json()
      if (generation !== epoch.current) throw new DOMException('Access changed','AbortError')
      if (!response.ok) {
        if ([401,403].includes(response.status)) {
          epoch.current++; controllers.current.forEach(active=>active.abort())
          setData(null);setMembers(null);setEdit(null);setSelected('');setNotice('');setDenied(true);ownerId.current=''
        }
        throw new PlatformRequestError(result.error || 'The request could not be completed.',response.status)
      }
      return result as T
    } finally {controllers.current.delete(controller)}
  },[])
  const failed = useCallback((caught:unknown) => {if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error?caught.message:'The request failed.')},[])
  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current
    try {
      const next = await request<PlatformOverview>('')
      if (sequence !== loadSequence.current) return
      const ownerChanged = Boolean(ownerId.current && ownerId.current !== next.owner.id)
      if (ownerChanged) {epoch.current++;controllers.current.forEach(controller=>controller.abort());setMembers(null);setEdit(null);setNotice('');setMemberAttempt(value=>value+1)}
      setSelected(current=>!ownerChanged && next.groups.some(item=>item.id===current) ? current : next.groups.find(item=>item.status==='active' && item.health.connected)?.id ?? next.groups[0]?.id ?? '')
      ownerId.current = next.owner.id
      setData(next);setDenied(false);setError('')
    } catch(caught) {failed(caught)} finally {if (sequence === loadSequence.current) setLoading(false)}
  },[failed,request])
  useEffect(()=>{
    void refresh()
    const timer = window.setInterval(()=>{if (document.visibilityState==='visible') void refresh()},30000)
    const refreshOnFocus = ()=>void refresh()
    window.addEventListener('focus',refreshOnFocus)
    return ()=>{clearInterval(timer);window.removeEventListener('focus',refreshOnFocus);epoch.current++;controllers.current.forEach(controller=>controller.abort())}
  },[refresh])
  const group = data?.groups.find(item=>item.id===selected)
  const visibleGroups = data?.groups.filter(item=>`${item.name} ${item.dealerships.map(dealer=>dealer.name).join(' ')}`.toLowerCase().includes(search.toLowerCase())) ?? []
  const members = memberState?.groupId===group?.id ? memberState : null
  useEffect(()=>{
    let current = true
    setMembers(null);setMemberError('')
    if (tab==='people' && group?.health.connected) void request<PlatformMembers>(`/groups/${group.id}/members`).then(next=>{if(current)setMembers(next)}).catch(caught=>{if(current && !(caught instanceof DOMException && caught.name==='AbortError')) setMemberError(caught instanceof Error?caught.message:'Employee access could not be loaded.')})
    return ()=>{current=false}
  },[group?.id,group?.health.connected,tab,request,memberAttempt])
  const save = async (form:Edit,values:Record<string,string|boolean|number>,key:string) => {
    setBusy(true);setError('');setNotice('')
    try {
      await request(form.path,values,key)
      setEdit(null);setNotice('Change saved and recorded in the audit history.')
      await refresh()
      if (form.path.endsWith('/members') && group) setMembers(await request<PlatformMembers>(`/groups/${group.id}/members`))
    } catch(caught) {failed(caught)} finally {setBusy(false)}
  }
  const begin = (form:Edit) => {if (busy) return;setError('');setNotice('');setEdit(form)}
  const groupEdit = (item?:PlatformGroup):Edit => ({title:item?'Edit group':'Add dealership group',path:'/groups',values:{...(item?{id:item.id}:{}),name:item?.name??'',status:item?.status??'setup',expectedRevision:data!.revision},fields:[{key:'name',label:'Group name'},{key:'status',label:'Account state',options:(item?['setup','active','suspended']:['setup']).map(value=>({value,label:{setup:'Setup',active:'Active',suspended:'Suspended'}[value]!}))}],help:'Suspension blocks employee access and publishing on deployments connected to the tenant gate. It does not stop source collectors or Windows tasks.'})

  return <div className="platform-app">
    <header className="platform-header"><FlowBrandLockup/><span><ShieldCheck aria-hidden="true"/>Software admin</span><span>{data?.owner.name ?? 'Owner access'}</span></header>
    <main>
      <header className="platform-heading"><div><h1>Software administration</h1><p>Dealership accounts, employee access and publication health.</p></div><button onClick={()=>void refresh()} disabled={busy}><RefreshCw aria-hidden="true"/>Refresh</button></header>
      <p className="platform-demo">{data?.demo || import.meta.env.DEV?'Synthetic demo · no dealership data or real access is changed.':'Owner controls · dealership data remains in its isolated account.'}</p>
      {error && <p role="alert" className="platform-error">{error}</p>}
      {notice && <p role="status" className="platform-notice">{notice}</p>}
      {loading && !data && <p role="status">Checking software-owner access…</p>}
      {!loading && !data && <section className="platform-empty"><ShieldCheck aria-hidden="true"/><h2>{denied?'Software-owner access required':'Administration unavailable'}</h2><p>{denied?'Dealership and group-manager roles do not grant software administration. Your owner account must be enabled in the separate control-plane database.':'Check the owner service configuration, then refresh.'}</p></section>}
      {data && <>
        <section className="platform-summary" aria-label="Platform summary">
          <div><Building2 aria-hidden="true"/><strong>{data.groups.length}</strong><span>Dealer groups</span></div>
          <div><strong>{data.groups.reduce((n,item)=>n+item.dealerships.length,0)}</strong><span>Dealerships</span></div>
          <div><strong>{data.groups.filter(item=>item.status==='active').length}</strong><span>Active groups</span></div>
          <div><strong>{data.groups.filter(item=>item.status==='active' && item.health.status!=='current').length}</strong><span>Need review</span></div>
        </section>
        <nav className="platform-sections" aria-label="Software administration sections">{(['groups','owners','audit'] as const).map(value=><button key={value} disabled={busy} aria-pressed={section===value} onClick={()=>{setSection(value);setEdit(null)}}>{{groups:'Dealer groups',owners:'Software owners',audit:'Audit history'}[value]}</button>)}</nav>
        {edit && <ChangeForm key={`${edit.path}:${edit.values.id??'new'}`} edit={edit} busy={busy} save={save} cancel={()=>setEdit(null)}/>}
        {section==='groups' && <>
          <div className="platform-toolbar"><label><Search aria-hidden="true"/><input aria-label="Find a group or dealership" placeholder="Find a group or dealership" value={search} onChange={event=>setSearch(event.target.value)}/></label><button className="platform-primary" onClick={()=>begin(groupEdit())}><Plus aria-hidden="true"/>Add group</button></div>
          <label className="platform-mobile-group-picker">Dealer group<select value={visibleGroups.some(item=>item.id===selected)?selected:''} disabled={busy || !visibleGroups.length} onChange={event=>{setSelected(event.target.value);setEdit(null);setError('')}}><option value="" disabled>{visibleGroups.length?'Select a matching group':'No matching groups'}</option>{visibleGroups.map(item=><option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>
          <div className="platform-workspace">
            <section className="platform-group-list" aria-label="Dealer groups">
              {visibleGroups.map(item=><button className="platform-group-row" key={item.id} disabled={busy} aria-pressed={selected===item.id} onClick={()=>{setSelected(item.id);setEdit(null);setError('')}}><span><strong>{item.name}</strong><small>{item.dealerships.length} dealerships · {item.health.activeEmployees ?? '—'} active employees</small><small className={`platform-health platform-health--${item.health.status}`}>{healthLabel[item.health.status] ?? item.health.status}</small></span><span className={`platform-status platform-status--${item.status}`}>{item.status}</span><ChevronRight aria-hidden="true"/></button>)}
              {!data.groups.length && <p>Add your first dealership group to begin setup.</p>}
              {!!data.groups.length && !visibleGroups.length && <p>No matching groups or dealerships.</p>}
            </section>
            {group ? <section className="platform-detail" aria-label={`${group.name} account`}>
              <header><div><h2>{group.name}</h2><small>Group ID: {group.id}</small></div><button onClick={()=>begin(groupEdit(group))}>Edit group</button></header>
              <nav aria-label="Group sections">{(['dealerships','people','health'] as const).map(value=><button key={value} disabled={busy} aria-pressed={tab===value} onClick={()=>{setTab(value);setEdit(null);setError('')}}>{{dealerships:'Dealerships',people:'People & access',health:'Connection health'}[value]}</button>)}</nav>
              {tab==='dealerships' && <>
                <div className="platform-panel-heading"><h3>Dealerships</h3><button onClick={()=>begin({title:'Add dealership',path:'/dealerships',values:{groupId:group.id,name:'',storeKey:'',website:'',enabled:true,expectedRevision:data.revision},fields:[{key:'name',label:'Dealership name'},{key:'storeKey',label:'Deployment store key'},{key:'website',label:'Public website',optional:true},{key:'enabled',label:'Allow employee assignments',type:'checkbox'}],help:'Use the exact store key configured by this group’s inventory deployment. This record does not install a collector or configure a source system.'})}><Plus aria-hidden="true"/>Add dealership</button></div>
                {group.dealerships.map(dealer=><article className="platform-record" key={dealer.id}><div><strong>{dealer.name}</strong><small>Store key: {dealer.storeKey} · {dealer.enabled?'Assignments enabled':'Assignments disabled'}</small>{dealer.website && <a href={dealer.website} target="_blank" rel="noreferrer">Public website</a>}</div><button onClick={()=>begin({title:'Edit dealership',path:'/dealerships',values:{...dealer,expectedRevision:data.revision},fields:[{key:'name',label:'Dealership name'},{key:'storeKey',label:'Deployment store key',readOnly:true},{key:'website',label:'Public website',optional:true},{key:'enabled',label:'Allow employee assignments',type:'checkbox'}]})}>Edit</button></article>)}
                {!group.dealerships.length && <p className="platform-empty-copy">No dealerships yet. Add the account’s store records before assigning employees.</p>}
              </>}
              {tab==='people' && <>
                <div className="platform-panel-heading"><h3><Users aria-hidden="true"/>People & access</h3>{members && <button onClick={()=>begin({title:'Add employee',path:`/groups/${group.id}/members`,values:{email:'',name:'',role:'sales',homeStore:group.dealerships.find(dealer=>dealer.enabled)?.storeKey??'',enabled:true,expectedRevision:members.revision},fields:[{key:'name',label:'Employee name'},{key:'email',label:'Sign-in email',type:'email'},{key:'role',label:'Employee role',options:Object.entries(ROLES).map(([value,label])=>({value,label}))},{key:'homeStore',label:'Home dealership',options:group.dealerships.filter(dealer=>dealer.enabled).map(dealer=>({value:dealer.storeKey,label:dealer.name}))},{key:'enabled',label:'App access enabled',type:'checkbox'}],help:'The employee must also be admitted by the deployment’s sign-in policy. Saving does not send an invitation or alter Cloudflare Access.'})}><Plus aria-hidden="true"/>Add employee</button>}</div>
                {!group.health.connected && <p className="platform-empty-copy">Connect and verify this group’s isolated database before managing employees.</p>}
                {group.health.connected && !members && (memberError ? <p role="alert">{memberError} <button onClick={()=>setMemberAttempt(value=>value+1)}>Retry employee access</button></p> : <p role="status">Loading employee access…</p>)}
                {members?.members.map(member=><article className="platform-record" key={member.id}><div><strong>{member.name}</strong><small>{member.email}</small><small>{ROLES[member.role as keyof typeof ROLES] ?? member.role} · {member.homeStore} · {member.enabled?'Enabled':'Disabled'}</small></div><button onClick={()=>begin({title:'Edit employee',path:`/groups/${group.id}/members`,values:{...member,expectedRevision:members.revision},fields:[{key:'name',label:'Employee name'},{key:'email',label:'Sign-in email',type:'email',readOnly:true},{key:'role',label:'Employee role',options:Object.entries(ROLES).map(([value,label])=>({value,label}))},{key:'homeStore',label:'Home dealership',options:group.dealerships.filter(dealer=>dealer.enabled || dealer.storeKey===member.homeStore).map(dealer=>({value:dealer.storeKey,label:dealer.name}))},{key:'enabled',label:'App access enabled',type:'checkbox'}]})}>Edit</button></article>)}
                {!!members?.audit.length && <details><summary>Employee access history</summary>{members.audit.map(event=><article className="platform-audit-row" key={event.id}><strong>{event.targetName} · {event.action}</strong><p>{event.reason}</p><small>{event.actor} · {formatDateTime(event.occurredAt)}</small></article>)}</details>}
              </>}
              {tab==='health' && <><h3 className="platform-health-heading">{healthLabel[group.health.status] ?? group.health.status}</h3><p>{group.health.message}</p><dl className="platform-facts"><div><dt>Account state</dt><dd>{group.status}</dd></div><div><dt>Verified database identity</dt><dd>{group.health.connected?'Matches this group':'Not verified'}</dd></div><div><dt>Stored release date</dt><dd>{group.health.reportDate ?? 'None'}</dd></div><div><dt>Last publication</dt><dd>{group.health.publishedAt?formatDateTime(group.health.publishedAt):'None'}</dd></div><div><dt>Employees enabled / total</dt><dd>{group.health.activeEmployees??'—'} / {group.health.employees??'—'}</dd></div><div><dt>Active group managers</dt><dd>{group.health.groupManagers??'—'}</dd></div></dl><p className="platform-help">This is database publication health. Browser sign-ins, backup recovery, source collectors and deploy credentials require separate checks. No secrets or customer records are shown here.</p></>}
            </section> : <section className="platform-empty"><Building2 aria-hidden="true"/><h2>Select a dealership group</h2><p>Review stores, manage employee access and check its latest stored publication.</p></section>}
          </div>
        </>}
        {section==='owners' && <section><div className="platform-panel-heading"><div><h2>Software owners</h2><p>These accounts administer every connected group. Dealership managers cannot grant this role.</p></div><button className="platform-primary" onClick={()=>begin({title:'Add software owner',path:'/owners',values:{name:'',email:'',enabled:true,expectedRevision:data.revision},fields:[{key:'name',label:'Owner name'},{key:'email',label:'Sign-in email',type:'email'},{key:'enabled',label:'Software-owner access enabled',type:'checkbox'}]})}><Plus aria-hidden="true"/>Add owner</button></div>{data.owners.map(owner=><article className="platform-record" key={owner.id}><div><strong>{owner.name}{owner.id===data.owner.id?' · You':''}</strong><small>{owner.email} · {owner.enabled?'Enabled':'Disabled'}</small></div><button onClick={()=>begin({title:'Edit software owner',path:'/owners',values:{...owner,expectedRevision:data.revision},fields:[{key:'name',label:'Owner name'},{key:'email',label:'Sign-in email',type:'email',readOnly:true},{key:'enabled',label:'Software-owner access enabled',type:'checkbox'}],help:'Another owner must disable your own account. The final enabled software owner is protected.'})}>Edit</button></article>)}</section>}
        {section==='audit' && <section><h2>Platform audit history</h2><p>Latest 50 group, dealership and software-owner changes. Employee access changes stay in each group’s People & access history.</p>{data.audit.map(event=><article className="platform-audit-row" key={event.id}><strong>{event.entity} · {event.action}</strong><p>{event.reason}</p><small>{event.actor} · {formatDateTime(event.occurredAt)} · Record {event.targetId}</small></article>)}{!data.audit.length && <p>No platform changes recorded yet.</p>}</section>}
        <footer className="platform-footer">Checked {formatDateTime(data.generatedAt)} · Accounts only; customer evidence stays in the dealership application.</footer>
      </>}
    </main>
  </div>
}
