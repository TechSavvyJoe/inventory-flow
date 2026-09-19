// @ts-nocheck -- capture helpers are plain portable ESM.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  classifyOasisResponse,
  isCompleteWarrantyRecord,
  oasisWarrantyBlock,
  parseOasis,
} from '../../scripts/capture-warranty.mjs'
import {
  containsForeignOasisText,
  factoryTermText,
  isFactoryCoverageRow,
  isOasisDate,
} from '../../server/oasis-coverage-grammar.mjs'

const vin = '1FMCU9G66PUA12345'
function oasisHtml(responseVin = vin) {
  return `<html><body>
    OASIS RESULT VIN: ${responseVin}
    WARRANTY START DATE: 09-June-2023 MONTHS IN SERVICE: 38 SALE MILEAGE: 3
    WARRANTY COVERAGE
    COVERAGE TYPE: Bumper-to-Bumper COVERAGE DESCRIPTION: 3 years / 36,000 Miles (whichever occurs first)
    COVERAGE TYPE: Powertrain COVERAGE DESCRIPTION: 5 years / 60,000 Miles (whichever occurs first)
    EXTENDED COVERAGES OWNER NAME: Private Person PREMIUMCARE DEDUCTIBLE $100 01/16/2029
    COVERAGE TYPE: Safety Restraint COVERAGE DESCRIPTION: 8 years / 100,000 Miles (whichever occurs first)
    OUTSTANDING FIELD SERVICE ACTIONS 00T01 Customer Satisfaction Program
    GENERAL WARRANTY INFORMATION
  </body></html>`
}

describe('Ford OASIS warranty capture boundary', () => {
  it('binds the response to the requested VIN and keeps only factory coverage rows', () => {
    const parsed = parseOasis(oasisHtml(), vin)
    expect(parsed).toMatchObject({
      warrantyStartDate: '09-June-2023',
      monthsInService: 38,
      saleMileage: 3,
      openFieldServiceActionCodes: ['00T01'],
    })
    expect(parsed.coverages.map((row) => row.type)).toEqual(['Bumper-to-Bumper', 'Powertrain'])
    expect(JSON.stringify(parsed)).not.toMatch(/Private Person|PREMIUMCARE|DEDUCTIBLE|01\/16\/2029|Safety Restraint|8 years/)
    expect(parseOasis(oasisHtml('1FMCU9G66PUA54321'), vin)).toBeNull()
    expect(parseOasis(`OASIS RESULT VIN: ${vin} WARRANTY START DATE: 09-June-2023 MONTHS IN SERVICE: 38`, vin)).toBeNull()
  })

  it('classifies no-record separately and refuses an unbound no-record page', () => {
    expect(classifyOasisResponse({ status: 200, text: `OASIS RESULT VIN: ${vin} NO OASIS INFORMATION AVAILABLE` }, vin)).toEqual({ state: 'no_record' })
    expect(classifyOasisResponse({ status: 200, text: 'OASIS RESULT NO OASIS INFORMATION AVAILABLE' }, vin)).toEqual({ state: 'unparsed' })
    expect(classifyOasisResponse({ status: 0, error: 'Failed to fetch' }, vin)).toEqual({ state: 'unreachable' })
  })

  it('does not treat a Ford AutoCheck-only legacy row as complete', () => {
    expect(isCompleteWarrantyRecord({ make: 'Ford', result: 'OK', autoCheck: {} })).toBe(false)
    expect(isCompleteWarrantyRecord({ make: 'Ford', result: 'OK', fordOasis: {} })).toBe(true)
    expect(isCompleteWarrantyRecord({ make: 'Lincoln', result: 'NO_WARRANTY_SOURCE', oasisOutcome: 'no_record' })).toBe(true)
    expect(isCompleteWarrantyRecord({ make: 'Ford', result: 'NO_WARRANTY_SOURCE', oasisOutcome: 'no_factory_coverage' })).toBe(true)
    expect(isCompleteWarrantyRecord({ make: 'Chevrolet', result: 'OK', autoCheck: {} })).toBe(true)
  })

  it('computes only an accepted factory warranty block', () => {
    const parsed = parseOasis(oasisHtml(), vin)
    const block = oasisWarrantyBlock(parsed, 10_000)
    expect(block.coverages[0]).toMatchObject({ termMonths: 36, termMiles: 36_000, status: 'EXPIRED' })
    expect(block.coverages[1]).toMatchObject({ termMonths: 60, termMiles: 60_000, remainingMiles: 50_000 })
  })
})

describe('shared OASIS grammar', () => {
  it('accepts printed Ford dates and terms while rejecting plan or identity text', () => {
    expect(isOasisDate('09-June-2023')).toBe(true)
    expect(isOasisDate('01/16/2029')).toBe(true)
    expect(isOasisDate('2029-01-16')).toBe(false)
    expect(factoryTermText('5 years / Unlimited miles')).toBe('5 years / Unlimited miles')
    expect(isFactoryCoverageRow('Powertrain', '5 years / 60,000 Miles (whichever occurs first)')).toBe(true)
    expect(isFactoryCoverageRow('PremiumCARE', '8 years / 100,000 Miles')).toBe(false)
    expect(containsForeignOasisText('Customer Satisfaction Program')).toBe(false)
    expect(containsForeignOasisText('CUSTOMER NAME: Private Person')).toBe(true)
  })
})
