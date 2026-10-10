import { useId, useState, type Dispatch, type SetStateAction } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import type { PlatformEdit, PlatformField } from './types'
import { METHODS, OEMS } from './platformPresentation'
import { matchSourceProfile, sourceProfiles } from './sourceCatalog'
import './PlatformSourceSetup.css'

export const SOURCE_STEPS=['Source & scope','Connection','Schedule & review']
type Values=Record<string,string|boolean|number>
const validTime=(value:unknown)=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
const validZone=(value:unknown)=>{try{new Intl.DateTimeFormat('en-US',{timeZone:String(value)}).format();return true}catch{return false}}
export function manualScheduleValues(values:Values):Values{return {...values,localTime:validTime(values.localTime)?values.localTime:'05:30',timezone:validZone(values.timezone)?values.timezone:'America/Detroit'}}
export function sourceStepError(values:Values,step:number):string {
 if(step===0&&values.provider==='oem'&&values.oem==='not_applicable')return 'Choose an OEM family for an OEM evidence source.'
 if(step===1){
  if(values.credentialRef&&!/^CREDENTIAL_[A-Z][A-Z0-9_]{1,67}$/.test(String(values.credentialRef)))return 'Use a credential reference beginning CREDENTIAL_, followed by uppercase letters, numbers or underscores.'
  if(values.method!=='collector'){
   try{const url=new URL(String(values.endpoint)),host=url.hostname.toLowerCase();if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443'||!host.includes('.')||/^\[|^\d+\.|(^|\.)(localhost|local|internal)$/.test(host))return 'Use a public HTTPS URL without credentials, query parameters or private network addresses.'}catch{return 'Enter the vendor-approved public HTTPS URL.'}
  }
 }
 if(step===2){if(!validTime(values.localTime))return 'Enter a valid local start time.';if(!validZone(values.timezone))return 'Enter a valid IANA timezone, such as America/Detroit.'}
 return ''
}

const FIELD_STEP:Record<string,number>={name:0,dealershipId:0,provider:0,vendor:0,oem:0,method:1,endpoint:1,credentialRef:1,cadence:2,localTime:2,timezone:2,enabled:2}
const FIELD_HELP:Record<string,string>={
 vendor:'Use the provider your dealership subscribes to; other vendors can be entered directly.',
 oem:'Use a manufacturer scope for OEM evidence. A public feed can include multiple makes.',
 endpoint:'Use a vendor-approved public HTTPS endpoint without a token in its URL. SFTP requires a separately provisioned collector.',
 credentialRef:'A reference such as CREDENTIAL_DEALER_FEED_KEY, never the password or API key itself.',
 cadence:'The planner can queue requests on this schedule. Collection requires a separately connected executor.',
 enabled:'Saves the scheduling preference only. New connections start paused.',
}
function Field({field,values,busy,change}:{field:PlatformField;values:Values;busy:boolean;change:(key:string,value:string|boolean)=>void}){
 const helpId=useId(),accessibility={'aria-label':field.label,'aria-describedby':FIELD_HELP[field.key]?helpId:undefined}
 if(field.type==='checkbox')return <label className="platform-source-checkbox"><input {...accessibility} type="checkbox" checked={Boolean(values[field.key])} disabled={busy} onChange={event=>change(field.key,event.target.checked)}/><span>{field.label}{FIELD_HELP[field.key]&&<small id={helpId}>{FIELD_HELP[field.key]}</small>}</span></label>
 return <label>{field.label}{field.options?<select {...accessibility} value={String(values[field.key])} disabled={busy} onChange={event=>change(field.key,event.target.value)}>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<input {...accessibility} type={field.type??'text'} value={String(values[field.key]??'')} maxLength={field.key==='endpoint'?500:['vendor','credentialRef','timezone'].includes(field.key)?80:160} readOnly={field.readOnly} disabled={busy} required={!field.optional} onChange={event=>change(field.key,event.target.value)}/>} {FIELD_HELP[field.key]&&<small id={helpId}>{FIELD_HELP[field.key]}</small>}</label>
}
export function PlatformSourceSetup({edit,step,values,setValues,change,busy}:{edit:PlatformEdit;step:number;values:Values;setValues:Dispatch<SetStateAction<Values>>;change:(key:string,value:string|boolean)=>void;busy:boolean}){
 const [query,setQuery]=useState('')
 const profile=matchSourceProfile(String(values.provider),String(values.vendor))
 const choices=sourceProfiles(query)
 const fields=edit.fields.filter(field=>FIELD_STEP[field.key]===step&&(!field.showWhen||field.showWhen.values.includes(String(values[field.showWhen.key]))))
 const choose=(id:string)=>{const next=choices.find(item=>item.id===id);if(next)setValues(current=>({...current,provider:next.category,vendor:next.name,name:!current.name||current.name===profile?.name?next.name:current.name}))}
 return <div className="platform-source-setup">
  <ol className="platform-setup-steps" aria-label="Connection setup progress">{SOURCE_STEPS.map((label,index)=><li key={label} aria-current={index===step?'step':undefined}><span>{index<step?<Check aria-hidden="true"/>:index+1}</span><strong>{label}</strong></li>)}</ol>
  <h3 data-setup-step-heading tabIndex={-1}>{SOURCE_STEPS[step]}</h3>
  {step===0&&<details className="platform-provider-picker" open={!edit.values.id&&!values.vendor}><summary>Choose a researched provider</summary><p className="platform-help">Find your CRM, DMS, website or enrichment provider. This fills its name and category; it does not connect an integration.</p><label>Find a provider<input type="search" value={query} disabled={busy} onChange={event=>setQuery(event.target.value)} placeholder="Provider, franchise or independent"/></label><label>Provider catalog<select value={choices.some(item=>item.id===profile?.id)?profile!.id:''} disabled={busy} onChange={event=>choose(event.target.value)}><option value="">Select a provider or enter your own below</option>{choices.map(item=><option key={item.id} value={item.id}>{item.name} · {item.segment}</option>)}</select></label>{!choices.length&&<p role="status">No catalog matches. Enter your provider below.</p>}</details>}
  {step===1&&<div className="platform-connection-guide"><strong>{values.method==='collector'?'Dealership-hosted collector':values.method==='api'?'Direct vendor API':'Approved HTTPS file feed'}</strong><p>{values.method==='collector'?'Use this when capture runs on an authorized dealership computer. Provision its adapter, access and secrets separately.':values.method==='api'?'Obtain the vendor integration agreement, dealer-scoped endpoint and approved read permissions before connecting an executor.':'Arrange the file format, delivery location, field dictionary and refresh schedule with the provider. This registry accepts HTTPS delivery locations.'}</p></div>}
  <div className="platform-fields">{fields.map(field=><Field key={field.key} field={field} values={values} busy={busy} change={change}/>)}</div>
  {profile&&step!==2&&<details className="platform-provider-guide" aria-label="Provider evidence guide"><summary>{profile.name} · Data & access guidance</summary><header><strong>Provider-documented data</strong><a href={profile.url} target="_blank" rel="noopener noreferrer">Official source <ExternalLink aria-hidden="true"/></a></header><ul>{profile.evidence.map(item=><li key={item}>{item}</li>)}</ul><p>{profile.access}</p><small>{profile.gate} Field selection and mapping are not configured by this form.</small></details>}
  {step===2&&<section className="platform-source-review" aria-label="Connection review"><h3>Review this connection</h3><dl>
    <div><dt>Connection name</dt><dd>{String(values.name)}</dd></div>
    <div><dt>Provider</dt><dd>{String(values.vendor)}</dd></div>
    <div><dt>Dealership</dt><dd>{edit.fields.find(field=>field.key==='dealershipId')?.options?.find(option=>option.value===values.dealershipId)?.label}</dd></div>
    <div><dt>OEM scope</dt><dd>{OEMS[String(values.oem)]}</dd></div>
    <div><dt>Delivery</dt><dd>{METHODS[values.method as keyof typeof METHODS]}</dd></div>
    <div><dt>Scheduling preference</dt><dd>{values.enabled?'Enabled':'Paused'}</dd></div>
    <div><dt>Cadence</dt><dd>{values.cadence==='manual'?'On request':values.cadence==='daily'?'Daily':'Hourly'}</dd></div>
    {values.cadence!=='manual'&&<><div><dt>Local start time</dt><dd>{String(values.localTime)}</dd></div><div><dt>Timezone</dt><dd>{String(values.timezone)}</dd></div></>}
    {values.endpoint&&<div className="platform-source-review-endpoint"><dt>Saved endpoint</dt><dd>{String(values.endpoint)}</dd></div>}
  </dl><p><strong>Saving records configuration.</strong> Provider access remains unverified. No source is contacted, secret is provisioned or inventory published.</p></section>}

 </div>
}
