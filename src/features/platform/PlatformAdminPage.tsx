import { useEffect, useState } from 'react'
import { Activity, Building2, ChevronRight, CircleAlert, Filter, History, LayoutDashboard, Plus, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react'
import { FlowBrandLockup } from '../../design-system'
import { formatDateTime } from '../../lib/format'
import type { PlatformGroup } from './types'
import { HEALTH_LABEL, groupEdit } from './platformPresentation'
import { PlatformAccountSummary } from './PlatformAccountSummary'
import { PlatformAuditHistory } from './PlatformAuditHistory'
import { PlatformChangeDialog } from './PlatformChangeDialog'
import { PlatformGroupDetail } from './PlatformGroupDetail'
import { PlatformOwnerDirectory } from './PlatformOwnerDirectory'
import { usePlatformAdmin } from './usePlatformAdmin'
import './platform.css'

const SECTIONS={overview:{label:'Overview',icon:LayoutDashboard},groups:{label:'Dealer groups',icon:Building2},owners:{label:'Software owners',icon:ShieldCheck},audit:{label:'Audit history',icon:History}}
type Section=keyof typeof SECTIONS
const TITLES={overview:'Platform overview',groups:'Dealer groups',owners:'Software owners',audit:'Audit history'}
function GroupDirectory({groups,selected,busy,choose}:{groups:PlatformGroup[];selected:string;busy:boolean;choose:(id:string)=>void}) {
 return <div className="platform-directory"><div className="platform-directory-head"><span>Dealer group</span><span>Account</span><span>Stores</span><span>People</span><span>Publication</span></div>{groups.map(group=><button className="platform-directory-row" key={group.id} disabled={busy} aria-pressed={selected===group.id} onClick={()=>choose(group.id)}><span><strong>{group.name}</strong><small>{group.dealerships.map(dealer=>dealer.name).join(' · ')||'Setup in progress'}</small></span><span className={`platform-status platform-status--${group.status}`}>{group.status}</span><span>{group.dealerships.length}</span><span>{group.health.activeEmployees??'—'}</span><span className={`platform-health--${group.health.status}`}>{HEALTH_LABEL[group.health.status]}<ChevronRight aria-hidden="true"/></span></button>)}{!groups.length&&<p className="platform-empty-copy">No groups match these filters.</p>}</div>
}
export default function PlatformAdminPage() {
 const admin=usePlatformAdmin(),{data,selected,setSelected,edit,busy,begin,request}=admin
 const [accountTab,setAccountTab]=useState<'dealerships'|'people'|'connections'|'health'>('dealerships')
 const [filtersOpen,setFiltersOpen]=useState(false)
 const [section,setSection]=useState<Section>('overview'),[search,setSearch]=useState(''),[state,setState]=useState('all'),[health,setHealth]=useState('all')
 const groups=data?.groups.filter(item=>`${item.name} ${item.dealerships.map(dealer=>dealer.name).join(' ')}`.toLowerCase().includes(search.toLowerCase())&&(state==='all'||item.status===state)&&(health==='all'||(health==='review'?item.status==='active'&&item.health.status!=='current':health===item.health.status)))??[]
 const visibleKey=groups.map(group=>group.id).join(',')
 useEffect(()=>{if(data&&!groups.some(group=>group.id===selected))setSelected(groups[0]?.id??'')},[data,visibleKey,selected,setSelected])
 const group=groups.find(item=>item.id===selected)
 const navigate=(next:Section)=>{if(!busy){setSection(next);admin.closeEdit()}}
 const choose=(id:string)=>{setSelected(id);admin.closeEdit()}
 const openAccount=(tab:typeof accountTab)=>{setAccountTab(tab);navigate('groups');if(window.innerWidth<760)window.requestAnimationFrame(()=>document.querySelector('.platform-detail')?.scrollIntoView?.({block:'start'}))}
 return <div className="platform-app">
 <a className="platform-skip" href="#platform-content">Skip to administration</a>
 <aside className="platform-rail"><FlowBrandLockup reversed tenantLabel="Platform"/><nav aria-label="Software administration sections">{Object.entries(SECTIONS).map(([key,item])=><button key={key} disabled={busy} aria-pressed={section===key} onClick={()=>navigate(key as Section)}><item.icon aria-hidden="true"/>{item.label}</button>)}</nav><div className="platform-rail-foot"><ShieldCheck aria-hidden="true"/><span>Owner workspace<small>Isolated dealership accounts</small></span></div></aside>
 <div className="platform-canvas"><header className="platform-header"><span><ShieldCheck aria-hidden="true"/>Software admin <ChevronRight aria-hidden="true"/><strong>{SECTIONS[section].label}</strong></span><span className="platform-owner"><span className="platform-avatar" aria-hidden="true">{data?.owner.name.split(' ').slice(0,2).map(word=>word[0]).join('')||'IF'}</span><span>{data?.owner.name??'Owner access'}<small>{data?'Verified software owner':'Verification required'}</small></span></span></header>
 <main id="platform-content" onClickCapture={event=>{if(event.target instanceof Element)(event.target.closest('button:not([disabled])') as HTMLButtonElement|null)?.focus({preventScroll:true})}}><header className="platform-heading"><div><small className="platform-eyebrow">Inventory Flow control plane</small><h1>{TITLES[section]}</h1><p>Dealer groups, people, data connections and publication health.</p></div><div className="platform-heading-actions"><button onClick={()=>void admin.refresh()} disabled={busy}><RefreshCw aria-hidden="true"/>Refresh</button>{data&&<button className="platform-primary" disabled={busy} onClick={()=>begin(groupEdit(data.revision))}><Plus aria-hidden="true"/>Add group</button>}</div></header>
 <p className="platform-demo">{data?.demo||import.meta.env.DEV?'Synthetic demo · configuration changes affect this demo only.':'Software-owner workspace · customer evidence stays in its dealership account.'}</p>
 {admin.error&&!edit&&<p role="alert" className="platform-error">{admin.error}</p>}{admin.notice&&<p role="status" className="platform-notice">{admin.notice}</p>}
 {admin.loading&&!data&&<p role="status">Checking software-owner access…</p>}
 {!admin.loading&&!data&&<section className="platform-empty"><ShieldCheck aria-hidden="true"/><h2>{admin.denied?'Software-owner access required':'Administration unavailable'}</h2><p>{admin.denied?'Dealership and group-manager roles do not grant software administration. Your owner account must be enabled in the separate control-plane database.':'Check the owner service configuration, then refresh.'}</p></section>}
 {data&&<div key={data.owner.id}>
 {(section==='overview'||section==='groups')&&<>
 <section className="platform-summary" aria-label="Platform summary">{[{label:'Dealer groups',value:data.groups.length,icon:Building2,action:()=>navigate('groups')},{label:'Dealerships',value:data.groups.reduce((n,item)=>n+item.dealerships.length,0),icon:Building2,action:()=>navigate('groups')},{label:'Enabled employees',value:data.groups.reduce((n,item)=>n+(item.health.activeEmployees??0),0),icon:Users,action:()=>navigate('groups')},{label:'Need review',value:data.groups.filter(item=>item.status==='active'&&item.health.status!=='current').length,icon:CircleAlert,action:()=>{setHealth('review');navigate('groups')}}].map(item=><button disabled={busy} key={item.label} onClick={item.action}><span><small>{item.label}</small><strong>{item.value}</strong></span><item.icon aria-hidden="true"/></button>)}</section>
 <div className={`platform-workspace ${section==='groups'?'platform-workspace--account':''}`}><section className="platform-directory-panel"><div className="platform-panel-heading"><div><h2>Account directory</h2><p className="platform-help">{groups.length} of {data.groups.length} groups · select an account to manage</p></div><Activity aria-hidden="true"/></div><div className={`platform-toolbar ${filtersOpen?'platform-toolbar--filters-open':''}`}><label className="platform-search"><Search aria-hidden="true"/><input aria-label="Find a group or dealership" placeholder="Search groups or dealerships" value={search} onChange={event=>setSearch(event.target.value)}/></label><button className="platform-mobile-filters" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(value=>!value)}><Filter aria-hidden="true"/>Filters</button><select className="platform-account-filter" aria-label="Account state filter" value={state} onChange={event=>setState(event.target.value)}><option value="all">All accounts</option><option value="active">Active</option><option value="setup">Setup</option><option value="suspended">Suspended</option></select><select className="platform-account-filter" aria-label="Publication filter" value={health} onChange={event=>setHealth(event.target.value)}><option value="all">All publication states</option><option value="current">Current</option><option value="review">Needs review</option><option value="not_connected">Not connected</option></select></div>
 <label className="platform-mobile-group-picker">Selected dealer group<select value={group?.id??''} disabled={busy||!groups.length} onChange={event=>choose(event.target.value)}><option value="" disabled>{groups.length?'Select a group':'No matching groups'}</option>{groups.map(item=><option value={item.id} key={item.id}>{item.name} · {item.status}</option>)}</select></label>
 <GroupDirectory groups={groups} selected={selected} busy={busy} choose={choose}/>

 </section>
 {group?section==='overview'?<PlatformAccountSummary group={group} revision={data.revision} busy={busy} begin={begin} open={openAccount}/>:<PlatformGroupDetail key={`${data.owner.id}:${group.id}`} initialTab={accountTab} group={group} revision={data.revision} refreshVersion={admin.refreshVersion} request={request} busy={busy} begin={begin}/>:<section className="platform-empty"><Building2 aria-hidden="true"/><h2>No matching account</h2><p>Adjust the search or account filters to select a dealership group.</p><button onClick={()=>{setSearch('');setState('all');setHealth('all')}}>Clear filters</button></section>}
 {section==='overview'&&<PlatformAuditHistory events={data.audit} request={request} compact onViewAll={()=>navigate('audit')}/>}
 </div>
 </>}
 {section==='owners'&&<PlatformOwnerDirectory data={data} busy={busy} begin={begin}/>}
 {section==='audit'&&<PlatformAuditHistory events={data.audit} request={request}/>}
 <footer className="platform-footer">Verified {formatDateTime(data.generatedAt)} · Source credentials and customer records stay outside the control plane.</footer>
 </div>}
 </main></div>
 {data&&edit&&<PlatformChangeDialog key={`${edit.path}:${edit.values.id??'new'}`} edit={edit} busy={busy} error={admin.error} save={admin.save} cancel={admin.closeEdit} onRetryRefresh={admin.refreshFailed?admin.refresh:undefined}/>}
 </div>
}
