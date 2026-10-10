#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquirePublicationLock, assertInheritedPublicationLock, releasePublicationLock } from './sync-cloud-release.mjs'
import { cloudBundleSha256 } from './publish-cloud-release.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'
import {
  COLLECTOR_ADAPTER_VERSION,
  COLLECTOR_PROFILE_NAME,
  loadCollectorProfile,
  readProtectedCollectorCredentials,
} from './lib/collector-profile.mjs'
import {
  assertClaimMatchesProfile,
  assertBaselineBundleMatchesClaim,
  assertContactMatchesProfile,
  collectorRequest,
  randomIdempotencyKey,
  submitCollectorPublication,
  validateReceiptPayload,
} from './lib/collector-protocol.mjs'
import {
  checkCollectorDependencies,
  cleanupVerifiedAttempt,
  clearPendingClaimIdempotencyKey,
  findPendingPublication,
  getOrCreateClaimIdempotencyKey,
  makeDealerMailCapture,
  persistExactEnvelope,
  privateAttemptArtifacts,
  saveAttemptState,
} from './lib/dealermail-hold-refresh-adapter.mjs'

const OWNER_ID_ENV = 'INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID'
const LOCKED_CODE = 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW'
const SAFE_CODES = new Set([
  'BASELINE_REQUIRED', 'RECONCILIATION_REQUIRED', 'BASELINE_INVALID',
  'ADAPTER_DEPENDENCY_MISSING', 'DEALERMAIL_SESSION_REQUIRED',
  'DEALERMAIL_CAPTURE_FAILED', 'DEALERMAIL_SNAPSHOT_INVALID',
  'PROFILE_MISMATCH', 'PROFILE_SCOPE_MISMATCH', 'LEASE_STOPPED',
  'PUBLICATION_REJECTED', 'PUBLICATION_OUTCOME_UNKNOWN',
  'CREDENTIAL_STORE_MISSING', 'CREDENTIAL_STORE_UNAVAILABLE',
  'CREDENTIAL_STORE_INVALID', 'PROFILE_NOT_INSTALLED', 'PROFILE_INVALID',
  'COLLECTOR_DISCONNECTED', 'LEASE_EXPIRED',
  'COLLECTOR_LEASE_STALE', 'REQUEST_TOO_LARGE', 'ENVELOPE_TOO_LARGE',
  'COLLECTOR_REVOKED', 'COLLECTOR_DISABLED', 'COLLECTOR_SCOPE_MISMATCH',
])

function parseArgs(argv) {
  const [command, ...rest] = argv
  const result = { command, profile: null, remote: false }
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--profile') result.profile = rest[++index]
    else if (rest[index] === '--remote') result.remote = true
    else if (rest[index] === '--help' || rest[index] === '-h') result.help = true
    else throw new Error('UNKNOWN_OPTION')
  }
  if (!result.help && !['doctor', 'run-once', 'daemon'].includes(command)) throw new Error('COMMAND_REQUIRED')
  if (!result.help && !result.profile) throw new Error('PROFILE_REQUIRED')
  if (result.profile && result.profile !== COLLECTOR_PROFILE_NAME) throw new Error('PROFILE_NOT_INSTALLED')
  if (result.remote && command !== 'doctor') throw new Error('UNKNOWN_OPTION')
  return result
}

function reportDateNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function safeCode(error) {
  const code = String(error?.message ?? '')
  if (SAFE_CODES.has(code)) return code
  if (code === 'DEALERMAIL_SNAPSHOT_REJECTED' || code === 'CAPTURE_PROCESS_FAILED' || code === 'CAPTURE_TIMEOUT' || code === 'CAPTURE_OUTPUT_LIMIT') return 'DEALERMAIL_CAPTURE_FAILED'
  if (code === 'CANDIDATE_HASH_MISMATCH' || code === 'RESOURCE_VALIDATION_FAILED' || code === 'RECEIPT_BOUND_SOURCE_VALIDATION_FAILED') return 'BASELINE_INVALID'
  if (code === 'PUBLICATION_RECONCILIATION_REQUIRED' || code === 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN') return 'RECONCILIATION_REQUIRED'
  return 'BASELINE_INVALID'
}

function receiptFailureCode(code) {
  if (['BASELINE_REQUIRED', 'RECONCILIATION_REQUIRED', 'ADAPTER_DEPENDENCY_MISSING', 'PROFILE_SCOPE_MISMATCH'].includes(code)) return code
  if (code === 'DEALERMAIL_SESSION_REQUIRED') return 'NEEDS_SIGN_IN'
  if (code === 'DEALERMAIL_CAPTURE_FAILED') return 'CAPTURE_FAILED'
  if (code === 'LEASE_STOPPED') return 'HOST_IO_FAILED'
  if (code === 'DEALERMAIL_SNAPSHOT_INVALID') return 'CAPTURE_INCOMPLETE'
  return 'VALIDATION_FAILED'
}

function isDefiniteStaleClaim(error) {
  return error?.status === 409 && error?.message === 'COLLECTOR_LEASE_STALE'
}

function isDefinitePreflightAuthorityFailure(error) {
  return (error?.status === 403 && ['COLLECTOR_REVOKED', 'COLLECTOR_DISABLED'].includes(error?.message)) ||
    (error?.status === 409 && error?.message === 'COLLECTOR_SCOPE_MISMATCH')
}

function isDefinitePublicationRejection(error) {
  return error?.status === 409 && new Set([
    'COLLECTOR_PUBLICATION_INVALID', 'COLLECTOR_LEASE_STALE', 'COLLECTOR_NO_CAPTURE',
  ]).has(error.message)
}

function writeSummary(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function assertNoSymlinkDirectory(filePath) {
  const stat = lstatSync(filePath)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PROFILE_INVALID')
}

async function loadRunner(profile) {
  process.env.BOB_MAXEY_WORKSPACE_ROOT = profile.workspaceRoot
  process.env.INVENTORY_WORKSPACE_ROOT = profile.workspaceRoot
  return import('./run-inventory-flow-daily.mjs')
}

function inspectBaseline(profile, reportDate, runnerLoader = loadRunner) {
  const root = profile.workspaceRoot
  for (const name of ['work', 'work/run-status', 'work/app-feed-status', 'outputs', 'apps/inventory-ops']) {
    assertNoSymlinkDirectory(path.join(root, name))
  }
  return runnerLoader(profile).then(({ internals }) => internals.inspectCollectorBaseline(reportDate))
}

function credentialFilesExist(profile) {
  const directory = path.join(profile.workspaceRoot, 'runtime', 'collector', 'credentials')
  const names = [`${profile.credentialRef}.dpapi`, `${profile.releaseKeyRef}.dpapi`]
  return names.every(name => {
    const target = path.join(directory, name)
    try { const stat = lstatSync(target); return stat.isFile() && !stat.isSymbolicLink() } catch { return false }
  })
}

export async function doctor({ profileName, remote = false, profileDirectory, fetchImpl = fetch, credentialReader = readProtectedCollectorCredentials } = {}) {
  const profile = loadCollectorProfile(profileName, { profileDirectory })
  const dependencies = checkCollectorDependencies(profile)
  const reportDate = reportDateNow()
  let baseline = 'unchecked'
  try { await inspectBaseline(profile, reportDate); baseline = 'verified' }
  catch (error) { baseline = safeCode(error) }
  const local = {
    command: 'doctor',
    profileId: profile.profileId,
    credentialRef: profile.credentialRef,
    adapterId: profile.adapterId,
    adapterVersion: profile.adapterVersion,
    profileSha256: profile.profileSha256,
    workspaceReady: true,
    installedDependencies: dependencies.length,
    protectedCredentialsAvailable: credentialFilesExist(profile),
    dealerMailTabOpen: null,
    baseline,
    remote: null,
  }
  if (!remote) return local
  const credentials = credentialReader(profile)
  const response = await collectorRequest(profile, credentials, '/api/collector/contact', {
    body: { profileSha256: profile.profileSha256, adapterVersion: COLLECTOR_ADAPTER_VERSION },
    fetchImpl,
  })
  const contact = assertContactMatchesProfile(response.body, profile)
  return {
    ...local,
    remote: {
      connected: contact.connected,
      enabled: contact.enabled === true,
      executionEnabled: contact.executionEnabled === true,
      profileMatches: true,
      checkedAt: contact.checkedAt,
    },
  }
}

async function acquireRunnerLock(profile) {
  const lockPath = path.join(profile.workspaceRoot, 'work', 'app-feed-status', '.publication.lock')
  const previousOwner = process.env[OWNER_ID_ENV]
  let lock = null
  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 })
  const inherited = assertInheritedPublicationLock(lockPath)
  if (!inherited) {
    lock = acquirePublicationLock(lockPath)
    process.env[OWNER_ID_ENV] = JSON.parse(lock.content).ownerId
  }
  return {
    lock,
    release() {
      if (previousOwner === undefined) delete process.env[OWNER_ID_ENV]
      else process.env[OWNER_ID_ENV] = previousOwner
      if (lock) releasePublicationLock(lock)
    },
  }
}

function heartbeatLoop({ profile, credentials, claim, fetchImpl, abortController, intervalMs = 30_000 }) {
  let running = false
  let stopped = false
  const heartbeat = async () => {
    if (running || stopped) return
    running = true
    try {
      const response = await collectorRequest(profile, credentials, '/api/collector/heartbeat', {
        body: { attemptId: claim.attemptId, fence: claim.fence, profileSha256: profile.profileSha256, adapterVersion: COLLECTOR_ADAPTER_VERSION },
        fetchImpl,
        signal: AbortSignal.timeout(25_000),
      })
      if (response.body?.continue !== true || !response.body?.leaseUntil || !Number.isFinite(Date.parse(response.body.leaseUntil)) || Date.parse(response.body.leaseUntil) <= Date.now()) {
        stopped = true
        abortController.abort()
      }
    } catch {
      stopped = true
      abortController.abort()
    } finally { running = false }
  }
  const timer = setInterval(heartbeat, intervalMs)
  const hardDeadline = Math.max(0, Date.parse(claim.hardDeadline) - Date.now())
  const deadlineTimer = setTimeout(() => { stopped = true; abortController.abort() }, hardDeadline)
  return {
    stop() { clearInterval(timer); clearTimeout(deadlineTimer); stopped = true },
    get stopped() { return stopped },
  }
}

async function postCaptureReceipt(profile, credentials, claim, stage, fetchImpl, signal) {
  const payload = validateReceiptPayload({
    attemptId: claim.attemptId,
    fence: claim.fence,
    sequence: 1,
    kind: 'capture',
    capturedAt: stage.capturedAt,
    sourceSha256: stage.sourceSha256,
    counts: { dealerMailRows: stage.dealerMailRows },
  })
  return collectorRequest(profile, credentials, '/api/collector/receipts', { body: payload, fetchImpl, signal })
}

async function postFailureReceipt(profile, credentials, claim, code, fetchImpl, sequence = 1, acknowledgementRequired = false) {
  const payload = validateReceiptPayload({
    attemptId: claim.attemptId,
    fence: claim.fence,
    sequence,
    kind: 'failure',
    code: receiptFailureCode(code),
  })
  const request = collectorRequest(profile, credentials, '/api/collector/receipts', { body: payload, fetchImpl })
  if (!acknowledgementRequired) return request.catch(() => null)
  const response = await request
  if (response.body?.saved !== true) throw new Error('COLLECTOR_RESPONSE_INVALID')
  return response
}

function ensureCandidateState(profile, claim, stage, envelope) {
  const artifacts = privateAttemptArtifacts(profile.workspaceRoot, claim.attemptId)
  const priorState = existsSync(artifacts.statePath) ? JSON.parse(readFileSync(artifacts.statePath, 'utf8')) : {}
  const publicationIdempotencyKey = priorState.publicationIdempotencyKey ?? randomIdempotencyKey()
  const safe = saveAttemptState(artifacts.statePath, {
    ...priorState,
    attemptId: claim.attemptId,
    fence: claim.fence,
    reportDate: claim.reportDate,
    profileSha256: profile.profileSha256,
    configSha256: claim.configSha256,
    baselineBundleSha256: claim.baselineBundleSha256,
    capturedAt: stage.capturedAt,
    sourceSha256: stage.sourceSha256,
    bundleSha256: envelope.bundleSha256,
    dealerMailRows: stage.dealerMailRows,
    captureReceiptSent: priorState.captureReceiptSent === true,
    captureReceiptPending: priorState.captureReceiptPending === true,
    publicationPending: priorState.publicationPending === true,
    reconciliationRequired: priorState.reconciliationRequired === true,
    publicationIdempotencyKey,
  })
  return { artifacts, state: safe }
}

async function runClaimedAttempt(profile, credentials, claim, {
  fetchImpl = fetch, signal, runnerLoader = loadRunner, captureFactory = makeDealerMailCapture,
  promotion = (runner, values) => runner.internals.promoteVerifiedCollectorCandidate(values),
  now = () => new Date(),
} = {}) {
  const abortController = new AbortController()
  const onAbort = () => abortController.abort()
  if (signal?.aborted) abortController.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  const heartbeat = heartbeatLoop({ profile, credentials, claim, fetchImpl, abortController })
  const claimStartedAt = now().getTime()
  let stage
  let publicationRequestStarted = false
  try {
    const artifacts = privateAttemptArtifacts(profile.workspaceRoot, claim.attemptId)
    const existing = ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath', 'statePath'].map(key => existsSync(artifacts[key]))
    if (existing.some(Boolean) && !existing.every(Boolean)) throw new Error('RECONCILIATION_REQUIRED')
    let savedEnvelope
    let state
    if (existing.every(Boolean)) {
      state = JSON.parse(readFileSync(artifacts.statePath, 'utf8'))
      savedEnvelope = JSON.parse(readFileSync(artifacts.envelopePath, 'utf8'))
      const candidate = JSON.parse(readFileSync(artifacts.candidatePath, 'utf8'))
      if (state.attemptId !== claim.attemptId || state.fence !== claim.fence || state.reportDate !== claim.reportDate ||
          state.profileSha256 !== profile.profileSha256 || state.configSha256 !== claim.configSha256 ||
          candidate.reportDate !== claim.reportDate || cloudBundleSha256(candidate) !== state.bundleSha256 ||
          state.bundleSha256 !== savedEnvelope.bundleSha256 || savedEnvelope.bundleSha256 !== cloudBundleSha256(candidate)) {
        throw new Error('RECONCILIATION_REQUIRED')
      }
      validateReleaseBundle(candidate)
      stage = {
        capturedAt: state.capturedAt,
        sourceSha256: state.sourceSha256,
        dealerMailRows: state.dealerMailRows,
        bundleSha256: state.bundleSha256,
        candidatePath: artifacts.candidatePath,
        candidateManifestPath: artifacts.manifestPath,
        candidateDealerMailPath: artifacts.dealerMailPath,
        reportDate: state.reportDate,
      }
    } else {
      const runner = await runnerLoader(profile)
      const baseline = await runner.internals.inspectCollectorBaseline(claim.reportDate)
      assertBaselineBundleMatchesClaim(claim, baseline.receipt)
      const captureDealerMail = captureFactory(profile, { signal: abortController.signal })
      stage = await runner.internals.stageIntradayHoldRefreshCandidate({
        reportDate: claim.reportDate,
        attemptId: claim.attemptId,
        baselineBundleSha256: claim.baselineBundleSha256,
        captureDealerMail,
      })
      if (!Number.isFinite(Date.parse(stage.capturedAt)) || Date.parse(stage.capturedAt) < claimStartedAt) {
        throw new Error('DEALERMAIL_SNAPSHOT_INVALID')
      }
      if (heartbeat.stopped || abortController.signal.aborted) throw new Error('LEASE_STOPPED')
      const candidate = JSON.parse(readFileSync(stage.candidatePath, 'utf8'))
      const { encryptBundle, base64Key } = await import('./publish-cloud-release.mjs')
      const candidateEnvelope = encryptBundle(candidate, base64Key(credentials.releaseEncryptionKeyBase64))
      if (candidateEnvelope.bundleSha256 !== stage.bundleSha256) throw new Error('CANDIDATE_HASH_MISMATCH')
      savedEnvelope = persistExactEnvelope(artifacts.envelopePath, candidateEnvelope)
      state = ensureCandidateState(profile, claim, stage, savedEnvelope).state
    }
    if (state.captureReceiptSent !== true) {
      state = saveAttemptState(artifacts.statePath, { ...state, captureReceiptPending: true })
      await postCaptureReceipt(profile, credentials, claim, stage, fetchImpl, abortController.signal)
      state = saveAttemptState(artifacts.statePath, { ...state, captureReceiptSent: true, captureReceiptPending: false })
    }

    state = saveAttemptState(artifacts.statePath, { ...state, publicationPending: true, reconciliationRequired: false })
    const publication = {
      attemptId: claim.attemptId,
      fence: claim.fence,
      configSha256: claim.configSha256,
      envelope: savedEnvelope,
      idempotencyKey: state.publicationIdempotencyKey,
    }
    let result
    try {
      if (abortController.signal.aborted) throw new Error('LEASE_STOPPED')
      result = await submitCollectorPublication(profile, credentials, publication, {
        fetchImpl, signal: abortController.signal, onRequestStarted: () => { publicationRequestStarted = true },
      })
    } catch (firstError) {
      // Local request validation (including the complete wrapper size check)
      // happens before onRequestStarted. It is a definite failure, so retain
      // and report that error instead of turning it into an unknown outcome.
      if (!publicationRequestStarted) throw firstError
      if (abortController.signal.aborted) throw new Error('LEASE_STOPPED')
      if (isDefinitePublicationRejection(firstError)) throw firstError
      // A retry uses the same encrypted envelope, attempt/fence and idempotency
      // key. The platform resolves its tenant receipt; no candidate is rebuilt.
      try { result = await submitCollectorPublication(profile, credentials, publication, {
        fetchImpl, signal: abortController.signal, onRequestStarted: () => { publicationRequestStarted = true },
      }) }
      catch { throw new Error('PUBLICATION_OUTCOME_UNKNOWN', { cause: firstError }) }
    }
    if (result.status === 'rejected_verified') {
      cleanupVerifiedAttempt(artifacts)
      return { status: 'failed', attemptId: claim.attemptId, code: result.code }
    }
    if (result.status === 'reconciliation_required') {
      saveAttemptState(artifacts.statePath, { ...state, publicationPending: true, reconciliationRequired: true })
      return { status: 'reconciliation_required', attemptId: claim.attemptId, bundleSha256: savedEnvelope.bundleSha256 }
    }
    if (result.status === 'preflight_retryable' || result.status === 'revision_retryable') {
      saveAttemptState(artifacts.statePath, { ...state, publicationPending: true, reconciliationRequired: false, preflightRetryable: result.status === 'preflight_retryable', revisionRetryable: result.status === 'revision_retryable' })
      return { status: result.status, attemptId: claim.attemptId, bundleSha256: savedEnvelope.bundleSha256 }
    }
    if (result.status !== 'published_verified' && result.status !== 'unchanged_verified') throw new Error('RECONCILIATION_REQUIRED')
    const promotionRunner = await runnerLoader(profile)
    const stagedCandidate = stage ?? {
      candidatePath: artifacts.candidatePath,
      candidateManifestPath: artifacts.manifestPath,
      candidateDealerMailPath: artifacts.dealerMailPath,
      sourceSha256: state.sourceSha256,
      bundleSha256: state.bundleSha256,
      reportDate: state.reportDate,
      dealerMailRows: state.dealerMailRows,
      capturedAt: state.capturedAt,
    }
    try {
      await promotion(promotionRunner, { profile, claim, candidate: stagedCandidate, verification: result })
    } catch { throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED') }
    cleanupVerifiedAttempt(artifacts)
    return { status: result.status, attemptId: claim.attemptId, bundleSha256: savedEnvelope.bundleSha256, counts: result.counts }
  } catch (error) {
    const code = safeCode(error)
    if (publicationRequestStarted && isDefinitePublicationRejection(error)) {
      cleanupVerifiedAttempt(privateAttemptArtifacts(profile.workspaceRoot, claim.attemptId))
      return { status: 'failed', attemptId: claim.attemptId, code }
    }
    if (!publicationRequestStarted && isDefiniteStaleClaim(error)) {
      try { cleanupVerifiedAttempt(privateAttemptArtifacts(profile.workspaceRoot, claim.attemptId)) }
      catch { return { status: 'reconciliation_required', attemptId: claim.attemptId, code: 'RECONCILIATION_REQUIRED' } }
      return { status: 'retry_fresh_claim', attemptId: claim.attemptId, code: 'COLLECTOR_LEASE_STALE' }
    }
    if (claim.attemptId && claim.fence && code !== 'PUBLICATION_OUTCOME_UNKNOWN' && code !== 'RECONCILIATION_REQUIRED') {
      let savedState = null
      try {
        const artifacts = privateAttemptArtifacts(profile.workspaceRoot, claim.attemptId)
        if (existsSync(artifacts.statePath)) savedState = JSON.parse(readFileSync(artifacts.statePath, 'utf8'))
      } catch { /* The failure receipt below remains the bounded recovery signal. */ }
      if (savedState?.captureReceiptPending && !publicationRequestStarted) {
        return { status: 'capture_receipt_pending', attemptId: claim.attemptId }
      }
      if (!publicationRequestStarted) await postFailureReceipt(profile, credentials, claim, code, fetchImpl, savedState?.captureReceiptSent ? 2 : 1)
    }
    if (publicationRequestStarted || code === 'PUBLICATION_OUTCOME_UNKNOWN' || code === 'RECONCILIATION_REQUIRED') {
      try {
        const artifacts = privateAttemptArtifacts(profile.workspaceRoot, claim.attemptId)
        if (existsSync(artifacts.statePath)) {
          const state = JSON.parse(readFileSync(artifacts.statePath, 'utf8'))
          saveAttemptState(artifacts.statePath, { ...state, publicationPending: true, reconciliationRequired: true })
        }
      } catch { /* Keep the original unknown outcome; the exact candidate remains untouched. */ }
      return { status: 'reconciliation_required', attemptId: claim.attemptId, code }
    }
    try { cleanupVerifiedAttempt(privateAttemptArtifacts(profile.workspaceRoot, claim.attemptId)) } catch { /* Best-effort removal only after a definite failure. */ }
    return { status: 'failed', attemptId: claim.attemptId, code }
  } finally { heartbeat.stop(); signal?.removeEventListener('abort', onAbort) }
}

async function reconcilePendingPublication(profile, credentials, pending, fetchImpl, signal, { runnerLoader = loadRunner, promotion = (runner, values) => runner.internals.promoteVerifiedCollectorCandidate(values) } = {}) {
  const { artifacts, candidate, envelope } = pending
  let state = pending.state
  let retryableNoPublicationProof = state.preflightRetryable === true || state.revisionRetryable === true
  // A later local rejection cannot settle a publication whose earlier reply
  // was lost. Snapshot that durable uncertainty before marking this request.
  const priorPublicationUnknown = !retryableNoPublicationProof &&
    (state.publicationPending === true || state.reconciliationRequired === true)
  let publicationRequestStarted = false
  if (state.attemptId !== path.basename(artifacts.statePath, '.state.json') ||
      state.profileSha256 !== profile.profileSha256 || !Number.isSafeInteger(state.fence) || state.fence < 1 ||
      !/^[a-f0-9]{64}$/.test(state.configSha256 ?? '') || !/^[A-Za-z0-9_-]{20,80}$/.test(state.publicationIdempotencyKey ?? '') ||
      candidate.reportDate !== state.reportDate || envelope.reportDate !== state.reportDate ||
      cloudBundleSha256(candidate) !== state.bundleSha256 || envelope.bundleSha256 !== state.bundleSha256) {
    return { status: 'reconciliation_required', attemptId: state.attemptId, code: 'RECONCILIATION_REQUIRED' }
  }
  try {
    validateReleaseBundle(candidate)
    if (state.captureReceiptSent !== true) {
      const stage = { capturedAt: state.capturedAt, sourceSha256: state.sourceSha256, dealerMailRows: state.dealerMailRows }
      state = saveAttemptState(artifacts.statePath, { ...state, captureReceiptPending: true })
      await postCaptureReceipt(profile, credentials, { attemptId: state.attemptId, fence: state.fence }, stage, fetchImpl, signal)
      state = saveAttemptState(artifacts.statePath, { ...state, captureReceiptPending: false, captureReceiptSent: true })
    }
    retryableNoPublicationProof = state.preflightRetryable === true || state.revisionRetryable === true
    state = saveAttemptState(artifacts.statePath, { ...state, publicationPending: true, reconciliationRequired: true, preflightRetryable: false, revisionRetryable: false })
    const result = await submitCollectorPublication(profile, credentials, {
      attemptId: state.attemptId,
      fence: state.fence,
      configSha256: state.configSha256,
      envelope,
      idempotencyKey: state.publicationIdempotencyKey,
    }, { fetchImpl, signal, onRequestStarted: () => { publicationRequestStarted = true } })
    if (result.status === 'rejected_verified') {
      cleanupVerifiedAttempt(artifacts)
      clearPendingClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256, getOrCreateClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256))
      return { status: 'failed', attemptId: state.attemptId, code: result.code }
    }
    if (result.status === 'preflight_retryable' || result.status === 'revision_retryable') {
      state = saveAttemptState(artifacts.statePath, { ...state, publicationPending: true, reconciliationRequired: false, preflightRetryable: result.status === 'preflight_retryable', revisionRetryable: result.status === 'revision_retryable' })
      return { status: result.status, attemptId: state.attemptId, bundleSha256: state.bundleSha256 }
    }
    if (result.status === 'reconciliation_required') {
      saveAttemptState(artifacts.statePath, { ...state, publicationPending: true, reconciliationRequired: true })
      return { status: 'reconciliation_required', attemptId: state.attemptId, bundleSha256: state.bundleSha256 }
    }
    if (result.status !== 'published_verified' && result.status !== 'unchanged_verified') throw new Error('RECONCILIATION_REQUIRED')
    const runner = await runnerLoader(profile)
    await promotion(runner, {
      profile,
      claim: { attemptId: state.attemptId, fence: state.fence, reportDate: state.reportDate, baselineBundleSha256: state.baselineBundleSha256 },
      candidate: {
        candidatePath: artifacts.candidatePath,
        candidateManifestPath: artifacts.manifestPath,
        candidateDealerMailPath: artifacts.dealerMailPath,
        sourceSha256: state.sourceSha256,
        bundleSha256: state.bundleSha256,
        reportDate: state.reportDate,
        dealerMailRows: state.dealerMailRows,
        capturedAt: state.capturedAt,
      },
      verification: result,
    })
    cleanupVerifiedAttempt(artifacts)
    return { status: result.status, attemptId: state.attemptId, bundleSha256: state.bundleSha256, counts: result.counts }
  } catch (error) {
    if (!priorPublicationUnknown && (isDefiniteStaleClaim(error) ||
        (retryableNoPublicationProof && isDefinitePreflightAuthorityFailure(error)))) {
      try {
        cleanupVerifiedAttempt(artifacts)
        const claimKey = getOrCreateClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256)
        clearPendingClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256, claimKey)
        if (isDefiniteStaleClaim(error)) return { status: 'retry_fresh_claim', attemptId: state.attemptId, code: 'COLLECTOR_LEASE_STALE' }
        return { status: 'failed', attemptId: state.attemptId, code: error.message }
      } catch {
        return { status: 'reconciliation_required', attemptId: state.attemptId, code: 'RECONCILIATION_REQUIRED' }
      }
    }
    if (!priorPublicationUnknown && publicationRequestStarted && isDefinitePublicationRejection(error)) {
      try {
        cleanupVerifiedAttempt(artifacts)
        clearPendingClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256, getOrCreateClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256))
        return { status: 'failed', attemptId: state.attemptId, code: safeCode(error) }
      } catch {
        return { status: 'reconciliation_required', attemptId: state.attemptId, code: 'RECONCILIATION_REQUIRED' }
      }
    }
    if (state.captureReceiptSent !== true) {
      try { saveAttemptState(artifacts.statePath, { ...state, captureReceiptPending: true, publicationPending: false, reconciliationRequired: false }) } catch {}
      return { status: 'capture_receipt_pending', attemptId: state.attemptId }
    }
    if (!priorPublicationUnknown && !publicationRequestStarted &&
        !['RECONCILIATION_REQUIRED', 'PUBLICATION_OUTCOME_UNKNOWN'].includes(safeCode(error))) {
      const code = safeCode(error)
      try { await postFailureReceipt(profile, credentials, { attemptId: state.attemptId, fence: state.fence }, code, fetchImpl, 2, true) }
      catch {
        // No publication was dispatched, but a lost failure-receipt reply may
        // leave the control-plane capture active. Preserve it for exact replay.
        try { saveAttemptState(artifacts.statePath, { ...state, publicationPending: false, reconciliationRequired: false }) } catch {}
        return { status: 'failure_receipt_pending', attemptId: state.attemptId, code }
      }
      try { cleanupVerifiedAttempt(artifacts) }
      catch { return { status: 'reconciliation_required', attemptId: state.attemptId, code: 'RECONCILIATION_REQUIRED' } }
      return { status: 'failed', attemptId: state.attemptId, code }
    }
    try { saveAttemptState(artifacts.statePath, { ...state, publicationPending: true, reconciliationRequired: true }) } catch {}
    return { status: 'reconciliation_required', attemptId: state.attemptId, code: 'PUBLICATION_OUTCOME_UNKNOWN' }
  }
}

export async function runOnce({
  profileName, profileDirectory, fetchImpl = fetch, credentialReader = readProtectedCollectorCredentials, signal,
  runnerLoader = loadRunner, captureFactory = makeDealerMailCapture,
  promotion = (runner, values) => runner.internals.promoteVerifiedCollectorCandidate(values),
  now = () => new Date(),
} = {}) {
  const profile = loadCollectorProfile(profileName, { profileDirectory })
  checkCollectorDependencies(profile)
  const reportDate = reportDateNow(now())
  let pending
  try { pending = findPendingPublication(profile.workspaceRoot) }
  catch { return { status: 'blocked', code: 'RECONCILIATION_REQUIRED' } }
  if (!pending) {
    try { await inspectBaseline(profile, reportDate, runnerLoader) }
    catch (error) { return { status: 'blocked', code: safeCode(error) } }
  }
  const credentials = credentialReader(profile)
  const contactResponse = await collectorRequest(profile, credentials, '/api/collector/contact', {
    body: { profileSha256: profile.profileSha256, adapterVersion: COLLECTOR_ADAPTER_VERSION },
    fetchImpl,
    signal,
  })
  const contact = assertContactMatchesProfile(contactResponse.body, profile)
  if (contact.connected !== true) return { status: 'blocked', code: 'COLLECTOR_DISCONNECTED' }
  if (contact.enabled !== true || contact.executionEnabled !== true) return { status: 'disabled', checkedAt: contact.checkedAt }
  const lock = await acquireRunnerLock(profile)
  try {
    if (signal?.aborted) return { status: 'stopped' }
    if (pending) {
      const outcome = await reconcilePendingPublication(profile, credentials, pending, fetchImpl, signal, { runnerLoader, promotion })
      if (outcome.status !== 'retry_fresh_claim') return outcome
      pending = null
    }
    let baseline
    try { baseline = await inspectBaseline(profile, reportDate, runnerLoader) }
    catch (error) { return { status: 'blocked', code: safeCode(error) } }
    for (let staleRetries = 0; staleRetries <= 2; staleRetries += 1) {
      const idempotencyKey = getOrCreateClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256)
      let claimResponse
      try { claimResponse = await collectorRequest(profile, credentials, '/api/collector/claim', { body: {}, idempotencyKey, fetchImpl, signal }) }
      catch (error) {
        if (isDefiniteStaleClaim(error)) {
          clearPendingClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256, idempotencyKey)
          if (staleRetries < 2) continue
          return { status: 'blocked', code: 'LEASE_EXPIRED' }
        }
        return signal?.aborted ? { status: 'stopped' } : { status: 'blocked', code: safeCode(error) }
      }
      if (claimResponse.status === 204) {
        clearPendingClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256, idempotencyKey)
        return { status: 'idle' }
      }
      const claim = assertClaimMatchesProfile(claimResponse.body, profile, now(), contact.scopeSha256)
      try { assertBaselineBundleMatchesClaim(claim, baseline.receipt) }
      catch {
        await postFailureReceipt(profile, credentials, claim, 'BASELINE_REQUIRED', fetchImpl)
        clearPendingClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256, idempotencyKey)
        return { status: 'blocked', code: 'BASELINE_REQUIRED' }
      }
      if (signal?.aborted) return { status: 'stopped' }
      const outcome = await runClaimedAttempt(profile, credentials, claim, { fetchImpl, signal, runnerLoader, captureFactory, promotion, now })
      clearPendingClaimIdempotencyKey(profile.workspaceRoot, profile.profileSha256, idempotencyKey)
      if (outcome.status === 'retry_fresh_claim' && staleRetries < 2) continue
      if (outcome.status === 'retry_fresh_claim') return { status: 'blocked', code: 'LEASE_EXPIRED' }
      return outcome
    }
    return { status: 'blocked', code: 'LEASE_EXPIRED' }
  } finally { lock.release() }
}

export async function runDaemon({ profileName, profileDirectory, fetchImpl = fetch, credentialReader = readProtectedCollectorCredentials, pollIntervalMs = 30_000, signal } = {}) {
  const outcomes = []
  while (!signal?.aborted) {
    let outcome
    try { outcome = await runOnce({ profileName, profileDirectory, fetchImpl, credentialReader, signal }) }
    catch (error) { outcome = { status: 'error', code: safeCode(error) } }
    outcomes.push(outcome)
    if (outcomes.length > 100) outcomes.shift()
    writeSummary(outcome)
    if (signal?.aborted) break
    await new Promise(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, pollIntervalMs)
      signal?.addEventListener('abort', finish, { once: true })
      if (signal?.aborted) finish()
    })
  }
  return outcomes
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write('Usage: node scripts/collector-host.mjs doctor|run-once|daemon --profile group-dealermail-v1 [--remote]\n')
    return 0
  }
  if (options.command === 'doctor') {
    writeSummary(await doctor({ profileName: options.profile, remote: options.remote }))
    return 0
  }
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    if (options.command === 'run-once') { writeSummary(await runOnce({ profileName: options.profile, signal: controller.signal })); return 0 }
    await runDaemon({ profileName: options.profile, signal: controller.signal })
    return 0
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop) }
}

export const collectorHostInternals = Object.freeze({
  parseArgs,
  reportDateNow,
  safeCode,
  heartbeatLoop,
  postCaptureReceipt,
  postFailureReceipt,
  ensureCandidateState,
  reconcilePendingPublication,
  receiptFailureCode,
  isDefiniteStaleClaim,
  acquireRunnerLock,
})

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then(code => { process.exitCode = code }).catch(error => {
    const code = safeCode(error)
    writeSummary({ status: 'error', code })
    process.exitCode = 1
  })
}
