// Sign-in alerts for the Windows publisher (Joe, 2026-09-28: "if something
// needs a sign in then send me a notification").
//
// The session keeper calls sendSignInAlert after every check. It posts only
// the names of the sites that need Joe, plus whether the automation browser
// is down, to the owner's OpenClaw webhook, which turns them into a fixed
// iMessage (scripts/openclaw/inventory-signin.mjs). No vehicle, customer,
// cookie or session data is sent.
//
// A newly broken site alerts once; if it is still broken six hours later
// the alert repeats, so a lost text is never silent for long; the moment
// every site reads OK again one all-clear follows. A site whose check merely
// errors keeps its earlier state: an error is not a recovery. The state only
// advances after the gateway confirms it accepted the alert, so a failed
// send retries on the next check.
//
// Configured by two user environment variables on the publisher PC; unset
// means alerts are off. The token unlocks the owner's OpenClaw agent
// webhooks, so treat it like a password:
//   INVENTORY_ALERT_URL    https://<mac>.<tailnet>.ts.net:<port>/hooks/inventory-signin
//   INVENTORY_ALERT_TOKEN  the OpenClaw hooks token (set by Joe, never in Git)
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const ALERT_PROBLEMS = ['browser', 'dealermail', 'fmcdealer', 'fordvisions', 'vauto']
export const REMIND_AFTER_MS = 6 * 60 * 60 * 1000
const SEND_TIMEOUT_MS = 45000

// Only an explicit OK clears a site that was broken before; ERROR, NO_TAB or
// SKIPPED say nothing about the session, so the earlier state stands.
export function signInProblems(status, before = []) {
  const found = new Set()
  if (status?.automationBrowser?.status === 'UNAVAILABLE') found.add('browser')
  for (const name of Array.isArray(status?.expired) ? status.expired : []) found.add(name)
  for (const name of before) {
    const current = name === 'browser' ? status?.automationBrowser?.status : status?.[name]?.status
    if (current !== 'OK') found.add(name)
  }
  return ALERT_PROBLEMS.filter((name) => found.has(name))
}

function readState(statePath) {
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    return Array.isArray(state.problems) ? state : { problems: [] }
  } catch {
    return { problems: [] }
  }
}

function writeState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true })
  const temporary = `${statePath}.tmp`
  writeFileSync(temporary, JSON.stringify(state, null, 2))
  try {
    renameSync(temporary, statePath)
  } catch {
    // A scanner holding the file open blocks the rename on Windows; a direct
    // write still records the send so Joe is not texted again.
    writeFileSync(statePath, JSON.stringify(state, null, 2))
  }
}

export async function sendSignInAlert({ status, statePath, env = process.env, fetchImpl = globalThis.fetch, now = new Date() }) {
  const token = env.INVENTORY_ALERT_TOKEN
  let url
  try {
    url = env.INVENTORY_ALERT_URL ? new URL(env.INVENTORY_ALERT_URL) : null
  } catch {
    return { status: 'refused_bad_url' }
  }
  if (!url || !token) return { status: 'not_configured' }
  if (url.protocol !== 'https:' || url.username || url.password || url.search) return { status: 'refused_bad_url' }

  const previous = readState(statePath)
  const before = previous.problems
  const problems = signInProblems(status, before)
  const newlyBroken = problems.filter((name) => !before.includes(name))
  const lastSent = Date.parse(previous.sentAt ?? '')
  let kind = null
  if (newlyBroken.length) kind = 'needs_sign_in'
  else if (problems.length && !(now - lastSent < REMIND_AFTER_MS)) kind = 'needs_sign_in'
  else if (!problems.length && before.length) kind = 'all_clear'

  if (!kind) {
    // A site recovered while others stay broken: remember it quietly so a
    // later relapse alerts again, without messaging for the partial fix.
    if (problems.join(',') !== before.join(',')) writeState(statePath, { ...previous, problems, updatedAt: now.toISOString() })
    return { status: 'unchanged', problems }
  }

  const payload = { kind, services: problems, host: env.COMPUTERNAME || 'publisher-pc', checkedAt: status?.checkedAt ?? now.toISOString() }
  try {
    const response = await fetchImpl(url.href, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': `${kind}:${problems.join(',')}:${now.toISOString().slice(0, 13)}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    // 204 means the Mac-side transform skipped the alert: nothing was sent.
    if (response.status !== 200) return { status: response.status === 204 ? 'skipped_by_gateway' : 'send_failed', httpStatus: response.status, kind, problems }
    const body = await response.json().catch(() => null)
    if (body?.ok !== true) return { status: 'send_failed', httpStatus: 200, kind, problems }
  } catch (error) {
    return { status: 'send_failed', error: error?.name === 'TimeoutError' ? 'timeout' : String(error?.code || error?.name || 'error'), kind, problems }
  }
  writeState(statePath, { problems, sentAt: now.toISOString(), updatedAt: now.toISOString(), kind })
  return { status: 'sent', kind, problems }
}
