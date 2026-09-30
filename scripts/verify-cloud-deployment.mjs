import { accessHeaders, publicationEndpoint } from './publish-cloud-release.mjs'
import { equipmentPublicationEndpoint } from './publish-vauto-documents.mjs'
const base=publicationEndpoint(process.env.INVENTORY_OPS_CLOUD_URL).origin
const mode=process.argv[2]??'status'
if(!['status','readiness','equipment-status'].includes(mode)) throw new Error('Unsupported deployment check')
const headers={...accessHeaders(),Authorization:`Bearer ${process.env.INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN}`}
const options={method:'GET',redirect:'error',signal:AbortSignal.timeout(120000),headers}
let route=mode==='readiness'?'/internal/readiness':'/internal/status'
if(mode==='equipment-status') {
  route=equipmentPublicationEndpoint(base,process.argv[3],process.argv[4]).pathname
  headers['X-Inventory-Source-Url']=process.argv[5]??''
}
const response=await fetch(base+route,options)
const data=await response.json().catch(()=>null)
if(!response.ok) {console.log(JSON.stringify({status:response.status,code:data?.code??'UNEXPECTED_RESPONSE'}));process.exitCode=1}
else {
  console.log(JSON.stringify(data))
  // A reachable Worker that reports not ready (e.g. the 0013 disposition table is missing) fails the check.
  if(mode==='readiness' && data?.ready!==true) process.exitCode=1
}
