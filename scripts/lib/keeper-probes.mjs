export const KEEPER_FETCH_TIMEOUT_MS = 30000
export const KEEPER_TARGET_TIMEOUT_MS = 32000
export const KEEPER_CDP_TIMEOUT_MS = 35000
export const KEEPER_PROBE_BUDGET_MS = 120000

/** Select every matching page so a wedged early target cannot hide a usable tab. */
export function matchingPageTargets(targets, pattern) {
  return targets.filter(tab => tab?.type === 'page' && pattern.test(tab.url || ''))
}

/** Report expiry only from an explicit sign-in/authorization signature. */
export function classifyKeeperProbe({ authenticated = false, expired = false } = {}) {
  if (authenticated) return 'OK'
  return expired ? 'SESSION_EXPIRED' : 'ERROR'
}

export function classifyDealerMailProbe(value) {
  return classifyKeeperProbe({
    authenticated: value?.httpStatus === 200 && !value.sessionEnded && value.hasGrid,
    expired: [401, 403].includes(value?.httpStatus) || value?.sessionEnded || isRecognizedSignInRedirect(value?.finalUrl),
  })
}

export function classifyOasisProbe(value) {
  return classifyKeeperProbe({
    authenticated: value?.httpStatus === 200 && value.oasis && !value.login,
    expired: [401, 403].includes(value?.httpStatus) || value?.login || isRecognizedSignInRedirect(value?.finalUrl),
  })
}

/** Recognize the known Microsoft identity host and its sign-in protocol paths. */
export function isRecognizedSignInRedirect(value) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const identityHost = host === 'login.microsoftonline.com' || host === 'login.windows.net'
    if (!identityHost) return false
    return /^\/(?:common|organizations|consumers|[0-9a-f-]{8,})\/(?:oauth2(?:\/v2\.0)?|login|signin|wsfed|saml2)(?:\/|$)/i.test(url.pathname)
  } catch {
    return false
  }
}

/**
 * Probe a bounded set of targets. Any healthy target wins; a positively expired
 * result is retained only as a fallback after all candidates have been tried.
 */
export async function probeMatchingTargets(targets, probe, classify, {
  budgetMs = KEEPER_PROBE_BUDGET_MS,
  timeoutMs = KEEPER_TARGET_TIMEOUT_MS,
} = {}) {
  let expiredFallback = null
  let lastResult = null
  const deadline = Date.now() + budgetMs
  for (const target of targets) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    const controller = new AbortController()
    const attemptTimeoutMs = Math.min(timeoutMs, remainingMs)
    // A target that consumes the overall budget must not open the next one.
    // Timer resolution can fire the timeout a few milliseconds early, which
    // would otherwise leave a sliver of budget and start another stalled probe.
    const budgetLimited = attemptTimeoutMs < timeoutMs
    let timer
    let result
    try {
      result = await Promise.race([
        probe(target, controller.signal),
        new Promise(resolve => { timer = setTimeout(() => resolve({ probeTimedOut: true }), attemptTimeoutMs) }),
      ])
    } catch (error) {
      result = { probeError: String(error?.message || error).slice(0, 160) }
    } finally {
      clearTimeout(timer)
    }
    if (result?.probeTimedOut) controller.abort()
    const status = result?.probeTimedOut || result?.probeError ? 'ERROR' : classify(result)
    const entry = { target, result, status }
    if (status === 'OK') return entry
    if (status === 'SESSION_EXPIRED') expiredFallback ??= entry
    else lastResult = entry
    if (result?.probeTimedOut && budgetLimited) break
  }
  return expiredFallback ?? lastResult ?? (targets.length ? { status: 'ERROR', result: { probeTimedOut: true } } : null)
}

/** Retry inconclusive existing targets once in a fresh, keeper-owned tab. */
export async function probeServiceTargets(targets, probe, classify, {
  openTarget,
  closeTarget,
  ...limits
} = {}) {
  const run = (tabs, opened = false) => probeMatchingTargets(
    tabs,
    (target, signal) => probe(target, signal, opened),
    classify,
    limits,
  )
  const existing = await run(targets)
  if (!openTarget || existing?.status === 'OK' || existing?.status === 'SESSION_EXPIRED') return existing

  const target = await openTarget()
  let selected
  try {
    selected = await run([target], true)
  } catch (error) {
    await closeTarget?.(target)
    throw error
  }
  // Structured responses retain their target for service-specific renewal.
  // Only failed probes close the tab this attempt owns; existing tabs stay open.
  if (selected?.result?.probeError || selected?.result?.probeTimedOut) await closeTarget?.(target)
  return selected
}
