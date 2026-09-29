// @ts-nocheck -- the daily runner and OASIS parser are plain ESM.
// @vitest-environment node
// One vehicle's OASIS report must never stop the daily release (Joe, 2026-09-28).
// Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { diagnoseOasisActions } from '../../scripts/lib/oasis-parser.mjs'

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

describe('OASIS never blocks the daily release', () => {
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
    expect(internals.oasisWarning(outcome)).toMatch(/sign in to FMCDealer/)
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
