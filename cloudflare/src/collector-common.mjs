import { WorkflowError } from '../../server/workflow.mjs'

export const UNRESOLVED = "'queued','running','reconciliation_required'"
export const ACTIVE_ATTEMPT = "'claimed','captured','publishing','reconciliation_required'"
export const executionEnabled = env => env.PLATFORM_COLLECTOR_EXECUTION_ENABLED === 'true'
export function collectorFail(code,status=422) { throw new WorkflowError(COLLECTOR_MESSAGES[code] ?? 'Collector operation could not be completed.',{code,status}) }
export const COLLECTOR_MESSAGES = {
 COLLECTOR_BASELINE_REQUIRED:'A current same-day verified baseline is required before a hold-only refresh.',
 COLLECTOR_INPUT_INVALID:'Enter supported collector settings only.', COLLECTOR_AUTH_REQUIRED:'An enrolled collector identity is required.',
 COLLECTOR_REVOKED:'This collector was revoked. Ask the software owner to review enrollment.', COLLECTOR_DISABLED:'Collector execution is not enabled.',
 COLLECTOR_SCOPE_MISMATCH:'The registered group, dealerships, sources or installed profile do not match.', COLLECTOR_PROFILE_MISMATCH:'The installed collector profile or adapter version does not match enrollment.',
 COLLECTOR_CONFLICT:'The collector configuration changed. Reload before trying again.', COLLECTOR_LEASE_STALE:'This attempt is no longer authorized. Stop collection and publication.',
 COLLECTOR_RECEIPT_CONFLICT:'This receipt identity already records different evidence.', COLLECTOR_PUBLICATION_UNAVAILABLE:'The verified tenant publication binding is not configured.',
 COLLECTOR_PUBLICATION_INVALID:'The candidate does not match the leased capture, scope or report date.', COLLECTOR_NO_CAPTURE:'Record a validated capture before requesting publication.',
 COLLECTOR_UNAVAILABLE:'Collector storage is unavailable. Check the deployment and migrations.', COLLECTOR_PUBLICATION_UNKNOWN:'Publication may be in flight. Reconcile the exact retained candidate before another attempt.',
 }
export function exactFields(value,allowed) { if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key)))collectorFail('COLLECTOR_INPUT_INVALID') }
export function text(value,max=160) { if(typeof value!=='string' || value.trim()!==value || !value || value.length>max || /[\u0000-\u001f\u007f]/.test(value))collectorFail('COLLECTOR_INPUT_INVALID');return value }
export function sha(value) { if(typeof value!=='string' || !/^[a-f0-9]{64}$/.test(value))collectorFail('COLLECTOR_INPUT_INVALID');return value }
export function integer(value,min=0,max=Number.MAX_SAFE_INTEGER) { if(!Number.isSafeInteger(value) || value<min || value>max)collectorFail('COLLECTOR_INPUT_INVALID');return value }
export function canonical(value) { if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;return JSON.stringify(value) }
export async function digest(value) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('') }
export function stringList(value) { if(!Array.isArray(value) || !value.length || value.length>16 || new Set(value).size!==value.length)collectorFail('COLLECTOR_INPUT_INVALID');return value.map(item=>text(item)).sort() }
export const profileIdentity = row => ({adapterId:row.adapter_id,adapterVersion:row.adapter_version,profileId:row.profile_id,profileSha256:row.profile_sha256})
