import { describe, expect, it } from 'vitest'
import { matchSourceProfile, SOURCE_CATALOG, sourceProfiles } from './sourceCatalog'

const categories = new Set(['public_inventory', 'dealermail', 'vauto', 'autocheck', 'carfax', 'crm', 'equipment', 'oem', 'dms', 'other'])

describe('official-source provider catalog', () => {
  it('keeps IDs unique, categories allowed, and source links secure', () => {
    expect(new Set(SOURCE_CATALOG.map(source => source.id)).size).toBe(SOURCE_CATALOG.length)
    for (const source of SOURCE_CATALOG) {
      expect(categories.has(source.category), source.name).toBe(true)
      expect(source.url, source.name).toMatch(/^https:\/\//)
      expect(source.evidence.length, source.name).toBeGreaterThan(0)
    }
  })

  it('excludes Salesforce and names only researched CRM vendors', () => {
    const allText = JSON.stringify(SOURCE_CATALOG).toLowerCase()
    expect(allText).not.toContain('salesforce')
    const crmNames = sourceProfiles('', 'crm').map(source => source.name)
    expect(crmNames).toEqual([
      'VinSolutions CRM', 'DealerSocket CRM', 'CDK Elead CRM', 'DriveCentric CRM',
      'Reynolds FOCUS CRM', 'AutoAlert CXM', 'DealerBuilt Oplogic CRM', 'Autoxloo / Webxloo CRM', 'AutoRaptor', 'Selly Automotive', 'ProMax Complete CRM',
      'DealerPeak CRM', 'DealerMine CRM', 'AutoSync Activix', 'Carsforsale.com',
    ])
    expect(sourceProfiles('', 'dealermail').map(source => source.name)).toEqual(['DealerMail'])
  })

  it('matches exact normalized names and aliases without guessing', () => {
    expect(matchSourceProfile('autocheck', 'Experian AutoCheck')?.id).toBe('autocheck')
    expect(matchSourceProfile('equipment', 'vPIC')?.id).toBe('nhtsa-vpic')
    expect(matchSourceProfile('dms', 'Tekion')?.id).toBe('tekion-apc')
    expect(matchSourceProfile('dms', 'PBS Systems')?.id).toBe('pbs-partnerhub')
    expect(matchSourceProfile('public_inventory', 'Leadbox')?.id).toBe('leadbox')
    expect(matchSourceProfile('crm', 'FOCUS')?.id).toBe('reynolds-focus-crm')
    expect(matchSourceProfile('crm', 'AutoAlert')?.id).toBe('autoalert-cxm')
    expect(matchSourceProfile('crm', 'Oplogic')?.id).toBe('dealerbuilt-oplogic-crm')
    expect(matchSourceProfile('crm', 'Webxloo CRM')?.id).toBe('autoxloo-webxloo-crm')
    expect(matchSourceProfile('dms', 'Dominion VUE')?.id).toBe('dominion-vue-dms')
    expect(matchSourceProfile('public_inventory', 'WebManager')?.id).toBe('automanager-webmanager')
    expect(matchSourceProfile('public_inventory', 'Dealer Alchemist')?.id).toBe('dealer-alchemist')
    expect(matchSourceProfile('public_inventory', 'Sincro')?.id).toBe('dealeron')
    expect(matchSourceProfile('vauto', 'Custom Inventory Vendor')?.id).toBeUndefined()
    expect(matchSourceProfile('vauto', 'CARFAX')).toBeUndefined()
    expect(matchSourceProfile('vauto', 'AutoAlert')).toBeUndefined()
    expect(matchSourceProfile('crm', 'Experian AutoCheck')).toBeUndefined()
    expect(matchSourceProfile('dms', '')).toBeUndefined()
  })

  it('searches concise evidence and applies an exact category filter', () => {
    expect(sourceProfiles('as-built MSRP').map(source => source.id)).toContain('dataone')
    expect(sourceProfiles('inventory API', 'public_inventory').map(source => source.id)).toContain('dealer-com')
    expect(sourceProfiles('inventory API', 'crm')).toHaveLength(0)
    expect(sourceProfiles('anything', 'not-a-provider-category')).toHaveLength(0)
  })

  it('returns real independent and franchise providers from segment searches', () => {
    expect(sourceProfiles('independent').map(source => source.id)).toContain('autoraptor-crm')
    expect(sourceProfiles('independent').map(source => source.id)).toContain('dealercenter-dms')
    expect(sourceProfiles('independent').map(source => source.id)).toContain('dealerclick-dms')
    expect(sourceProfiles('franchise').map(source => source.id)).toContain('reynolds-focus-crm')
    expect(sourceProfiles('franchise').map(source => source.id)).toContain('dealerbuilt-oplogic-crm')
    expect(sourceProfiles('franchise').map(source => source.id)).toContain('autosoft-dms')
  })

  it('keeps inventory syndication outside the vAuto category', () => {
    expect(SOURCE_CATALOG.find(source => source.id === 'home-net')?.category).toBe('other')
    expect(SOURCE_CATALOG.find(source => source.id === 'dealer-specialties')?.category).toBe('other')
    expect(matchSourceProfile('vauto', 'HomeNet')).toBeUndefined()
    expect(matchSourceProfile('vauto', 'Dealer Specialties')).toBeUndefined()
  })

  it('does not add fusionZONE from an older OEM supplier package alone', () => {
    expect(SOURCE_CATALOG.some(source => source.id.includes('fusionzone') || source.aliases?.some(alias => /fusionzone/i.test(alias)))).toBe(false)
  })
})
