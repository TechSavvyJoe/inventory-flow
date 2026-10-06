import { useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { useContainedFocus } from '../../lib/useContainedFocus'
import { useModalBackgroundIsolation } from '../../lib/useModalBackgroundIsolation'
import type { PlatformEdit } from './types'

export function PlatformDialog({title,children,close,busy=false}:{title:string;children:React.ReactNode;close:()=>void;busy?:boolean}) {
  const id=useId(),dialog=useRef<HTMLElement>(null),background=useRef(document.getElementById('root'))
  useContainedFocus({active:true,contain:true,containerRef:dialog,onEscape:()=>{if(!busy)close()}})
  useModalBackgroundIsolation({active:true,backgroundRef:background})
  return createPortal(<div className="platform-app platform-overlay"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="platform-dialog"><header><h2 id={id}>{title}</h2><button disabled={busy} onClick={close} aria-label="Close dialog"><X aria-hidden="true"/></button></header>{children}</section></div>,document.body)
}
export function PlatformChangeDialog({edit,busy,error,save,cancel,onRetryRefresh}:{edit:PlatformEdit;busy:boolean;error:string;save:(edit:PlatformEdit,values:Record<string,string|boolean|number>,key:string)=>Promise<void>;cancel:()=>void;onRetryRefresh?:()=>Promise<void>}) {
  const [values,setValues]=useState({...edit.values,reason:''} as Record<string,string|boolean|number>)
  const retry=useRef({signature:'',key:''})
  const change=(key:string,value:string|boolean)=>setValues(current=>({...current,[key]:value,...(key==='method'&&value==='collector'?{endpoint:''}:{}),...(key==='provider'&&value!=='oem'?{oem:'not_applicable'}:{})}))
  const submit=(event:FormEvent)=>{event.preventDefault();const signature=JSON.stringify(values);if(retry.current.signature!==signature)retry.current={signature,key:crypto.randomUUID()};void save(edit,values,retry.current.key)}
  return <PlatformDialog title={edit.title} close={cancel} busy={busy}><form className="platform-form" aria-label={edit.title} onSubmit={submit}>
    {edit.help && <p className="platform-help">{edit.help}</p>}
    {error && <p role="alert" className="platform-error">{error}{onRetryRefresh&&<button type="button" disabled={busy} onClick={()=>void onRetryRefresh()}>Retry refresh</button>}</p>}
    <div className="platform-fields">{edit.fields.filter(field=>!field.showWhen||field.showWhen.values.includes(String(values[field.showWhen.key]))).map(field=><label key={field.key}>{field.label}
      {field.options?<select value={String(values[field.key])} disabled={busy} onChange={event=>change(field.key,event.target.value)}>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
        :field.type==='checkbox'?<input type="checkbox" checked={Boolean(values[field.key])} disabled={busy} onChange={event=>change(field.key,event.target.checked)}/>
        :<input type={field.type??'text'} value={String(values[field.key]??'')} maxLength={['website','endpoint'].includes(field.key)?500:field.type==='email'?254:160} readOnly={field.readOnly} disabled={busy} required={!field.optional} onChange={event=>change(field.key,event.target.value)}/>}
    </label>)}</div>
    <label>Reason for this change<input required minLength={3} maxLength={500} value={String(values.reason)} disabled={busy} onChange={event=>setValues({...values,reason:event.target.value})} placeholder="Account administration only; no customer information"/></label>
    <footer><button type="button" onClick={cancel} disabled={busy}>Cancel</button><button className="platform-primary" disabled={busy} type="submit"><Check aria-hidden="true"/>{busy?'Saving…':'Save change'}</button></footer>
  </form></PlatformDialog>
}
