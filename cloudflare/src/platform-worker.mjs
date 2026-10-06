import { verifyAccess, AccessError } from './access.mjs'
import { WorkflowError } from '../../server/workflow.mjs'
import { platformOwner, readPlatform, savePlatform, readTenantMembers, saveTenantMember } from './platform-admin.mjs'

import { readDataConnections, saveDataControl, readPlatformAudit } from './platform-data.mjs'
import { planScheduledPulls } from './platform-scheduler.mjs'

const HEADERS = {
  'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
}
const json = (status, body) => Response.json(body,{status,headers:HEADERS})
const errorResponse = error => {
  const known = error instanceof AccessError || error instanceof WorkflowError
  return json(known ? error.status : 503,{code:known ? error.code : 'PLATFORM_UNAVAILABLE',error:error instanceof WorkflowError ? error.message : error?.code === 'SOFTWARE_OWNER_REQUIRED' ? 'Software-owner access is required. Sign in with your authorized owner account.' : error instanceof AccessError && error.status < 500 ? error.humanMessage : 'Software administration is unavailable. Check the deployment configuration.'})
}
async function inputJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new WorkflowError('Send a JSON change.',{status:415,code:'JSON_REQUIRED'})
  const reader = request.body?.getReader()
  if (!reader) throw new WorkflowError('A change is required.',{status:400,code:'EMPTY_BODY'})
  let length = 0; const chunks = []
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break
      length += value.byteLength
      if (length > 8192) { await reader.cancel(); throw new WorkflowError('The change is too large.',{status:413,code:'BODY_TOO_LARGE'}) }
      chunks.push(value)
    }
    const data = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) {data.set(chunk,offset);offset += chunk.length}
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)) }
    catch { throw new WorkflowError('Invalid JSON.',{status:400,code:'INVALID_JSON'}) }
  } finally { reader.releaseLock() }
}

// This separate owner-only service adds no employee or source-system writes.
export async function handlePlatformApi(request, env, claims, now = new Date()) {
  try {
    await platformOwner(env.PLATFORM_DB,claims)
    const url = new URL(request.url)
    if (!['GET','POST'].includes(request.method)) throw new WorkflowError('Method not allowed.',{status:405,code:'METHOD_NOT_ALLOWED'})
    if (url.search) throw new WorkflowError('Unsupported query parameters.',{status:400,code:'PLATFORM_INPUT_INVALID'})
    const entity = /^\/api\/platform\/(groups|dealerships|owners)$/.exec(url.pathname)?.[1]
    const members = /^\/api\/platform\/groups\/([a-zA-Z0-9_-]+)\/members$/.exec(url.pathname)
    const connections = /^\/api\/platform\/groups\/([a-zA-Z0-9_-]+)\/(connections|pulls)$/.exec(url.pathname)
    const audit = /^\/api\/platform\/audit\/([a-zA-Z0-9_-]+)$/.exec(url.pathname)
    if (request.method === 'GET') {
      if (url.pathname === '/api/platform') return json(200,await readPlatform(env,claims,now))
      if (audit) return json(200,await readPlatformAudit(env,claims,audit[1]))
      if (connections?.[2] === 'connections') return json(200,await readDataConnections(env,claims,connections[1],now))
      if (members) return json(200,await readTenantMembers(env,claims,members[1]))
      throw new WorkflowError('Route not found.',{status:404,code:'NOT_FOUND'})
    }
    if (!entity && !members && !connections) throw new WorkflowError('Route not found.',{status:404,code:'NOT_FOUND'})
    if (request.headers.get('origin') !== url.origin) throw new AccessError('SAME_ORIGIN_REQUIRED',403)
    const input = await inputJson(request), key = request.headers.get('idempotency-key')
    return json(200, connections ? await saveDataControl(env,claims,connections[1],connections[2],input,key) : members ? await saveTenantMember(env,claims,members[1],input,key) : await savePlatform(env,claims,entity,input,key))
  } catch (error) { return errorResponse(error) }
}

export default {
  async scheduled(controller,env) {
    await planScheduledPulls(env,new Date(controller.scheduledTime))
  },
  async fetch(request,env) {
    try {
      const url = new URL(request.url)
      if (!env.PRIVATE_HOSTNAME || url.hostname !== env.PRIVATE_HOSTNAME) throw new AccessError('PRIVATE_HOST_REQUIRED',403)
      const claims = await verifyAccess(request,env)
      await platformOwner(env.PLATFORM_DB,claims)
      if (url.pathname.startsWith('/api/')) return await handlePlatformApi(request,env,claims)
      if (!['GET','HEAD'].includes(request.method)) return json(405,{code:'METHOD_NOT_ALLOWED'})
      if (url.pathname === '/') return new Response(null,{status:302,headers:{...HEADERS,Location:'/platform'}})
      if (!(url.pathname === '/platform' || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/brand-kit/') || url.pathname === '/favicon.svg')) return json(404,{code:'NOT_FOUND'})
      if (!env.ASSETS) throw new AccessError('PLATFORM_NOT_CONFIGURED',503)
      const asset = await env.ASSETS.fetch(request)
      if (url.pathname !== '/platform' && /^text\/html/i.test(asset.headers.get('content-type') ?? '')) return json(404,{code:'NOT_FOUND'})
      return new Response(asset.body,{status:asset.status,headers:{...Object.fromEntries(asset.headers),...HEADERS}})
    } catch (error) { return errorResponse(error) }
  },
}
