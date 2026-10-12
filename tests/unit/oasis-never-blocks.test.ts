// @ts-nocheck -- the daily runner and OASIS parser are plain ESM.
// @vitest-environment node
// One vehicle's OASIS report must never stop the daily release (Joe, 2026-09-28).
// Synthetic data only.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { diagnoseOasisActions, parseOasisFull, reviewOasisForPublish } from '../../scripts/lib/oasis-parser.mjs'
import { oasisCaptureCompletion, readOasisWithRecovery } from '../../scripts/lib/oasis-capture-outcome.mjs'

let workspaceRoot
let previousRoot
let internals

beforeAll(async () => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), 'oasis-never-blocks-'))
  for (const dir of ['work/run-status', 'work/oasis-history', 'outputs', 'apps/inventory-ops']) mkdirSync(path.join(workspaceRoot, dir), { recursive: true })
  previousRoot = process.env.BOB_MAXEY_WORKSPACE_ROOT
  process.env.BOB_MAXEY_WORKSPACE_ROOT = workspaceRoot
  internals = (await import('../../scripts/run-inventory-flow-daily.mjs')).internals
})

afterAll(() => {
  if (previousRoot === undefined) delete process.env.BOB_MAXEY_WORKSPACE_ROOT
  else process.env.BOB_MAXEY_WORKSPACE_ROOT = previousRoot
  rmSync(workspaceRoot, { recursive: true, force: true })
})

const vin = (n) => `TESTDATAOASIS${String(n).padStart(4, '0')}`
const captured = (v) => ({ vin: v, openActionsCaptured: true, openFieldServiceActionCount: 0, openFieldServiceActions: [] })
const resolved = (v) => ({ status: 200, text: `OASIS RESULT: VEHICLE DESCRIPTION: SYNTHETIC TEST VEHICLE VIN: ${v} OUTSTANDING FIELD SERVICE ACTIONS: NO CAMPAIGN MESSAGE(S) FOUND GENERAL WARRANTY INFORMATION` })
const recover = (requestedVin, read, options = {}) => readOasisWithRecovery(requestedVin, {
  read, wait: vi.fn(async () => {}), budgetExhausted: () => false, ...options,
})

describe('OASIS transport recovery and actual capture completion policy', () => {
  it.each([1, 2, 8].flatMap(size => ['status zero', 'exception'].map(failure => [size, failure])))('stops a persistently unavailable %i-VIN queue after bounded reads (%s)', async (size, failure) => {
    const queue = Array.from({ length: size }, (_, index) => vin(index))
    const read = vi.fn(async () => {
      if (failure === 'exception') throw new Error('synthetic transport failure')
      return { status: 0, error: 'synthetic CORS failure' }
    })
    const wait = vi.fn(async () => {})
    const outcome = await recover(queue[0], read, { alternateVin: queue[1], wait })

    expect(read.mock.calls.map(([v]) => v)).toEqual(size === 1 ? [queue[0], queue[0]] : [queue[0], queue[0], queue[1]])
    expect(wait.mock.calls).toEqual([[2000]])
    expect(outcome).toEqual({ response: null, transportFailures: size === 1 ? 2 : 3, stoppedReason: 'TRANSPORT_UNAVAILABLE' })
    // Prior successful/saved records cannot turn the current failure into success.
    expect(oasisCaptureCompletion('ok', outcome.stoppedReason)).toEqual({ sessionStatus: 'incomplete', stoppedReason: 'TRANSPORT_UNAVAILABLE', exitCode: 1 })
  })

  it('recovers a transient status zero with one same-VIN retry and no diagnostic read', async () => {
    const response = resolved(vin(1))
    const read = vi.fn().mockResolvedValueOnce({ status: 0 }).mockResolvedValueOnce(response)
    const outcome = await recover(vin(1), read, { alternateVin: vin(2) })
    expect(read.mock.calls).toEqual([[vin(1)], [vin(1)]])
    expect(outcome).toEqual({ response, transportFailures: 1, stoppedReason: null })
    expect(parseOasisFull(outcome.response.text, vin(1))).toMatchObject({ sourceVinStatus: 'matched', openActionsCaptured: true })
    expect(oasisCaptureCompletion('ok', outcome.stoppedReason)).toEqual({ sessionStatus: 'ok', stoppedReason: null, exitCode: 0 })
  })

  it('keeps an isolated first-VIN failure non-blocking when a fresh alternate read resolves, without skipping its normal capture', async () => {
    const read = vi.fn(async v => v === vin(1) ? { status: 0 } : resolved(v))
    const failed = await recover(vin(1), read, { alternateVin: vin(2) })
    expect(failed).toEqual({ response: null, transportFailures: 2, stoppedReason: null })
    const next = await recover(vin(2), read, { alternateVin: vin(1) })
    expect(read.mock.calls).toEqual([[vin(1)], [vin(1)], [vin(2)], [vin(2)]])
    expect(parseOasisFull(next.response.text, vin(2))).toMatchObject({ sourceVinStatus: 'matched', openActionsCaptured: true })
  })

  it.each([true, false])('freshly rechecks a previously resolved VIN instead of trusting earlier evidence (still responds: %s)', async stillResponds => {
    const read = vi.fn().mockResolvedValueOnce(resolved(vin(1)))
      .mockResolvedValueOnce({ status: 0 }).mockResolvedValueOnce({ status: 0 })
      .mockResolvedValueOnce(stillResponds ? resolved(vin(1)) : { status: 0 })
    await recover(vin(1), read)
    const outcome = await recover(vin(2), read, { alternateVin: vin(1) })
    expect(read.mock.calls).toEqual([[vin(1)], [vin(2)], [vin(2)], [vin(1)]])
    expect(outcome.stoppedReason).toBe(stillResponds ? null : 'TRANSPORT_UNAVAILABLE')
    expect(oasisCaptureCompletion('ok', outcome.stoppedReason).exitCode).toBe(stillResponds ? 0 : 1)
  })

  const expiredResponses = [
    ['401', { status: 401 }],
    ['403', { status: 403 }],
    ['password form', { status: 200, text: '<input type="password">' }],
    ['Microsoft page', { status: 200, text: 'login.microsoftonline.com' }],
    ['sign-in URL', { status: 200, finalUrl: 'https://login.microsoftonline.com/synthetic' }],
  ]
  it.each(expiredResponses.flatMap(([label, response]) => ['initial', 'alternate'].map(stage => [label, response, stage])))('stops immediately for recognized %s evidence on the %s response', async (_label, response, stage) => {
    const read = vi.fn()
    if (stage === 'alternate') read.mockResolvedValueOnce({ status: 0 }).mockResolvedValueOnce({ status: 0 })
    read.mockResolvedValueOnce(response)
    const outcome = await recover(vin(1), read, { alternateVin: vin(2) })
    expect(read).toHaveBeenCalledTimes(stage === 'initial' ? 1 : 3)
    expect(oasisCaptureCompletion('ok', outcome.stoppedReason)).toEqual({ sessionStatus: 'session_expired', stoppedReason: 'SESSION_EXPIRED', exitCode: 1 })
  })

  it.each([
    ['404', { status: 404, text: 'Not found' }],
    ['empty report', { status: 200, text: '' }],
    ['unrecognized report', { status: 200, text: '<html>Unavailable report</html>' }],
    ['wrong VIN', resolved(vin(2))],
    ['unverified VIN', { status: 200, text: 'OASIS RESULT: VEHICLE DESCRIPTION: SYNTHETIC TEST VEHICLE' }],
  ])('leaves a genuine %s response to the existing per-VIN parser/retry path', async (_label, response) => {
    const read = vi.fn().mockResolvedValue(response)
    const wait = vi.fn(async () => {})
    expect(await recover(vin(1), read, { alternateVin: vin(2), wait })).toEqual({ response, transportFailures: 0, stoppedReason: null })
    expect(read).toHaveBeenCalledOnce()
    expect(wait).not.toHaveBeenCalled()
    const parsed = parseOasisFull(response.text, vin(1))
    expect(parsed?.sourceVinStatus).not.toBe('matched')
  })

  it.each(['initial', 'before wait', 'after wait', 'before alternate'])('honors budget exhaustion %s without another read or wait', async stage => {
    let exhausted = stage === 'initial'
    const read = vi.fn(async () => {
      if (stage === 'before wait' || (stage === 'before alternate' && read.mock.calls.length === 2)) exhausted = true
      return { status: 0 }
    })
    const wait = vi.fn(async () => { if (stage === 'after wait') exhausted = true })
    const outcome = await recover(vin(1), read, { alternateVin: vin(2), wait, budgetExhausted: () => exhausted })
    expect(read).toHaveBeenCalledTimes(stage === 'initial' ? 0 : stage === 'before alternate' ? 2 : 1)
    expect(wait).toHaveBeenCalledTimes(stage === 'initial' || stage === 'before wait' ? 0 : 1)
    expect(oasisCaptureCompletion('ok', outcome.stoppedReason)).toEqual({ sessionStatus: 'incomplete', stoppedReason: 'BUDGET_EXHAUSTED', exitCode: 1 })
  })
})

describe('OASIS never blocks the daily release', () => {
  it.each([0, 1])('classifies a transport stop as systemic even with %i missing records, while later optional sources continue', async missingVinCount => {
    const recovery = await recover(vin(1), vi.fn().mockResolvedValue({ status: 0 }))
    const completion = oasisCaptureCompletion('ok', recovery.stoppedReason)
    const { exitCode, ...summary } = completion
    const previousRun = internals.runtime.run
    internals.runtime.run = vi.fn((_command, _args, options) => options.label === 'oasis'
      ? { ok: exitCode === 0, output: JSON.stringify({ ...summary, complete: missingVinCount === 0, missingVinCount, incompleteActionResults: 0 }) }
      : { ok: true, output: '{}' })
    try {
      const steps = []
      const warnings = []
      const outcome = internals.runOptionalAuthenticatedSources('2026-10-12', true, warnings, steps)
      expect(outcome).toMatchObject({ validated: false, systemic: true, missingVehicles: missingVinCount })
      expect(steps.find(step => step.name === 'oasis')).toMatchObject({ status: 'failed_non_blocking' })
      expect(steps.find(step => step.name === 'oasis').detail).toContain('TRANSPORT_UNAVAILABLE')
      expect(steps.find(step => step.name === 'oasis').detail).not.toContain('session_expired')
      expect(warnings.some(warning => warning.startsWith('Ford OASIS was not captured'))).toBe(true)
      expect(steps.at(-1)).toMatchObject({ name: 'warranty', status: 'complete' })
      expect(internals.runtime.run).toHaveBeenCalledTimes(9)
    } finally { internals.runtime.run = previousRun }
  })

  it('keeps a per-VIN gap with fresh alternate proof as a non-systemic warning in the daily runner', async () => {
    const recovery = await recover(vin(1), vi.fn(async v => v === vin(1) ? { status: 0 } : resolved(v)), { alternateVin: vin(2) })
    const { exitCode, ...summary } = oasisCaptureCompletion('ok', recovery.stoppedReason)
    const previousRun = internals.runtime.run
    internals.runtime.run = vi.fn((_command, _args, options) => options.label === 'oasis'
      ? { ok: exitCode === 0, output: JSON.stringify({ ...summary, complete: false, missingVinCount: 1, incompleteActionResults: 0 }) }
      : { ok: true, output: '{}' })
    try {
      const steps = []
      const outcome = internals.runOptionalAuthenticatedSources('2026-10-12', true, [], steps)
      expect(outcome).toMatchObject({ validated: false, systemic: false, missingVehicles: 1 })
      expect(steps.find(step => step.name === 'oasis')).toMatchObject({ status: 'completed_with_warning' })
      expect(steps.at(-1)).toMatchObject({ name: 'warranty', status: 'complete' })
    } finally { internals.runtime.run = previousRun }
  })

  it('reuses a capture with one unconfirmed vehicle as a warning, keeping that vehicle unconfirmed', () => {
    const date = '2026-09-28'
    const worklist = Array.from({ length: 174 }, (_, i) => ({ vin: vin(i) }))
    const records = worklist.map(({ vin: v }) => captured(v))
    records[7] = { vin: vin(7), openActionsCaptured: false, openFieldServiceActionCount: null, openFieldServiceActions: [] }
    writeFileSync(path.join(workspaceRoot, 'work', `oasis-vin-worklist-${date}.json`), JSON.stringify(worklist))
    writeFileSync(path.join(workspaceRoot, 'work', 'oasis-history', `${date}-oasis.json`), JSON.stringify({ records }))
    const steps = []
    const outcome = internals.reuseExistingOasisCapture(date, steps)
    expect(outcome).toMatchObject({ validated: false, systemic: false, incompleteVehicles: 1, missingVehicles: 0 })
    expect(steps.at(-1).status).toBe('reused_existing_capture_with_gaps')
    expect(internals.oasisWarning(outcome)).toMatch(/unconfirmed for 1 vehicle/)
    expect(records[7].openActionsCaptured).toBe(false)
  })

  it('treats a missing capture as a systemic gap that still lets the release proceed', () => {
    const steps = []
    const outcome = internals.reuseExistingOasisCapture('2026-01-02', steps)
    expect(outcome).toMatchObject({ validated: false, systemic: true })
    expect(steps.at(-1).status).toBe('skipped_browser_unavailable')
    const warning = internals.oasisWarning(outcome)
    // This warning is emitted before bundle validation and publishing; it must not report a release that may fail later.
    expect(warning).toBe('Ford OASIS was not captured for this run (sign in to FMCDealer in the Work PC Automation Browser). The inventory and holds candidate may continue without OASIS; publication still requires validation and verification.')
    expect(warning).not.toMatch(/were published|needs-review\.json/)
  })

  it('does not point staff to a review file that the orchestrator did not generate', () => {
    const warning = internals.oasisWarning({ systemic: false, incompleteVehicles: 1, missingVehicles: 0 })

    expect(warning).toBe('Ford OASIS open actions are unconfirmed for 1 vehicle(s); if published, they will show as not confirmed in the app. Review the affected vehicles in OASIS.')
    expect(warning).not.toContain('needs-review.json')
  })

  it('reports a clean capture as validated with no warning', () => {
    const outcome = internals.oasisOutcome({ quality: { complete: true, incompleteActionResults: 0, missingVinCount: 0 } })
    expect(outcome.validated).toBe(true)
    expect(internals.oasisWarning(outcome)).toBeNull()
  })

  it('reads the capture summary from the last JSON line of its output', () => {
    const output = 'progress text\n{"not":"this"}\n{"sessionStatus":"ok","missingVinCount":0,"incompleteActionResults":1,"complete":false}\n'
    expect(internals.lastJsonLine(output)).toMatchObject({ incompleteActionResults: 1 })
    expect(internals.lastJsonLine('no json here')).toBeNull()
  })
})

describe('the publisher pre-publish check reports OASIS gaps without failing', () => {
  const published = (record) => ({ fordOasis: { capturedAt: record.capturedAt, openActionsCaptured: record.openActionsCaptured, openFieldServiceActions: record.openFieldServiceActions } })

  it('warns for one unconfirmed vehicle that is published as not confirmed', () => {
    const worklist = [{ vin: vin(1) }, { vin: vin(2) }]
    const records = [
      { ...captured(vin(1)), capturedAt: '2026-09-28T11:00:00Z' },
      { vin: vin(2), openActionsCaptured: false, openFieldServiceActionCount: null, openFieldServiceActions: [], capturedAt: '2026-09-28T11:01:00Z' },
    ]
    const review = reviewOasisForPublish({ worklist, records, recordsByVin: Object.fromEntries(records.map((r) => [r.vin, published(r)])) })
    expect(review.quality).toMatchObject({ complete: false, incompleteActionResults: 1 })
    expect(review.parity).toMatchObject({ complete: true })
    expect(review.warnings).toEqual(['OASIS open actions unconfirmed for 1 vehicle(s)'])
  })

  it('warns when the capture is missing or unreadable instead of throwing', () => {
    expect(reviewOasisForPublish({ worklist: null, records: undefined, recordsByVin: {} }).warnings[0]).toMatch(/missing or unreadable/)
  })

  it('warns when the published enrichment lacks a captured vehicle', () => {
    const records = [{ ...captured(vin(3)), capturedAt: '2026-09-28T11:00:00Z' }]
    const review = reviewOasisForPublish({ worklist: [{ vin: vin(3) }], records, recordsByVin: {} })
    expect(review.warnings).toEqual(["published OASIS differs from today's capture for 1 vehicle(s)"])
  })
})

describe('diagnoseOasisActions explains an unconfirmed vehicle for the review list', () => {
  const report = (body) => `VEHICLE INFORMATION ... OUTSTANDING FIELD SERVICE ACTIONS: ${body}`
  it.each([
    ['no heading at all', 'VEHICLE INFORMATION only', 'heading_not_found'],
    ['no following section', report('24S45 SOMETHING'), 'no_boundary'],
    ['a warning section after the actions', report('NO CAMPAIGN MESSAGE(S) FOUND WARNING MESSAGES VEHICLE IS A BUYBACK'), 'warning_section'],
    ['unrecognized text with no codes', report('Please contact the help desk GENERAL WARRANTY INFORMATION'), 'zero_codes_unrecognized_text'],
    ['a duplicate code', report('24S45 BRAKE 24S45 BRAKE GENERAL WARRANTY INFORMATION'), 'duplicate_code'],
  ])('%s', (_label, text, reason) => {
    const result = diagnoseOasisActions(text)
    expect(result.reason).toBe(reason)
    expect(result.excerpt.length).toBeLessThanOrEqual(160)
  })
})
