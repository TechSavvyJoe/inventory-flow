import { useState } from 'react'
import { ArrowRight, History } from 'lucide-react'
import { formatDateTime } from '../../lib/format'
import type { PlatformAudit, PlatformAuditDetail, PlatformRequest } from './types'
import { PlatformDialog } from './PlatformChangeDialog'
import { useGroupResource } from './useGroupResource'

function AuditDetail({event,request,close}:{event:PlatformAudit;request:PlatformRequest;close:()=>void}) {
 const {data,error,retry}=useGroupResource<PlatformAuditDetail>(`/audit/${event.id}`,request,0)
 const value=(item:string|boolean|null)=>item===null?'Not set':typeof item==='boolean'?item?'Enabled':'Disabled':item
 return <PlatformDialog title="Review administrative change" close={close}><div className="platform-audit-detail"><p><strong>{event.actor}</strong> · {formatDateTime(event.occurredAt)}</p><p>{event.reason}</p>{error?<p role="alert">{error} <button onClick={retry}>Retry audit detail</button></p>:!data?<p role="status">Loading recorded changes…</p>:<><dl className="platform-facts"><div><dt>Record</dt><dd>{event.entity}</dd></div><div><dt>Action</dt><dd>{event.action}</dd></div></dl>{data.changes.map(change=><div className="platform-change-row" key={change.field}><strong>{change.field.replace(/([A-Z])/g,' $1')}</strong><span>{value(change.before)}</span><ArrowRight aria-label="changed to"/><span>{value(change.after)}</span></div>)}{!data.changes.length&&<p>No displayable field changes.</p>}</>}</div></PlatformDialog>
}
export function PlatformAuditHistory({events,request,compact=false,onViewAll}:{events:PlatformAudit[];request:PlatformRequest;compact?:boolean;onViewAll?:()=>void}) {
 const [search,setSearch]=useState(''),[entity,setEntity]=useState('all'),[selected,setSelected]=useState<PlatformAudit|null>(null)
 const visible=events.filter(event=>(entity==='all'||event.entity===entity)&&`${event.reason} ${event.actor} ${event.action} ${event.entity}`.toLowerCase().includes(search.toLowerCase())).slice(0,compact?3:50)
 return <section className="platform-audit-section"><div className="platform-panel-heading"><h2><History aria-hidden="true"/>{compact?'Recent changes':'Audit history'}</h2>{compact&&<button onClick={onViewAll}>View all history<ArrowRight aria-hidden="true"/></button>}</div>
 {!compact&&<><p className="platform-help">Latest 50 account, source and software-owner changes. Employee history is available within its group.</p><div className="platform-toolbar platform-spaced"><input aria-label="Find an audit change" placeholder="Actor, reason or action" value={search} onChange={event=>setSearch(event.target.value)}/><select aria-label="Audit record type" value={entity} onChange={event=>setEntity(event.target.value)}><option value="all">All record types</option>{['groups','dealerships','owners','connections','pulls'].map(value=><option key={value}>{value}</option>)}</select></div></>}
 {visible.map(event=><article className="platform-record" key={event.id}><span className="platform-audit-marker"><History aria-hidden="true"/></span><div><strong>{event.reason}</strong><small>{event.actor} · {event.entity} {event.action} · {formatDateTime(event.occurredAt)}</small></div><button onClick={()=>setSelected(event)} aria-label={`Review change: ${event.reason}`}>Review change</button></article>)}
 {!visible.length&&<p className="platform-empty-copy">{events.length?'No matching changes.':'No administrative changes recorded yet.'}</p>}
 {selected&&<AuditDetail event={selected} request={request} close={()=>setSelected(null)}/>}
 </section>
}
