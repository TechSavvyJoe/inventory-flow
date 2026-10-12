// Offline-testable recovery and completion policy. All reads, waits and budget
// checks are injected; importing this module never contacts the browser/source.
function sessionExpired(response) {
  return response?.status === 401 || response?.status === 403 ||
    /type=["']?password/i.test(response?.text || '') ||
    /login\.microsoftonline\.com/i.test(response?.text || '') ||
    /login\.microsoftonline\.com|signin|sso/i.test(String(response?.finalUrl || ''))
}

function transportUnavailable(response) {
  return !Number.isInteger(response?.status) || response.status < 100 ||
    response.status > 599 || Boolean(response.error)
}

export async function readOasisWithRecovery(vin, { read, alternateVin, wait, budgetExhausted }) {
  let transportFailures = 0
  const result = (response, stoppedReason = null) => ({ response, transportFailures, stoppedReason })
  const attempt = async (requestedVin) => {
    try { return await read(requestedVin) }
    catch { return { status: 0 } }
  }

  // A status-zero response can be a transient network failure or a CORS-blocked
  // sign-in redirect. Retry once without claiming to know which one occurred.
  for (let attemptNumber = 0; attemptNumber < 2; attemptNumber++) {
    if (budgetExhausted()) return result(null, 'BUDGET_EXHAUSTED')
    const response = await attempt(vin)
    if (sessionExpired(response)) return result(null, 'SESSION_EXPIRED')
    if (!transportUnavailable(response)) return result(response)
    transportFailures++
    if (attemptNumber === 0) {
      if (budgetExhausted()) return result(null, 'BUDGET_EXHAUSTED')
      await wait(2000)
    }
  }

  if (budgetExhausted()) return result(null, 'BUDGET_EXHAUSTED')
  if (alternateVin && alternateVin !== vin) {
    // One fresh diagnostic GET for a different queued VIN can establish that
    // this is an isolated gap. Saved/earlier responses cannot prove this. The
    // diagnostic response is not captured; that VIN keeps its normal attempt.
    const response = await attempt(alternateVin)
    if (sessionExpired(response)) return result(null, 'SESSION_EXPIRED')
    if (!transportUnavailable(response)) return result(null)
    transportFailures++
  }
  return result(null, 'TRANSPORT_UNAVAILABLE')
}

export function oasisCaptureCompletion(state, stoppedReason) {
  return {
    sessionStatus: stoppedReason === 'SESSION_EXPIRED' ? 'session_expired' : stoppedReason ? 'incomplete' : state,
    stoppedReason,
    exitCode: stoppedReason ? 1 : 0,
  }
}
