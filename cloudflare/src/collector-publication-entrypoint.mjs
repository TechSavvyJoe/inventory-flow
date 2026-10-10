import { WorkerEntrypoint } from 'cloudflare:workers'
import worker from './worker.mjs'
import { publishTenantCandidate, readTenantPublicationReceipt } from './collector-publication.mjs'

export class CollectorPublication extends WorkerEntrypoint {
 async publish(envelope,authorization) { return publishTenantCandidate(this.env,envelope,authorization) }
 async readReceipt(authorization) { return readTenantPublicationReceipt(this.env,authorization) }
}
export default worker
