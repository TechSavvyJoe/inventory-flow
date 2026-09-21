// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error Capture parser runs directly in Node ESM without frontend declarations.
import { parseOasisFull } from '../../scripts/lib/oasis-parser.mjs'

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
  it('captures every positive action with conditions and a consistent count', () => {
    const parsed = parseOasisFull(report('OUTSTANDING FIELD SERVICE ACTIONS: 26N98 Synthetic campaign only if inspection confirms condition 26N99 Synthetic extended coverage conditional on mileage GENERAL WARRANTY INFORMATION'))
    expect(parsed).toMatchObject({ openActionsCaptured: true, openFieldServiceActionCount: 2 })
    expect(parsed.openFieldServiceActions).toEqual([{ code: '26N98', description: 'Synthetic campaign only if inspection confirms condition' }, { code: '26N99', description: 'Synthetic extended coverage conditional on mileage' }])
  })
  it.each(['26N99', '26N99 Synthetic valid 26N?? malformed', '26N99 Synthetic one 26N99 Duplicate', 'NO CAMPAIGN MESSAGE(S) FOUND 26N99 Contradiction'])('does not mark malformed or contradictory sections complete: %s', block => {
    expect(parseOasisFull(report(`OUTSTANDING FIELD SERVICE ACTIONS: ${block} GENERAL WARRANTY INFORMATION`))).toMatchObject({ openActionsCaptured: false, openFieldServiceActionCount: null })
  })
  it('does not accept a non-OASIS page', () => {
    expect(parseOasisFull('<html>Sign in</html>')).toBeNull()
  })
})
