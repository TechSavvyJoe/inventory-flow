import { accessHeaders, publicationEndpoint } from './publish-cloud-release.mjs'
const base=publicationEndpoint(process.env.INVENTORY_OPS_CLOUD_URL).origin
const mode=process.argv[2]??'status'
if(!['status','readiness'].includes(mode)) throw new Error('Unsupported deployment check')
const headers={...accessHeaders(),Authorization:`Bearer ${process.env.INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN}`}
const options={method:'GET',redirect:'error',signal:AbortSignal.timeout(120000),headers}
const route=mode==='readiness'?'/internal/readiness':'/internal/status'
const response=await fetch(base+route,options)
const data=await response.json().catch(()=>null)
if(!response.ok) {console.log(JSON.stringify({status:response.status,code:data?.code??'UNEXPECTED_RESPONSE'}));process.exitCode=1}
else console.log(JSON.stringify(data))
