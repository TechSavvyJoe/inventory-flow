import { ArrowRight, Cable, Check, CheckCircle2, Circle, ExternalLink, Users } from 'lucide-react'
import type { PlatformEdit, PlatformGroup } from './types'
import { groupAppHref, HEALTH_LABEL, groupEdit, readiness } from './platformPresentation'
export function PlatformAccountSummary({group,revision,busy,begin,open}:{group:PlatformGroup;revision:number;busy:boolean;begin:(edit:PlatformEdit)=>void;open:(tab:'dealerships'|'people'|'connections'|'health')=>void}) {
 const appHref=groupAppHref(group)
 return <section className="platform-detail platform-account-summary" aria-label={`${group.name} account`}><header><div><small className="platform-eyebrow">Selected account</small><h2>{group.name}</h2><span className={`platform-status platform-status--${group.status}`}>{group.status}</span></div><div className="platform-detail-actions">{appHref&&<a className="platform-open-app platform-primary" href={appHref} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true"/>Open dealership app</a>}<button disabled={busy} onClick={()=>begin(groupEdit(revision,group))}>Edit group</button></div></header>
 <div className="platform-account-facts"><span><strong>{group.dealerships.length}</strong> dealerships</span><span><strong>{group.health.activeEmployees??'—'}</strong> enabled employees</span><span className={`platform-health--${group.health.status}`}><CheckCircle2 aria-hidden="true"/>{HEALTH_LABEL[group.health.status]}</span></div>
 <p className="platform-summary-dealers">{group.dealerships.map(dealer=><span key={dealer.id}>{dealer.name}</span>)}</p>
 <div className="platform-quick-actions"><button disabled={busy} onClick={()=>open('people')}><Users aria-hidden="true"/>People & access</button><button disabled={busy} onClick={()=>open('connections')}><Cable aria-hidden="true"/>Data connections</button></div>
 <section className="platform-readiness"><h3>Setup readiness</h3>{readiness(group).map(item=><div key={item.label}>{item.ready?<Check aria-hidden="true"/>:<Circle aria-hidden="true"/>}<span>{item.label}</span><small>{item.ready?'Ready':'Needed'}</small></div>)}</section>
 <button className="platform-account-open" disabled={busy} onClick={()=>open('dealerships')}>Open account workspace<ArrowRight aria-hidden="true"/></button>
 </section>
}
