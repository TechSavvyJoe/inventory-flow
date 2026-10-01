// @vitest-environment node
// @ts-nocheck -- dependency-free ESM; synthetic fixtures only.
import { describe, expect, it } from 'vitest'
import { autoCheckTone, equipmentByCategory, publishedEquipment, standoutEquipment } from '../../extension/sidepanel/lib/equipment.mjs'
import { compareVehicles } from '../../extension/sidepanel/lib/compare.mjs'

const vehicle = (overrides = {}) => ({
  vin: 'V1', stockNumber: 'S1', name: '2024 Ford F-150 Lariat', year: 2024, trim: 'Lariat', bodyStyle: 'SuperCrew', drivetrain: '4WD', engine: '3.5L EcoBoost V6', transmission: '10-Speed Automatic', fuelType: 'Gasoline',
  exteriorColor: 'Blue', interiorColor: 'Black', price: 51800, msrp: 68420, savings: 16620, mileage: 12450, daysListed: 43, certified: true, certifiedProgram: { name: 'Ford Blue Advantage' }, homeStore: 'Howell',
  specs: { mpgCity: 18, mpgHighway: 24 }, hold: { label: 'No current DealerMail hold found' }, location: { label: 'Howell' },
  features: ['Heated Front Seats', 'Class II Trailer Tow Package', 'BlueCruise'],
  documents: {
    autoCheck: { score: 91 },
    windowSticker: { dataState:'current', equipmentGroup: '502A Equipment Group', options: ['heated front seats', 'Twin Panel Moonroof'], standardEquipment: ['Rearview Camera'], warranty: [] },
    factoryEquipment: { dataState:'current', packages: [{ name: 'Lariat Sport Package', code: '502A', price: 3005, features: ['20" Wheels', 'Twin Panel Moonroof'] }], sections: [{ name: 'Safety', items: [{ label: 'Blind Spot Information System', price: null }] }] },
  },
  ...overrides,
})

describe('published equipment', () => {
  it('keeps one entry per item and lets the strongest source win', () => {
    const items = publishedEquipment(vehicle())
    const heated = items.find((item) => item.label.toLowerCase() === 'heated front seats')
    expect(heated.source).toBe('factory-option')
    const moonroof = items.filter((item) => /moonroof/i.test(item.label))
    expect(moonroof).toHaveLength(1)
    expect(moonroof[0].source).toBe('factory-option')
    expect(items.find((item) => item.label === 'BlueCruise').source).toBe('published-listing-feature')
    expect(items.find((item) => item.label.startsWith('Lariat Sport Package'))).toMatchObject({ source: 'vauto-equipment-package', category: 'packages', standout: true })
  })

  it('categorizes and puts standouts first', () => {
    const groups = equipmentByCategory(vehicle())
    // "Class II Trailer Tow Package" is a package first, exactly as the app files it.
    expect(groups.map((group) => group.category)).toEqual(['packages', 'driver-assistance', 'comfort', 'other'])
    // Standouts first, then the stronger source (label beats website listing).
    expect(groups.find((group) => group.category === 'driver-assistance').items.map((item) => item.label)).toEqual(['Blind Spot Information System', 'BlueCruise', 'Rearview Camera'])
    expect(standoutEquipment(vehicle(), 3).every((item) => item.standout)).toBe(true)
    expect(publishedEquipment(vehicle({ features: [], documents: { autoCheck: null, windowSticker: null, factoryEquipment: null } }))).toEqual([])
  })

  it('reads AutoCheck statuses the way the app does', () => {
    expect(autoCheckTone('No accidents reported')).toBe('clear')
    expect(autoCheckTone('No open recalls.')).toBe('clear')
    expect(autoCheckTone('Clean')).toBe('clear')
    expect(autoCheckTone('1 accident reported')).toBe('review')
    expect(autoCheckTone('Not reported')).toBe('unknown')
    expect(autoCheckTone('')).toBe('unknown')
  })

  it('recognizes captured Lincoln features and excludes incomplete equipment evidence', () => {
    const labels = ['Revel Ultima 3D', 'Perfect Position Seats', 'Lincoln ActiveGlide', 'Jet Appearance Package', 'Monochromatic Appearance Package']
    const record = vehicle({ features:labels, documents:{ windowSticker:{ dataState:'incomplete', options:['Unverified BlueCruise'] }, factoryEquipment:null } })
    const items = publishedEquipment(record)
    expect(items).toHaveLength(labels.length)
    expect(items.every(item => item.standout)).toBe(true)
    expect(items.find(item => item.label === 'Revel Ultima 3D').category).toBe('technology')
    expect(items.find(item => item.label === 'Perfect Position Seats').category).toBe('comfort')
    expect(items.find(item => item.label === 'Lincoln ActiveGlide').category).toBe('driver-assistance')
    expect(items.some(item => item.label.includes('Unverified'))).toBe(false)
  })
})

describe('compare', () => {
  it('flags differing facts and lists equipment only one vehicle has', () => {
    const left = vehicle()
    const right = vehicle({ vin: 'V2', stockNumber: 'S2', name: '2023 Ford Bronco Sport Badlands', year: 2023, trim: 'Badlands', price: 31900, savings: 8475, features: ['Heated Front Seats', 'Badlands Package'], documents: { autoCheck: null, windowSticker: null, factoryEquipment: null } })
    const result = compareVehicles([left, right])
    expect(result.facts.find((fact) => fact.label === 'Price')).toMatchObject({ values: ['$51,800', '$31,900'], differs: true })
    expect(result.facts.find((fact) => fact.label === 'Drivetrain')).toMatchObject({ differs: false })
    expect(result.facts.find((fact) => fact.label === 'AutoCheck').values).toEqual(['91', '—'])
    expect(result.shared).toBe(1)
    expect(result.onlyOn[1].items).toEqual(['Badlands Package'])
    expect(result.onlyOn[0].items).toContain('BlueCruise')
    expect(compareVehicles([left, right, left, right]).vehicles).toHaveLength(3)
  })

  it('names the certification program as text and treats equal programs as equal', () => {
    const program = { name: 'Ford Blue Advantage', short: 'Blue Advantage', brand: 'ford', store: 'Howell' }
    const left = vehicle({ certified: true, certifiedProgram: program })
    const right = vehicle({ vin: 'V2', certified: true, certifiedProgram: { ...program } })
    const certified = compareVehicles([left, right]).facts.find((fact) => fact.label === 'Certified')
    expect(certified).toMatchObject({ values: ['Ford Blue Advantage', 'Ford Blue Advantage'], differs: false })
    expect(compareVehicles([left, vehicle({ vin: 'V3', certified: false, certifiedProgram: null })]).facts.find((fact) => fact.label === 'Certified')).toMatchObject({ values: ['Ford Blue Advantage', 'No'], differs: true })
  })
})
