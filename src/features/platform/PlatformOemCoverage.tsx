import { FlowLedgerHeading, flowButtonClassName } from '../../design-system'
import { useMemo, useState } from 'react'
import { Plus, Factory, FileCheck2 } from 'lucide-react'
import type { PlatformConnection, PlatformConnections, PlatformGroup, PlatformStoredCoverage } from './types'
import { buildOemCoverage, OEM_PROFILES, type OemFamily } from './platformSourceModel'
import './PlatformOemCoverage.css'

const EVIDENCE_FIELDS: {key:keyof PlatformStoredCoverage['counts'];label:string}[] = [
 {key:'publicRowCount',label:'Public inventory rows'}, {key:'dealerMailRowCount',label:'DealerMail source rows'},
 {key:'dealerMailVinReconciledCount',label:'DealerMail rows reconciled to VINs'}, {key:'dealerMailVinReviewCount',label:'DealerMail rows needing VIN review'},
 {key:'resourceRecordCount',label:'Vehicle resource records'}, {key:'fordInvoiceRecordCount',label:'Ford invoice records'},
 {key:'fordOasisRecordCount',label:'Ford OASIS records'}, {key:'warrantyCheckRecordCount',label:'Warranty check records'},
 {key:'warningCount',label:'Publication warnings'},
]
const countLabel = (value:unknown) => typeof value==='number' && Number.isSafeInteger(value) && value>=0 ? value.toLocaleString('en-US') : 'Not reported'

export function PlatformOemCoverage({group,data,busy,onInspect,onAdd}:{group:PlatformGroup;data:PlatformConnections;busy:boolean;onInspect:(id:string)=>void;onAdd:(oem:string,dealershipId?:string)=>void}) {
 const coverage=useMemo(()=>buildOemCoverage(group,data.groupId===group.id?data.connections:[]),[group,data])
 const [selected,setSelected]=useState<OemFamily>('ford_lincoln')
 const profile=OEM_PROFILES[selected]
 const row=coverage.find(item=>item.oem===selected)!
 const configured:PlatformConnection[]=data.groupId===group.id?data.connections.filter(item=>item.groupId===group.id&&item.oem===selected&&group.dealerships.some(dealer=>dealer.groupId===group.id&&dealer.id===item.dealershipId)):[]
 const stored=group.health.coverage?.basis==='stored_publication'?group.health.coverage:undefined
 return <section className="platform-oem-coverage" aria-label="OEM coverage">
  <section className="platform-evidence-ledger" aria-label="Stored publication coverage">
   <FlowLedgerHeading level={3} title={<><FileCheck2 size={20} aria-hidden="true" />Captured evidence</>} description={<>Group publication · {stored?.reportDate??'Report date not available'}</>} />
   <p className="platform-evidence-context">{stored?'Validated totals from the stored group publication.':'Stored coverage totals are not available for this account.'} These totals are independent of the saved connections below. Records do not establish complete field capture, current source access, vehicle availability, or warranty coverage.</p>
   {stored?.publishedAt&&<p className="platform-evidence-context">Published: <time dateTime={stored.publishedAt}>{stored.publishedAt}</time></p>}
   <dl className="platform-evidence-counts">{EVIDENCE_FIELDS.map(field=><div key={field.key}><dt>{field.label}</dt><dd>{countLabel(stored?.counts[field.key])}</dd></div>)}</dl>
   <div className="platform-evidence-stores" aria-label="Stored coverage by dealership"><h4>Dealership publication totals</h4>
    {group.dealerships.filter(dealer=>dealer.groupId===group.id).map(dealer=>{const totals=stored?.stores.find(item=>item.storeKey===dealer.storeKey);return <div className="platform-evidence-store" key={dealer.id} role="group" aria-label={`Stored coverage at ${dealer.name}`}><strong>{dealer.name}</strong><dl><div><dt>Public rows</dt><dd>{countLabel(totals?.publicCount)}</dd></div><div><dt>DealerMail rows</dt><dd>{countLabel(totals?.crmCount)}</dd></div><div><dt>App membership</dt><dd>{countLabel(totals?.activeInventoryCount)}</dd></div></dl></div>})}
    <p className="platform-evidence-context">Store totals require an exact registered store key. Missing totals remain unreported.</p>
    <p className="platform-evidence-context">App membership is derived from public and DealerMail VIN membership, excluding manager-reported deliveries. It does not indicate vehicle availability, physical location, or sale status.</p>
   </div>
  </section>
  <FlowLedgerHeading level={3} title={<><Factory size={20} aria-hidden="true" />Manufacturer source planning</>} description="Saved configurations and enabled preferences by dealership." actions={<label className="platform-oem-family">OEM family<select aria-label="OEM family" value={selected} onChange={event=>setSelected(event.target.value as OemFamily)}>{coverage.map(item=><option key={item.oem} value={item.oem}>{item.label}</option>)}</select></label>} />
  <p className="platform-oem-totals" aria-label={`${row.label} source totals`}>{row.configured} configured · {row.enabled} enabled preferences · {row.paused} paused. Source access and execution remain unverified.</p>
  <div className="platform-oem-workspace">
   <div className="platform-oem-matrix">
    {row.dealerships.map(cell=>{const sources=configured.filter(item=>item.dealershipId===cell.dealershipId);return <div className="platform-oem-matrix-row" key={cell.dealershipId} role="group" aria-label={`${row.label} at ${cell.dealershipName}`}><div><strong>{cell.dealershipName}</strong><p>{cell.configured?`${cell.configured} configured · ${cell.enabled} enabled · ${cell.paused} paused`:'No OEM source'}</p></div><div className="platform-oem-row-actions">{sources.map(source=><button className={flowButtonClassName({ variant: "secondary" })} key={source.id} type="button" disabled={busy} onClick={()=>onInspect(source.id)}>View {source.name}</button>)}<button type="button" className={flowButtonClassName({ variant: "primary", className: "platform-oem-add" })} aria-label={`Add ${row.label} source for ${cell.dealershipName}`} disabled={busy} onClick={()=>onAdd(selected,cell.dealershipId)}><Plus aria-hidden="true"/>Add source</button></div></div>})}
    {!group.dealerships.length&&<p>Add a dealership before configuring an OEM source.</p>}
   </div>
   <aside className="platform-oem-profile"><h4>Potential fields · {profile.label}</h4><p>{profile.brands.join(' · ')}</p><ul>{profile.evidencePlanning.map(item=><li key={item}>{item}</li>)}</ul>{profile.guidance.map(item=><p key={item}>{item}</p>)}<p className="platform-oem-caution">Planning fields only. Confirm permissions and supported fields with an authorized provider. Saving a connection does not install an adapter or change captured data.</p></aside>
  </div>
 </section>
}
