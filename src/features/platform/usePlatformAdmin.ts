import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlatformOverview, PlatformEdit, PlatformPayload } from './types'
class PlatformRequestError extends Error {constructor(message:string,readonly status:number) {super(message)}}

export function usePlatformAdmin() {
  const [data,setData] = useState<PlatformOverview|null>(null)
  const [selected,setSelected] = useState('')
  const [edit,setEdit] = useState<PlatformEdit|null>(null)
  const [error,setError] = useState('')
  const [refreshFailed,setRefreshFailed] = useState(false)
  const [notice,setNotice] = useState('')
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [denied,setDenied] = useState(false)
  const [refreshVersion,setRefreshVersion] = useState(0)
  const epoch = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  const loadSequence = useRef(0)
  const ownerId = useRef('')
  const clearProtected = useCallback((accessDenied:boolean) => {
    epoch.current++;controllers.current.forEach(controller=>controller.abort())
    setData(null);setEdit(null);setSelected('');setNotice('');setRefreshFailed(false);setDenied(accessDenied);ownerId.current=''
  },[])
  const request = useCallback(async <T,>(path:string,body?:PlatformPayload,key?:string):Promise<T> => {
    const generation = epoch.current, controller = new AbortController()
    controllers.current.add(controller)
    try {
      const response = await fetch(`/api/platform${path}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key ?? ''},body:JSON.stringify(body)}:{})})
      if (generation !== epoch.current) throw new DOMException('Access changed','AbortError')
      if ([401,403].includes(response.status)) {
        clearProtected(true)
        throw new PlatformRequestError(response.status===401?'Sign in again to verify software-owner access.':'Software-owner access is required.',response.status)
      }
      const isJson = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()==='application/json'
      if (response.redirected || (response.ok && !isJson)) {
        clearProtected(true)
        throw new PlatformRequestError('Sign in again to verify software-owner access.',401)
      }
      if (!isJson) throw new PlatformRequestError('The owner service could not be verified. Refresh to try again.',response.status)
      const result = await response.json()
      if (generation !== epoch.current) throw new DOMException('Access changed','AbortError')
      if (!response.ok) {
        throw new PlatformRequestError(result.error || 'The request could not be completed.',response.status)
      }
      return result as T
    } catch(caught) {
      if (generation !== epoch.current && !(caught instanceof PlatformRequestError && [401,403].includes(caught.status))) {
        throw new DOMException('Access changed','AbortError')
      }
      throw caught
    } finally {controllers.current.delete(controller)}
  },[clearProtected])
  const failed = useCallback((caught:unknown) => {if (!(caught instanceof DOMException && caught.name === 'AbortError')) {setError(caught instanceof Error?caught.message:'The request failed.');setRefreshFailed(false)}},[])
  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current
    try {
      const next = await request<PlatformOverview>('')
      if (sequence !== loadSequence.current) return
      const ownerChanged = Boolean(ownerId.current && ownerId.current !== next.owner.id)
      if (ownerChanged) {epoch.current++;controllers.current.forEach(controller=>controller.abort());setEdit(null);setNotice('')}
      setSelected(current=>!ownerChanged && next.groups.some(item=>item.id===current) ? current : next.groups.find(item=>item.status==='active' && item.health.connected && item.health.status==='current')?.id ?? next.groups.find(item=>item.status==='active' && item.health.connected)?.id ?? next.groups[0]?.id ?? '')
      ownerId.current = next.owner.id
      setData(next);setRefreshVersion(value=>value+1);setDenied(false);setError('');setRefreshFailed(false)
    } catch(caught) {
      if (sequence === loadSequence.current && !(caught instanceof DOMException && caught.name==='AbortError')) {
        if (caught instanceof PlatformRequestError && [401,403].includes(caught.status)) failed(caught)
        else {setError('The owner overview could not be refreshed. Refresh to try again.');setRefreshFailed(true)}
      }
    } finally {if (sequence === loadSequence.current) setLoading(false)}
  },[failed,request])
  useEffect(()=>{
    void refresh()
    const timer = window.setInterval(()=>{if (document.visibilityState==='visible') void refresh()},30000)
    const refreshOnFocus = ()=>void refresh()
    window.addEventListener('focus',refreshOnFocus)
    return ()=>{clearInterval(timer);window.removeEventListener('focus',refreshOnFocus);epoch.current++;controllers.current.forEach(controller=>controller.abort())}
  },[refresh])
  const save = async (form:PlatformEdit,values:Record<string,string|boolean|number>,key:string) => {
    setBusy(true);setError('');setNotice('');setRefreshFailed(false)
    try {
      const result=await request<{id?:string}>(form.path,values,key)
      if(result.id)form.afterSave?.(result.id)
      setEdit(null);setNotice('Change saved and recorded in the audit history.')
      await refresh()
    } catch(caught) {failed(caught)} finally {setBusy(false)}
  }
  const begin = (form:PlatformEdit) => {if (busy) return;setError('');setNotice('');setRefreshFailed(false);setEdit(form)}
  return {data,selected,setSelected,edit,error,refreshFailed,notice,busy,loading,denied,refreshVersion,request,refresh,save,begin,closeEdit:()=>setEdit(null)}
}
