// invoice-capture-outcome.mjs - pure decision logic for scripts/capture-invoices.mjs.
//
// Two jobs, both side-effect free (no CDP, filesystem or network I/O - that stays in the
// script): read one fordvisions response into a decision, and track whether the per-VIN
// loop should keep going or stop for a systemic reason.
//
// On 2026-09-29 a single VIN's CAPTURE_ERROR stopped 41 queued invoices with 0 processed.
// The policy here is Joe's standing rule: no one vehicle should stop the process. A bad
// response for one VIN is recorded and the loop moves on; only conditions that mean the
// whole capture is broken - a lost fordvisions session, the time budget, or a run of
// consecutive per-vehicle failures that looks like a dead session in disguise - stop it.

const MAX_PDF_BYTES = 8 * 1024 * 1024

// Consecutive per-vehicle failures (not "unavailable" answers - those are legitimate)
// treated as systemic: the SSO handshake can go quietly bad mid-run without ever
// rendering the msal-browser shell, and a streak of raw failures is the tell.
export const CONSECUTIVE_FAILURE_LIMIT = 3

export function isValidPdfBuffer(buf) {
  return buf.length >= 8 && buf.length <= MAX_PDF_BYTES &&
    buf.subarray(0, 5).toString('latin1') === '%PDF-' &&
    buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1').includes('%%EOF')
}

// response is the shape fetchInTab({ binary: true }) returns: { status, error, base64, text }.
// Returns exactly one of:
//   { kind: 'pdf', buf }
//   { kind: 'unavailable', reason }          - a real, terminal answer for this VIN
//   { kind: 'session_expired', reason }      - stop the whole capture
//   { kind: 'failure', reason }              - this VIN only; retry it, keep going
export function classifyInvoiceResponse(response) {
  const { status, error, base64, text } = response || {}
  if (status === 0 || error) return { kind: 'failure', reason: 'FETCH_ERROR' }
  if (status === 401 || status === 403) return { kind: 'session_expired', reason: `HTTP_${status}` }
  if (status !== 200) return { kind: 'failure', reason: `HTTP_${status}` }
  if (base64) {
    const buf = Buffer.from(base64, 'base64')
    return isValidPdfBuffer(buf) ? { kind: 'pdf', buf } : { kind: 'unavailable', reason: 'response was not a PDF' }
  }
  if (/msal-browser/i.test(text || '')) return { kind: 'session_expired', reason: 'SESSION_EXPIRED' }
  const plain = (text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (/not retail/i.test(plain)) return { kind: 'unavailable', reason: 'Document Type is not retail' }
  if (/not found in our system/i.test(plain)) return { kind: 'unavailable', reason: 'The VIN entered was not found in our system.' }
  return { kind: 'failure', reason: 'UNEXPECTED_RESPONSE' }
}

// A thrown exception around the fetch itself (network hiccup, CDP timeout) is the same
// per-vehicle shape as a classified failure - same retry, same consecutive-failure count.
export function classifyCaptureException() {
  return { kind: 'failure', reason: 'CAPTURE_ERROR' }
}

// consecutiveFailures is the count carried in from the previous VIN. `pdf` and
// `unavailable` are resolved answers and reset the streak; `failure` extends it and, at
// CONSECUTIVE_FAILURE_LIMIT, becomes a systemic stop. `session_expired` always stops
// immediately. stoppedReason keeps the underlying reason substring (e.g. FETCH_ERROR) so
// run-inventory-flow-daily.mjs's expired-source regex still catches a session that died
// without ever rendering the msal-browser shell.
//
// stopOnConsecutiveFailures defaults true for the main pass. The retry pass (which is
// built entirely from VINs that already failed once) passes false: a streak there is
// expected, not a sign the session died, so it should never stop the retry early -
// only session_expired or the time budget can still stop it.
export function nextCaptureStep(consecutiveFailures, outcome, { stopOnConsecutiveFailures = true } = {}) {
  if (outcome.kind === 'session_expired') {
    return { action: 'stop', stoppedReason: outcome.reason, consecutiveFailures }
  }
  if (outcome.kind === 'failure') {
    const count = consecutiveFailures + 1
    if (stopOnConsecutiveFailures && count >= CONSECUTIVE_FAILURE_LIMIT) {
      return { action: 'stop', stoppedReason: `CONSECUTIVE_FAILURES:${outcome.reason}`, consecutiveFailures: count }
    }
    return { action: 'continue', consecutiveFailures: count }
  }
  return { action: 'continue', consecutiveFailures: 0 }
}

export function isBudgetExhausted(elapsedMs, budgetMs) {
  return elapsedMs > budgetMs
}

// True for a stoppedReason that means the fordvisions session itself was lost, as
// opposed to a budget cutoff or a streak of per-vehicle failures.
export function isSessionExpiredReason(stoppedReason) {
  return stoppedReason === 'SESSION_EXPIRED' || stoppedReason === 'HTTP_401' || stoppedReason === 'HTTP_403'
}

// sessionStatus for the printed summary.
export function computeSessionStatus({ stoppedReason, anyVinStillFailed }) {
  if (stoppedReason && isSessionExpiredReason(stoppedReason)) return 'session_expired'
  if (stoppedReason || anyVinStillFailed) return 'incomplete'
  return 'ok'
}

// Process exit code: only a systemic stop is a real failure of this step. A run that
// finished the queue with a few isolated, since-retried per-vehicle failures exits 0 so
// run-inventory-flow-daily.mjs's runOptionalAuthenticatedSources reports it as a warning
// (or plain success), not a failure - see its `expired` regex and the optional:true run().
// A systemic stop still exits 1, which that same call site treats as non-blocking.
export function computeExitCode(stoppedReason) {
  return stoppedReason ? 1 : 0
}
