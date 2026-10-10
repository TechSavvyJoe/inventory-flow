import { FlowLedgerHeading, flowButtonClassName } from '../../design-system'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { useContainedFocus } from '../../lib/useContainedFocus'
import { useModalBackgroundIsolation } from '../../lib/useModalBackgroundIsolation'
import type { PlatformEdit } from './types'
import { PlatformSourceSetup, SOURCE_STEPS, sourceStepError, manualScheduleValues } from './PlatformSourceSetup'

export function PlatformDialog({title,children,close,busy=false,scrollBody=false}:{title:string;children:React.ReactNode;close:()=>void;busy?:boolean;scrollBody?:boolean}) {
  const id=useId(),dialog=useRef<HTMLElement>(null),background=useRef(document.getElementById('root'))
  useContainedFocus({active:true,contain:true,containerRef:dialog,onEscape:()=>{if(!busy)close()}})
  useModalBackgroundIsolation({active:true,backgroundRef:background})
  return createPortal(<div className="platform-app platform-overlay"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className={`platform-dialog${scrollBody?' platform-dialog--body-scroll':''}`}><FlowLedgerHeading title={title} titleId={id} actions={<button className={flowButtonClassName({ variant: "quiet" })} disabled={busy} onClick={close} aria-label="Close dialog"><X aria-hidden="true"/></button>} />{children}</section></div>,document.body)
}
export function PlatformChangeDialog({edit,busy,error,save,cancel,onRetryRefresh}:{edit:PlatformEdit;busy:boolean;error:string;save:(edit:PlatformEdit,values:Record<string,string|boolean|number>,key:string)=>Promise<void>;cancel:()=>void;onRetryRefresh?:()=>Promise<void>}) {
  const [values,setValues]=useState({...edit.values,reason:''} as Record<string,string|boolean|number>)
  const [step,setStep]=useState(0)
  const [validation,setValidation]=useState(''),form=useRef<HTMLFormElement>(null),previousStep=useRef(0)
  useEffect(()=>{if(previousStep.current!==step){form.current?.querySelector<HTMLElement>('[data-setup-step-heading]')?.focus();previousStep.current=step}},[step])
  const retry=useRef({signature:'',key:''})
  const updateSourceValues:typeof setValues=next=>{setValidation('');setValues(next)}
  const change=(key:string,value:string|boolean)=>updateSourceValues(current=>{const next={...current,[key]:value,...(key==='method'&&value==='collector'?{endpoint:''}:{})};return key==='cadence'&&value==='manual'?manualScheduleValues(next):next})
  const visibleFields=edit.fields.filter(field=>!field.showWhen||field.showWhen.values.includes(String(values[field.showWhen.key])))
  const sections=[...new Set(visibleFields.map(field=>field.section??''))]
  const submit=(event:FormEvent)=>{event.preventDefault();if(edit.kind==='source'){const message=sourceStepError(values,step);setValidation(message);if(message)return;if(step<2){setStep(step+1);return}}const signature=JSON.stringify(values);if(retry.current.signature!==signature)retry.current={signature,key:crypto.randomUUID()};void save(edit,values,retry.current.key)}
  return <PlatformDialog title={edit.title} close={cancel} busy={busy} scrollBody={edit.kind==='source'}><form ref={form} className={`platform-form${edit.kind==='source'?' platform-form--source':''}`} aria-label={edit.title} onSubmit={submit}><div className="platform-form-content">
    {edit.help && edit.kind!=='source' && <p className="platform-help">{edit.help}</p>}
    {error && <p role="alert" className="platform-error">{error}{onRetryRefresh&&<button className={flowButtonClassName({ variant: "secondary" })} type="button" disabled={busy} onClick={()=>void onRetryRefresh()}>Retry refresh</button>}</p>}
    {validation&&<p role="alert" className="platform-error">{validation}</p>}
    {edit.kind==='source'?<PlatformSourceSetup edit={edit} step={step} values={values} setValues={updateSourceValues} change={change} busy={busy}/>:sections.map(section=><fieldset className="platform-field-section" key={section}>{section&&<legend>{section}</legend>}<div className="platform-fields">{visibleFields.filter(field=>(field.section??'')===section).map(field=><label key={field.key}>{field.label}
      {field.options?<select value={String(values[field.key])} disabled={busy} onChange={event=>change(field.key,event.target.value)}>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
        :field.type==='checkbox'?<input type="checkbox" checked={Boolean(values[field.key])} disabled={busy} onChange={event=>change(field.key,event.target.checked)}/>
        :<input type={field.type??'text'} value={String(values[field.key]??'')} maxLength={['website','endpoint'].includes(field.key)?500:field.type==='email'?254:160} readOnly={field.readOnly} disabled={busy} required={!field.optional} onChange={event=>change(field.key,event.target.value)}/>}
    </label>)}</div></fieldset>)}
    {(edit.kind!=='source'||step===2)&&<label>Reason for this change<input required minLength={3} maxLength={500} value={String(values.reason)} disabled={busy} onChange={event=>setValues({...values,reason:event.target.value})} placeholder="Account administration only; no customer information"/></label>}
    </div><footer><button className={flowButtonClassName({ variant: "secondary" })} type="button" onClick={edit.kind==='source'&&step>0?()=>{setValidation('');setStep(step-1)}:cancel} disabled={busy}>{edit.kind==='source'&&step>0?'Back':'Cancel'}</button><button className={flowButtonClassName({ variant: "primary", className: "platform-primary" })} disabled={busy} type="submit">{(edit.kind!=='source'||step===2)&&<Check aria-hidden="true"/>}{busy?'Saving…':edit.kind==='source'&&step<2?`Continue to ${SOURCE_STEPS[step+1].toLowerCase()}`:'Save change'}</button></footer>
  </form></PlatformDialog>
}
