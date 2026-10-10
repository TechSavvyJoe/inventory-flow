import { useRef, useState, type FormEvent } from 'react'
import { Check, Laptop, Plus, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react'
import { FlowLedgerHeading, flowButtonClassName } from '../../design-system'
import { formatDateTime } from '../../lib/format'
import { PlatformDialog } from './PlatformChangeDialog'
import { useGroupResource } from './useGroupResource'
import type { PlatformCollector, PlatformCollectorsData, PlatformConnection, PlatformGroup, PlatformPayload, PlatformRequest } from './types'
import './PlatformCollectors.css'

const STAGES:Record<string,string>={claimed:'Preparing capture',capturing:'Reading DealerMail',captured:'Capture reported',validated:'Candidate validated',publishing:'Publication in progress',completed:'Completed attempt',failed:'Stopped',cancelled:'Cancelled',expired:'Lease expired',reconciliation_required:'Publication needs reconciliation'}
const FAILURES:Record<string,string>={
  BASELINE_REQUIRED:'A verified release for today is required.',
  RECONCILIATION_REQUIRED:'Reconcile the retained exact candidate before running again.',
  ADAPTER_DEPENDENCY_MISSING:'The installed capture dependencies are missing or changed.',
  PROFILE_SCOPE_MISMATCH:'The installed profile does not match this enrollment.',
  NEEDS_SIGN_IN:'Sign in to the permitted DealerMail session on the collector computer.',
  BROWSER_UNAVAILABLE:'The permitted browser session is unavailable on the collector computer.',
  CAPTURE_INCOMPLETE:'DealerMail capture was incomplete. Last verified inventory is preserved.',
  CAPTURE_FAILED:'DealerMail could not be captured. Last verified inventory is preserved.',
  VALIDATION_FAILED:'The candidate failed validation. Last verified inventory is preserved.',
  DISALLOWED_SOURCE:'The installed adapter attempted an unpermitted source and was stopped.',
  HOST_IO_FAILED:'The collector could not save its local candidate.',
  DURATION_EXCEEDED:'The collector lease expired. Review the retained attempt before retrying.',
  COLLECTOR_REVOKED:'This collector was revoked. Review any publication already admitted.',
  COLLECTOR_LEASE_STALE:'This attempt lost its authorization. Review its final publication state.',
}

export function PlatformCollectors({group,connections,request,revision,busy,onChanged}:{group:PlatformGroup;connections:PlatformConnection[];request:PlatformRequest;revision:number;busy:boolean;onChanged:()=>void}) {
  const path=`/groups/${group.id}/collectors`
  const {data,error,retry}=useGroupResource<PlatformCollectorsData>(path,request,revision)
  const [dialog,setDialog]=useState<'enroll'|{collector:PlatformCollector;operation:'enable'|'revoke'}|null>(null)
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[notice,setNotice]=useState('')
  const [reconcileError,setReconcileError]=useState('')
  const [form,setForm]=useState({name:'',accessClientId:'',profileId:'',profileSha256:'',credentialRef:'',reason:'',scopeAccepted:false})
  const [choices,setChoices]=useState<Record<string,string>>({})
  const idempotency=useRef({signature:'',key:''})
  const blocked=busy||saving
  const collectors=data?.collectors.filter(item=>item.groupId===group.id)??[]
  const stores=group.dealerships
  const eligible=(dealerId:string)=>connections.filter(item=>item.groupId===group.id&&item.dealershipId===dealerId&&item.provider==='dealermail'&&item.method==='collector'&&!item.endpoint&&item.timezone==='America/New_York')
  const openEnroll=()=>{setForm({name:'',accessClientId:'',profileId:'',profileSha256:'',credentialRef:'',reason:'',scopeAccepted:false});setChoices(Object.fromEntries(stores.map(store=>[store.id,eligible(store.id)[0]?.id??''])));setSaveError('');setDialog('enroll')}
  const close=()=>{if(!saving){setDialog(null);setSaveError('')}}
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!data||!dialog||saving)return
    if(dialog==='enroll'&&(!form.scopeAccepted||stores.length!==4||stores.some(store=>!choices[store.id]))){setSaveError('Review all four dealerships and choose their DealerMail collector connections.');return}
    if(dialog==='enroll'&&(!/^CREDENTIAL_[A-Z][A-Z0-9_]{1,67}$/.test(form.credentialRef)||stores.some(store=>connections.find(connection=>connection.id===choices[store.id])?.credentialRef!==form.credentialRef))){setSaveError('Every selected connection must use the credential reference from the installed profile.');return}
    const values:PlatformPayload=dialog==='enroll'?{operation:'enroll',name:form.name.trim(),accessClientId:form.accessClientId.trim(),adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:form.profileId.trim(),profileSha256:form.profileSha256.trim().toLowerCase(),credentialRef:form.credentialRef,dealershipIds:stores.map(store=>store.id),connectionIds:stores.map(store=>choices[store.id]),reason:form.reason.trim(),expectedRevision:data.revision}:{operation:dialog.operation,id:dialog.collector.id,reason:form.reason.trim(),expectedRevision:data.revision}
    const signature=JSON.stringify(values)
    if(idempotency.current.signature!==signature)idempotency.current={signature,key:crypto.randomUUID()}
    setSaving(true);setSaveError('');setNotice('')
    try{await request(path,values,idempotency.current.key);setDialog(null);setNotice(dialog==='enroll'?'Collector registered, paused until reviewed and enabled.':'Collector change saved. Review any in-flight publication separately.');retry();onChanged()}
    catch(caught){if(!(caught instanceof DOMException&&caught.name==='AbortError'))setSaveError(caught instanceof Error?caught.message:'The collector change could not be saved.')}
    finally{setSaving(false)}
  }
  const reconcile=async(attemptId:string)=>{
    if(blocked)return
    setSaving(true);setReconcileError('');setNotice('')
    try{
      const result=await request<{status:string}>(`/groups/${group.id}/collector-reconcile`,{attemptId},crypto.randomUUID())
      setNotice(['published_verified','unchanged_verified'].includes(result.status)?'The tenant verified the exact saved release.':'Publication is still unconfirmed. The retained candidate remains blocked for reconciliation.')
      retry();onChanged()
    }catch(caught){if(!(caught instanceof DOMException&&caught.name==='AbortError'))setReconcileError(caught instanceof Error?caught.message:'Publication could not be checked. The retained candidate is preserved.')}
    finally{setSaving(false)}
  }
  const status=(item:PlatformCollector)=>item.revokedAt?'Revoked':!item.enabled?'Paused':!data?.executionEnabled?'Execution disabled':item.connected?'Connected':item.lastSeenAt?'Disconnected · last contact recorded':'Awaiting host contact'
  return <section className="platform-collectors" aria-label="Dealership collector hosts">
    <FlowLedgerHeading level={3} title={<><Laptop aria-hidden="true"/>Collector hosts</>} description="A fixed dealership computer reads permitted sources. The platform verifies publication separately." actions={<><button className={flowButtonClassName({variant:'quiet'})} aria-label="Refresh collector hosts" disabled={blocked} onClick={retry}><RefreshCw aria-hidden="true"/></button><button className={flowButtonClassName({variant:'primary'})} disabled={blocked||!data} onClick={openEnroll}><Plus aria-hidden="true"/>Register host</button></>}/>
    {error?<p role="alert">{error} <button className={flowButtonClassName({variant:'secondary'})} onClick={retry}>Retry collector hosts</button></p>:!data?<p role="status">Loading collector enrollment…</p>:<>
      <p className="platform-collector-scope"><ShieldCheck aria-hidden="true"/><span><strong>{data.executionEnabled?'Execution enabled':'Execution is disabled'}</strong> · First adapter: group-wide DealerMail hold refresh. Public inventory and resource facts are retained from the verified baseline; OEM systems are excluded.</span></p>
      {notice&&<p role="status">{notice}</p>}
      {reconcileError&&<p role="alert">{reconcileError}</p>}
      <div className="platform-collector-ledger">{collectors.map(item=><article key={item.id} aria-label={`Collector ${item.name}`}>
        <header><Laptop aria-hidden="true"/><div><h4>{item.name}</h4><small>{item.scopeLabel}</small></div><span className="platform-status">{status(item)}</span></header>
        <dl><div><dt>Profile</dt><dd>{item.profileId} · version {item.adapterVersion}</dd></div><div><dt>Last contact</dt><dd>{formatDateTime(item.lastSeenAt??undefined)}</dd></div><div><dt>Granted dealerships</dt><dd>{item.dealershipIds.map(id=>group.dealerships.find(store=>store.id===id)?.name??'Unregistered dealership').join(' · ')}</dd></div></dl>
        <details><summary>Identity & installed profile</summary><dl><div><dt>Access service identity</dt><dd>{item.accessClientId}</dd></div><div><dt>Profile fingerprint</dt><dd>{item.profileSha256}</dd></div><div><dt>Grant generation</dt><dd>{item.generation}</dd></div></dl></details>
        <footer>{!item.revokedAt&&<><button className={flowButtonClassName({variant:'secondary'})} disabled={blocked||item.enabled||group.status!=='active'} onClick={()=>{setForm(current=>({...current,reason:''}));setSaveError('');setDialog({collector:item,operation:'enable'})}}><Check aria-hidden="true"/>Enable host</button><button className={flowButtonClassName({variant:'secondary'})} disabled={blocked} onClick={()=>{setForm(current=>({...current,reason:''}));setSaveError('');setDialog({collector:item,operation:'revoke'})}}><ShieldOff aria-hidden="true"/>Revoke host</button></>}</footer>
      </article>)}</div>
      {!collectors.length&&<p>No collector hosts registered. Register the reviewed local profile, then enable it deliberately.</p>}
      <FlowLedgerHeading level={3} title="Capture & publication history" description="Latest 50 attempts. Host contact and reported capture do not prove provider access or published inventory."/>
      <div className="platform-collector-attempts">{data.attempts.map(attempt=><article key={attempt.id}><div><strong>{collectors.find(item=>item.id===attempt.collectorId)?.name??'Collector attempt'}</strong><small>{formatDateTime(attempt.createdAt)}</small></div><dl><div><dt>Capture</dt><dd>{attempt.capturedAt?'Reported complete':STAGES[attempt.stage]??'Awaiting evidence'}</dd></div><div><dt>Publication</dt><dd>{attempt.publication?.status==='published_and_verified'?'Verified exact release':attempt.stage==='publishing'?'In progress; outcome unconfirmed':attempt.stage==='reconciliation_required'?'Unknown; reconcile exact candidate':'Not verified'}</dd></div></dl>{attempt.failureCode&&<p role="status">{FAILURES[attempt.failureCode]??'Attempt stopped. Review its recorded code in details.'}</p>}{attempt.publication?.status==='published_and_verified'&&<p>Verified {formatDateTime(attempt.publication.verifiedAt)}{typeof attempt.publication.vehicleCount==='number'?` · ${attempt.publication.vehicleCount} inventory records`:''}</p>}{['publishing','reconciliation_required'].includes(attempt.stage)&&<button className={flowButtonClassName({variant:'secondary'})} disabled={blocked} onClick={()=>void reconcile(attempt.id)}><RefreshCw aria-hidden="true"/>Check saved publication</button>}<details><summary>Attempt details</summary><dl><div><dt>Attempt</dt><dd>{attempt.id}</dd></div><div><dt>State</dt><dd>{STAGES[attempt.stage]??attempt.stage}</dd></div>{attempt.failureCode&&<div><dt>Recorded code</dt><dd>{attempt.failureCode}</dd></div>}{attempt.bundleSha256&&<div><dt>Candidate fingerprint</dt><dd>{attempt.bundleSha256}</dd></div>}</dl></details></article>)}</div>
      {!data.attempts.length&&<p>No execution attempts recorded. Queued pulls appear in Pull requests.</p>}
    </>}
    {dialog&&<PlatformDialog title={dialog==='enroll'?'Register dealership collector':dialog.operation==='enable'?'Enable dealership collector':'Revoke dealership collector'} close={close} busy={saving} scrollBody><form className="platform-form platform-form--source platform-collector-form" aria-label="Collector enrollment change" onSubmit={event=>void submit(event)}><div className="platform-form-content">
      {saveError&&<p role="alert">{saveError}</p>}
      {dialog==='enroll'?<>
        <p>Run the local collector’s profile check on the authorized computer, then enter its identity, fingerprint and credential reference. This registers a paused host; it does not install software, sign in to vendors or start a pull.</p>
        <div className="platform-fields">{([['name','Collector name'],['accessClientId','Access service client ID'],['profileId','Installed profile ID'],['profileSha256','Installed profile fingerprint'],['credentialRef','Installed profile credential reference']] as const).map(([key,label])=><label key={key}>{label}<input required maxLength={key==='profileSha256'?64:key==='credentialRef'?80:160} pattern={key==='profileSha256'?'[a-fA-F0-9]{64}':key==='credentialRef'?'CREDENTIAL_[A-Z][A-Z0-9_]{1,67}':undefined} autoComplete="off" disabled={saving} value={form[key]} onChange={event=>setForm(current=>({...current,[key]:event.target.value}))}/></label>)}</div>
        <fieldset><legend>Explicit group-wide source permission</legend><p>All four registered dealerships must match the installed profile and use America/New_York for this adapter. Only DealerMail holds are refreshed.</p>{stores.map(store=><label key={store.id}>{store.name}<select required disabled={saving} value={choices[store.id]??''} onChange={event=>setChoices(current=>({...current,[store.id]:event.target.value}))}><option value="">Select DealerMail collector connection</option>{eligible(store.id).map(connection=><option value={connection.id} key={connection.id}>{connection.name}{connection.enabled?'':' · paused source'}</option>)}</select></label>)}{stores.length!==4&&<p role="status">This first adapter requires the exact four-dealership installed group profile.</p>}<label className="platform-collector-consent"><input type="checkbox" required checked={form.scopeAccepted} disabled={saving} onChange={event=>setForm(current=>({...current,scopeAccepted:event.target.checked}))}/><span>I reviewed permission for every named dealership and this DealerMail-only source scope.</span></label></fieldset>
      </>:<><p><strong>{dialog.collector.name}</strong> · {dialog.collector.scopeLabel}</p><p>{dialog.operation==='enable'?'Enable only after the installed profile, service identity and every permitted dealership/source have been reviewed. The global execution switch and source preferences must also permit a pull.':'Revoke this machine’s authority for future work. An admitted publication may already be in flight; review its final verified or unknown result.'}</p></>}
      <label>Reason for this change<input required minLength={3} maxLength={500} disabled={saving} value={form.reason} onChange={event=>setForm(current=>({...current,reason:event.target.value}))} placeholder="Administration only; no customer information"/></label>
      </div><footer><button type="button" className={flowButtonClassName({variant:'secondary'})} disabled={saving} onClick={close}>Cancel</button><button className={flowButtonClassName({variant:'primary'})} disabled={saving} type="submit"><Check aria-hidden="true"/>{saving?'Saving…':dialog==='enroll'?'Register paused host':dialog.operation==='enable'?'Enable reviewed host':'Revoke host'}</button></footer></form></PlatformDialog>}
  </section>
}
