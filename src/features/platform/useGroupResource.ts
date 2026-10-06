import { useEffect, useState } from 'react'
import type { PlatformRequest } from './types'
export function useGroupResource<T>(path:string|null,request:PlatformRequest,revision:number) {
 const [state,setState]=useState<{path:string;data:T}|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>{let current=true;setState(previous=>previous?.path===path?previous:null);setError('');if(path)void request<T>(path).then(data=>{if(current)setState({path,data})}).catch(caught=>{if(current && !(caught instanceof DOMException && caught.name==='AbortError')){setState(null);setError(caught instanceof Error?caught.message:'The records could not be loaded.')}});return()=>{current=false}},[path,request,revision,attempt])
 return {data:state?.path===path?state.data:null,error,retry:()=>setAttempt(value=>value+1)}
}
