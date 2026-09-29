// Pure decision logic for scripts/capture-invoices.mjs (no CDP, no filesystem, no network):
// how one fordvisions response is read, and when the per-VIN loop stops instead of moving
// on to the next VIN. Regression coverage for 2026-09-29, when a single VIN's exception
// stopped 41 queued invoices with 0 processed - Joe's standing rule is that no one vehicle
// stops the process.
import { describe, expect, it } from 'vitest'
// @ts-expect-error Pure decision module runs directly in Node ESM without frontend declarations.
import { CONSECUTIVE_FAILURE_LIMIT, classifyCaptureException, classifyInvoiceResponse, computeExitCode, computeSessionStatus, isBudgetExhausted, isSessionExpiredReason, isValidPdfBuffer, nextCaptureStep } from '../../scripts/lib/invoice-capture-outcome.mjs'

const pdfBuffer = (body = 'synthetic invoice body') => Buffer.from(`%PDF-1.4\n${body}\n%%EOF\n`)
const toBase64 = (buf: Buffer) => buf.toString('base64')

describe('classifyInvoiceResponse', () => {
  it('accepts a well-formed PDF payload', () => {
    const buf = pdfBuffer()
    const outcome = classifyInvoiceResponse({ status: 200, base64: toBase64(buf) })
    expect(outcome.kind).toBe('pdf')
    expect(outcome.buf).toEqual(buf)
  })

  it('treats a 200 with non-PDF bytes as a resolved unavailable answer, not a failure', () => {
    const outcome = classifyInvoiceResponse({ status: 200, base64: toBase64(Buffer.from('not a pdf at all')) })
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'response was not a PDF' })
  })

  it('reads the two known fordvisions "no document" messages as unavailable, not a failure', () => {
    const notRetail = classifyInvoiceResponse({ status: 200, text: '<html><body>Document Type is Not Retail</body></html>' })
    expect(notRetail).toEqual({ kind: 'unavailable', reason: 'Document Type is not retail' })
    const notFound = classifyInvoiceResponse({ status: 200, text: '<p>The VIN entered was Not Found in our system.</p>' })
    expect(notFound).toEqual({ kind: 'unavailable', reason: 'The VIN entered was not found in our system.' })
  })

  it('reads the msal-browser shell as a lost session, distinct from a per-vehicle failure', () => {
    const outcome = classifyInvoiceResponse({ status: 200, text: '<script src="msal-browser.min.js"></script>' })
    expect(outcome).toEqual({ kind: 'session_expired', reason: 'SESSION_EXPIRED' })
  })

  it('reads HTTP 401 and 403 as a lost session', () => {
    expect(classifyInvoiceResponse({ status: 401, text: '' })).toEqual({ kind: 'session_expired', reason: 'HTTP_401' })
    expect(classifyInvoiceResponse({ status: 403, text: '' })).toEqual({ kind: 'session_expired', reason: 'HTTP_403' })
  })

  it('reads a network-level failure as a per-vehicle failure', () => {
    expect(classifyInvoiceResponse({ status: 0, error: 'TypeError: Failed to fetch' })).toEqual({ kind: 'failure', reason: 'FETCH_ERROR' })
    expect(classifyInvoiceResponse({ status: 0 })).toEqual({ kind: 'failure', reason: 'FETCH_ERROR' })
  })

  it('reads any other non-200 status as a per-vehicle failure, named by status', () => {
    expect(classifyInvoiceResponse({ status: 500, text: 'server error' })).toEqual({ kind: 'failure', reason: 'HTTP_500' })
  })

  it('reads unrecognised 200 text as a per-vehicle failure instead of silently dropping the VIN', () => {
    const outcome = classifyInvoiceResponse({ status: 200, text: '<p>Something fordvisions has never said before</p>' })
    expect(outcome).toEqual({ kind: 'failure', reason: 'UNEXPECTED_RESPONSE' })
  })
})

describe('isValidPdfBuffer', () => {
  it('rejects a truncated or oversized buffer', () => {
    expect(isValidPdfBuffer(Buffer.from('%PDF-1.4\nno trailer'))).toBe(false)
    expect(isValidPdfBuffer(pdfBuffer())).toBe(true)
    expect(isValidPdfBuffer(Buffer.concat([pdfBuffer(), Buffer.alloc(9 * 1024 * 1024)]))).toBe(false)
  })
})

describe('classifyCaptureException', () => {
  it('is the same failure shape as a classified failure response', () => {
    expect(classifyCaptureException()).toEqual({ kind: 'failure', reason: 'CAPTURE_ERROR' })
  })
})

describe('nextCaptureStep - the 2026-09-29 regression', () => {
  it('never stops the loop for a single per-vehicle failure', () => {
    const outcome = classifyInvoiceResponse({ status: 0, error: 'boom' })
    const step = nextCaptureStep(0, outcome)
    expect(step).toEqual({ action: 'continue', consecutiveFailures: 1 })
  })

  it('stops only once failures reach CONSECUTIVE_FAILURE_LIMIT in a row', () => {
    const outcome = classifyInvoiceResponse({ status: 0, error: 'boom' })
    let state: { action: string; consecutiveFailures: number; stoppedReason?: string } = { action: 'continue', consecutiveFailures: 0 }
    for (let i = 0; i < CONSECUTIVE_FAILURE_LIMIT - 1; i += 1) {
      state = nextCaptureStep(state.consecutiveFailures, outcome)
      expect(state.action).toBe('continue')
    }
    state = nextCaptureStep(state.consecutiveFailures, outcome)
    expect(state.action).toBe('stop')
    expect(state.stoppedReason).toBe('CONSECUTIVE_FAILURES:FETCH_ERROR')
  })

  it('keeps FETCH_ERROR in the stopped reason so the daily runner sign-in warning still matches', () => {
    const outcome = classifyInvoiceResponse({ status: 0, error: 'boom' })
    let count = 0
    let step
    for (let i = 0; i < CONSECUTIVE_FAILURE_LIMIT; i += 1) { step = nextCaptureStep(count, outcome); count = step.consecutiveFailures }
    expect(step!.stoppedReason).toMatch(/session_expired|FETCH_ERROR/i)
  })

  it('resets the streak on a resolved answer (pdf or unavailable), not just on success', () => {
    const failure = classifyInvoiceResponse({ status: 0, error: 'boom' })
    const unavailable = classifyInvoiceResponse({ status: 200, text: 'Document Type is Not Retail' })
    let step = nextCaptureStep(0, failure)
    step = nextCaptureStep(step.consecutiveFailures, failure)
    expect(step.consecutiveFailures).toBe(2)
    step = nextCaptureStep(step.consecutiveFailures, unavailable)
    expect(step).toEqual({ action: 'continue', consecutiveFailures: 0 })
  })

  it('stops immediately on a lost session, regardless of the current streak', () => {
    const expired = classifyInvoiceResponse({ status: 200, text: 'msal-browser.min.js' })
    const step = nextCaptureStep(0, expired)
    expect(step).toEqual({ action: 'stop', stoppedReason: 'SESSION_EXPIRED', consecutiveFailures: 0 })
  })

  it('never stops for a consecutive-failure streak when stopOnConsecutiveFailures is false - the retry pass', () => {
    const outcome = classifyInvoiceResponse({ status: 0, error: 'boom' })
    let consecutiveFailures = 0
    const stops: boolean[] = []
    for (let i = 0; i < CONSECUTIVE_FAILURE_LIMIT * 3; i += 1) {
      const step = nextCaptureStep(consecutiveFailures, outcome, { stopOnConsecutiveFailures: false })
      consecutiveFailures = step.consecutiveFailures
      stops.push(step.action === 'stop')
    }
    expect(stops.every(stopped => stopped === false)).toBe(true)
  })

  it('still stops immediately on a lost session even when stopOnConsecutiveFailures is false', () => {
    const expired = classifyInvoiceResponse({ status: 200, text: 'msal-browser.min.js' })
    const step = nextCaptureStep(0, expired, { stopOnConsecutiveFailures: false })
    expect(step).toEqual({ action: 'stop', stoppedReason: 'SESSION_EXPIRED', consecutiveFailures: 0 })
  })

  it('a mix of failures interleaved with resolved answers never accumulates a stop', () => {
    const failure = classifyInvoiceResponse({ status: 500, text: '' })
    const pdf = classifyInvoiceResponse({ status: 200, base64: toBase64(pdfBuffer()) })
    const vins = ['TESTDATA000000001', 'TESTDATA000000002', 'TESTDATA000000003', 'TESTDATA000000004', 'TESTDATA000000005']
    const outcomesInOrder = [failure, pdf, failure, pdf, failure]
    let consecutiveFailures = 0
    const stops: string[] = []
    vins.forEach((vin, index) => {
      const step = nextCaptureStep(consecutiveFailures, outcomesInOrder[index])
      consecutiveFailures = step.consecutiveFailures
      if (step.action === 'stop') stops.push(vin)
    })
    expect(stops).toEqual([])
  })
})

describe('isBudgetExhausted', () => {
  it('compares elapsed time to the budget, not wall-clock time', () => {
    expect(isBudgetExhausted(1000, 1800000)).toBe(false)
    expect(isBudgetExhausted(1800001, 1800000)).toBe(true)
    expect(isBudgetExhausted(1800000, 1800000)).toBe(false)
  })
})

describe('isSessionExpiredReason', () => {
  it('is true only for the session-loss reasons, not a budget cutoff or a failure streak', () => {
    expect(isSessionExpiredReason('SESSION_EXPIRED')).toBe(true)
    expect(isSessionExpiredReason('HTTP_401')).toBe(true)
    expect(isSessionExpiredReason('HTTP_403')).toBe(true)
    expect(isSessionExpiredReason('BUDGET_EXHAUSTED')).toBe(false)
    expect(isSessionExpiredReason('CONSECUTIVE_FAILURES:FETCH_ERROR')).toBe(false)
    expect(isSessionExpiredReason(null)).toBe(false)
  })
})

describe('computeSessionStatus', () => {
  it('is session_expired only when the fordvisions session itself was lost', () => {
    expect(computeSessionStatus({ stoppedReason: 'SESSION_EXPIRED', anyVinStillFailed: false })).toBe('session_expired')
    expect(computeSessionStatus({ stoppedReason: 'HTTP_401', anyVinStillFailed: false })).toBe('session_expired')
  })

  it('is incomplete for a systemic stop that is not a session loss, or a VIN still unresolved after retry', () => {
    expect(computeSessionStatus({ stoppedReason: 'BUDGET_EXHAUSTED', anyVinStillFailed: false })).toBe('incomplete')
    expect(computeSessionStatus({ stoppedReason: 'CONSECUTIVE_FAILURES:FETCH_ERROR', anyVinStillFailed: false })).toBe('incomplete')
    expect(computeSessionStatus({ stoppedReason: null, anyVinStillFailed: true })).toBe('incomplete')
  })

  it('is ok when nothing stopped the run and every VIN resolved', () => {
    expect(computeSessionStatus({ stoppedReason: null, anyVinStillFailed: false })).toBe('ok')
  })
})

describe('computeExitCode - what run-inventory-flow-daily.mjs sees', () => {
  it('exits 0 for a run with only per-vehicle failures, so it is reported as a warning, not a failure', () => {
    expect(computeExitCode(null)).toBe(0)
  })

  it('exits 1 for any systemic stop, which runOptionalAuthenticatedSources still treats as non-blocking', () => {
    expect(computeExitCode('SESSION_EXPIRED')).toBe(1)
    expect(computeExitCode('BUDGET_EXHAUSTED')).toBe(1)
    expect(computeExitCode('CONSECUTIVE_FAILURES:FETCH_ERROR')).toBe(1)
  })
})
