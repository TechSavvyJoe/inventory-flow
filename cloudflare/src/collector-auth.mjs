import { verifyAccess } from './access.mjs'
import { collectorFail, executionEnabled } from './collector-common.mjs'

// Separate audience and registered service identity; never owner/employee auth.
export async function verifyCollectorAccess(request,env) {
 if(!env.ACCESS_COLLECTOR_AUDIENCE || env.ACCESS_COLLECTOR_AUDIENCE===env.ACCESS_AUDIENCE)collectorFail('COLLECTOR_AUTH_REQUIRED',503)
 const claims=await verifyAccess(request,env,env.ACCESS_COLLECTOR_AUDIENCE)
 await collectorIdentity(env,claims,{allowDisabled:new URL(request.url).pathname==='/api/collector/contact'})
 return claims
}
export async function collectorIdentity(env,claims,{allowDisabled=false}={}) {
 if(typeof claims?.common_name!=='string' || !claims.common_name || claims.email)collectorFail('COLLECTOR_AUTH_REQUIRED',403)
 if(!env.PLATFORM_DB)collectorFail('COLLECTOR_UNAVAILABLE',503)
 const row=await env.PLATFORM_DB.prepare('SELECT * FROM platform_collectors WHERE access_client_id=?').bind(claims.common_name).first()
 if(!row)collectorFail('COLLECTOR_AUTH_REQUIRED',403)
 if(row.revoked_at)collectorFail('COLLECTOR_REVOKED',403)
 if(!allowDisabled && (!row.enabled || !executionEnabled(env)))collectorFail('COLLECTOR_DISABLED',403)
 return row
}
