// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error Capture parser runs directly in Node ESM without frontend declarations.
import { assessOasisCapture, compareOasisEnrichment, parseOasisFull, validateSavedOasisRecords } from '../../scripts/lib/oasis-parser.mjs'

const report = (section: string) => `<html><body>OASIS RESULT: VEHICLE DESCRIPTION: SYNTHETIC TEST VEHICLE ${section}</body></html>`
describe('OASIS captured action evidence', () => {
  it('keeps technical specifications and short codes in their exact labeled fields without collecting owner material', () => {
    const parsed = parseOasisFull(report('VERSION/SERIES: SERIES DEMO BODY STYLE: CREW CAB DRIVE TYPE: 4X4 PAINT COLOR: SYNTHETIC WHITE PAINT CODE: YZ ENGINE: 3.5L V6 ENGINE CALIBRATION: DEMO-CAL TRANSMISSION: 10 SPEED AXLE RATIO: 3.73 AXLE CODE: EL GROSS VEHICLE WEIGHT: 7,400 LB WHEEL SIZE: 20 IN TIRE: 275/60R20 SYNC VERSION: SYNC 4 FUEL TYPE: GASOLINE VIN: TESTDATASYN000001 EXTENDED COVERAGES: OWNER NAME: SYNTHETIC OWNER End of OASIS report'))
    expect(parsed).toMatchObject({ bodyStyle: 'CREW CAB', driveType: '4X4', paintColor: 'SYNTHETIC WHITE', paintCode: 'YZ', engine: '3.5L V6', engineCalibration: 'DEMO-CAL', transmission: '10 SPEED', axleRatio: '3.73', axleCode: 'EL', grossVehicleWeight: '7,400 LB', wheelSize: '20 IN', tire: '275/60R20', syncVersion: 'SYNC 4', fuelType: 'GASOLINE' })
    expect(JSON.stringify(parsed)).not.toContain('SYNTHETIC OWNER')
    expect(parseOasisFull(report('ENGINE: ENGINE CALIBRATION:'))).toMatchObject({ engine: '', engineCalibration: '' })
  })
  it.each(['', 'OUTSTANDING FIELD SERVICE ACTIONS: unavailable GENERAL WARRANTY INFORMATION', 'OUTSTANDING FIELD SERVICE ACTIONS: 26N?? malformed GENERAL WARRANTY INFORMATION', 'OUTSTANDING FIELD SERVICE ACTIONS: 26N99 truncated description'])('does not infer zero from missing or incomplete capture %s', section => {
    expect(parseOasisFull(report(section))).toMatchObject({ openActionsCaptured: false, openFieldServiceActionCount: null })
  })
  it('recognizes an explicit complete zero phrase', () => {
    expect(parseOasisFull(report('OUTSTANDING FIELD SERVICE ACTIONS: NO CAMPAIGN MESSAGE(S) FOUND GENERAL WARRANTY INFORMATION'))).toMatchObject({ openActionsCaptured: true, openFieldServiceActionCount: 0, openFieldServiceActions: [] })
  })
  it('recognizes the live OASIS no-action block with its encoded divider', () => {
    const parsed = parseOasisFull(report('OUTSTANDING FIELD SERVICE ACTIONS NO CAMPAIGN MESSAGE(S) FOUND &#x25B4; NO WARNING MESSAGES FOUND FOR THIS VIN &#x25B4; GENERAL WARRANTY INFORMATION'))
    expect(parsed).toMatchObject({ openActionsCaptured: true, openFieldServiceActionCount: 0, openFieldServiceActions: [] })
  })
  it('does not call a zero-action block complete without the following OASIS section', () => {
    expect(parseOasisFull(report('OUTSTANDING FIELD SERVICE ACTIONS NO CAMPAIGN MESSAGE(S) FOUND &#x25B4;'))).toMatchObject({ openActionsCaptured: false, openFieldServiceActionCount: null })
  })
  it('keeps the Canadian service-information warning unverified', () => {
    const parsed = parseOasisFull(report('OUTSTANDING FIELD SERVICE ACTIONS NO CAMPAIGN MESSAGE(S) FOUND &#x25B4; WARNING MESSAGES !! WARNING !! VERIFY VIN/WARRANTY COVERAGE VEHICLE SOLD IN CANADA SERVICE INFO MAY BE UNAVAILABLE &#x25B4; GENERAL WARRANTY INFORMATION'))
    expect(parsed).toMatchObject({ openActionsCaptured: false, openFieldServiceActionCount: null, actionResultLimit: 'canadian_service_info_warning' })
    expect(assessOasisCapture([{ vin: 'VIN1' }], [{ vin: 'VIN1', ...parsed }])).toEqual({ complete: true, missingVinCount: 0, incompleteActionResults: 0, sourceLimitedCount: 1 })
  })
  it('does not verify a zero result when Ford shows an unfamiliar warning', () => {
    const parsed = parseOasisFull(report('OUTSTANDING FIELD SERVICE ACTIONS NO CAMPAIGN MESSAGE(S) FOUND &#x25B4; WARNING MESSAGES OTHER WARNING GENERAL WARRANTY INFORMATION'))
    expect(parsed).toMatchObject({ openActionsCaptured: false, openFieldServiceActionCount: null })
    expect(parsed.actionResultLimit).toBeUndefined()
  })
  it('captures every positive action with conditions and a consistent count', () => {
    const parsed = parseOasisFull(report('OUTSTANDING FIELD SERVICE ACTIONS: 26N98 Synthetic campaign only if inspection confirms condition 26N99 Synthetic extended coverage conditional on mileage GENERAL WARRANTY INFORMATION'))
    expect(parsed).toMatchObject({ openActionsCaptured: true, openFieldServiceActionCount: 2 })
    expect(parsed.openFieldServiceActions).toEqual([{ code: '26N98', description: 'Synthetic campaign only if inspection confirms condition' }, { code: '26N99', description: 'Synthetic extended coverage conditional on mileage' }])
  })
  it('recognizes live OASIS notice and divider without adding them to an action', () => {
    const parsed = parseOasisFull(report('OUTSTANDING FIELD SERVICE ACTIONS NOTICE – Prior to performing any FSA software repairs, see EFC View full list of recalls and programs supported by this process 25S76 POWERTRAIN CONTROL MODULE PCM SOFTWARE UPDATE 26C11 SYNC SCREEN UPDATE &#x25B4; NO WARNING MESSAGES FOUND FOR THIS VIN GENERAL WARRANTY INFORMATION'))
    expect(parsed).toMatchObject({ openActionsCaptured: true, openFieldServiceActionCount: 2 })
    expect(parsed.openFieldServiceActions).toEqual([
      { code: '25S76', description: 'POWERTRAIN CONTROL MODULE PCM SOFTWARE UPDATE' },
      { code: '26C11', description: 'SYNC SCREEN UPDATE' },
    ])
  })
  it.each(['26N99', '26N99 Synthetic valid 26N?? malformed', '26N99 Synthetic one 26N99 Duplicate', 'NO CAMPAIGN MESSAGE(S) FOUND 26N99 Contradiction'])('does not mark malformed or contradictory sections complete: %s', block => {
    expect(parseOasisFull(report(`OUTSTANDING FIELD SERVICE ACTIONS: ${block} GENERAL WARRANTY INFORMATION`))).toMatchObject({ openActionsCaptured: false, openFieldServiceActionCount: null })
  })
  it('does not accept a non-OASIS page', () => {
    expect(parseOasisFull('<html>Sign in</html>')).toBeNull()
  })
  it('binds each parsed report to the requested VIN without retaining the source VIN', () => {
    const html = report('VIN: TESTDATASYN000001 OUTSTANDING FIELD SERVICE ACTIONS: NO CAMPAIGN MESSAGE(S) FOUND GENERAL WARRANTY INFORMATION')
    expect(parseOasisFull(html, 'TESTDATASYN000001')?.sourceVinStatus).toBe('matched')
    expect(parseOasisFull(html, 'TESTDATASYN000002')?.sourceVinStatus).toBe('mismatch')
    expect(parseOasisFull(report('OUTSTANDING FIELD SERVICE ACTIONS: NO CAMPAIGN MESSAGE(S) FOUND GENERAL WARRANTY INFORMATION'), 'TESTDATASYN000001')?.sourceVinStatus).toBe('missing')
    expect(JSON.stringify(parseOasisFull(html, 'TESTDATASYN000001'))).not.toContain('TESTDATASYN000001')
  })
  it('warns past malformed entries in a valid saved records array', () => {
    const record = { vin: 'TESTDATASYN000001', openActionsCaptured: true, openFieldServiceActionCount: 0, openFieldServiceActions: [] }
    const invalidState = { ...record, openFieldServiceActionCount: '0' }
    const invalidVin = { ...record, vin: 'NOT-A-VIN' }
    expect(validateSavedOasisRecords([null, 17, [], invalidState, invalidVin, record])).toEqual({ records: [record], skipped: 5 })
    expect(validateSavedOasisRecords({ records: [] })).toEqual({ records: [], skipped: 0 })
  })
  it('blocks a full capture with a missing or unverified action result', () => {
    const worklist = [{ vin: 'VIN1' }, { vin: 'VIN2' }]
    const verified = { vin: 'VIN1', openActionsCaptured: true, openFieldServiceActionCount: 0, openFieldServiceActions: [] }
    expect(assessOasisCapture(worklist, [verified])).toEqual({ complete: false, missingVinCount: 1, incompleteActionResults: 0, sourceLimitedCount: 0 })
    const partial = { vin: 'VIN2', openActionsCaptured: false, openFieldServiceActionCount: null, openFieldServiceActions: [] }
    expect(assessOasisCapture(worklist, [verified, partial])).toEqual({ complete: false, missingVinCount: 0, incompleteActionResults: 1, sourceLimitedCount: 0 })
    expect(assessOasisCapture(worklist, [verified, { ...partial, openActionsCaptured: true, openFieldServiceActionCount: 0 }])).toEqual({ complete: true, missingVinCount: 0, incompleteActionResults: 0, sourceLimitedCount: 0 })
  })
  it('blocks an enrichment that loses OASIS certainty or action codes', () => {
    const source = [{ vin: 'VIN1', capturedAt: '2026-09-23T12:00:00Z', openActionsCaptured: true, openFieldServiceActions: [{ code: '26S24' }] }]
    const same = { capturedAt: source[0].capturedAt, openActionsCaptured: true, openFieldServiceActions: [{ code: '26S24' }] }
    expect(compareOasisEnrichment(source, {})).toEqual({ complete: false, missing: 1, mismatched: 0 })
    expect(compareOasisEnrichment(source, { VIN1: { fordOasis: { ...same, openActionsCaptured: false } } })).toEqual({ complete: false, missing: 0, mismatched: 1 })
    expect(compareOasisEnrichment(source, { VIN1: { fordOasis: { ...same, openFieldServiceActions: [] } } })).toEqual({ complete: false, missing: 0, mismatched: 1 })
    expect(compareOasisEnrichment(source, { VIN1: { fordOasis: { ...same, capturedAt: '2026-09-22T12:00:00Z' } } })).toEqual({ complete: false, missing: 0, mismatched: 1 })
    expect(compareOasisEnrichment(source, { VIN1: { fordOasis: same } })).toEqual({ complete: true, missing: 0, mismatched: 0 })
  })
})
