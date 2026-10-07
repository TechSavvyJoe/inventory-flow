import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { PlatformConnection, PlatformConnections, PlatformGroup } from './types'
import { buildOemCoverage, OEM_PROFILES, type OemFamily } from './platformSourceModel'
import './PlatformDataConnections.css'

export function PlatformOemCoverage({group,data,busy,onInspect,onAdd}:{group:PlatformGroup;data:PlatformConnections;busy:boolean;onInspect:(id:string)=>void;onAdd:(oem:string,dealershipId?:string)=>void}) {
 const coverage=useMemo(()=>buildOemCoverage(group,data.connections),[group,data.connections])
 const [selected,setSelected]=useState<OemFamily>('ford_lincoln')
 const profile=OEM_PROFILES[selected]
 const row=coverage.find(item=>item.oem===selected)!
 const configured:PlatformConnection[]=data.connections.filter(item=>item.groupId===group.id&&item.oem===selected&&group.dealerships.some(dealer=>dealer.groupId===group.id&&dealer.id===item.dealershipId))
 return <section className="platform-oem-coverage" aria-label="OEM coverage">
  <header className="platform-oem-header"><div><h3>OEM source coverage</h3><p>Registry configuration by manufacturer and dealership. Counts describe saved source preferences.</p></div><label>OEM family<select aria-label="OEM family" value={selected} onChange={event=>setSelected(event.target.value as OemFamily)}>{coverage.map(item=><option key={item.oem} value={item.oem}>{item.label}</option>)}</select></label></header>
  <div className="platform-oem-metrics" aria-label={`${row.label} source totals`}><span><strong>{row.configured}</strong><small>Configured</small></span><span><strong>{row.enabled}</strong><small>Enabled preference</small></span><span><strong>{row.paused}</strong><small>Paused</small></span></div>
  <div className="platform-oem-workspace">
   <div className="platform-oem-matrix"><div className="platform-oem-matrix-head"><span>Dealership</span><span>OEM source</span><span>Enabled</span><span>Paused</span></div>
    {row.dealerships.map(cell=>{const sources=configured.filter(item=>item.dealershipId===cell.dealershipId);return <div className="platform-oem-matrix-row" key={cell.dealershipId} role="group" aria-label={`${row.label} at ${cell.dealershipName}`}><strong>{cell.dealershipName}</strong><span>{cell.configured?`${cell.configured} configured`:'No OEM source'}</span><span><small className="platform-oem-count-label">Enabled </small>{cell.enabled}</span><span><small className="platform-oem-count-label">Paused </small>{cell.paused}</span><div className="platform-oem-row-actions">{sources.map(source=><button key={source.id} type="button" disabled={busy} onClick={()=>onInspect(source.id)}>View {source.name}</button>)}<button type="button" className="platform-oem-add" aria-label={`Add ${row.label} source for ${cell.dealershipName}`} disabled={busy} onClick={()=>onAdd(selected,cell.dealershipId)}><Plus aria-hidden="true"/>Add source</button></div></div>})}
    {!group.dealerships.length&&<p className="platform-source-empty">Add a dealership before configuring an OEM source.</p>}
   </div>
   <aside className="platform-oem-profile"><small>Configuration guide · {profile.label}</small><p>{profile.brands.join(' · ')}</p><h4>Data to map with your provider</h4><ul>{profile.evidencePlanning.map(item=><li key={item}>{item}</li>)}</ul>{selected==='ford_lincoln'&&<ul className="platform-oem-notes">{profile.guidance.map(item=><li key={item}>{item}</li>)}</ul>}<p className="platform-oem-caution">Planning fields only. Confirm source, permissions, and captured data with the provider; this does not establish vehicle availability or warranty coverage.</p></aside>
  </div>
 </section>
}
