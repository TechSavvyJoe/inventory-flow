// @ts-nocheck -- pure projection of synthetic persisted release metadata.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it } from 'vitest'
import { storedPublicationCoverage } from '../../cloudflare/src/platform-coverage.mjs'

const release = metadata => ({report_date:'2026-10-05',published_at:'2026-10-05T12:00:00Z',metadata_json:JSON.stringify(metadata)})
describe('Owner stored publication aggregate projection',()=>{
  it('allowlists aggregate counts and registered stores without forwarding private markers',()=>{
    const result=storedPublicationCoverage(release({vehicleCount:8,publicRowCount:7,resourceRecordCount:0,
      publicStoreCounts:{northside:7,foreign:99},crmStoreCounts:{northside:6,foreign:99},activeStoreCounts:{northside:5},
      dealerMailVinReviewStocks:['PRIVATE_STOCK_MARKER'],warnings:['PRIVATE_WARNING_MARKER'],customer:'PRIVATE_CUSTOMER_MARKER',
      credentials:'PRIVATE_SECRET_MARKER',vin:'PRIVATE_VIN_MARKER',unknownCount:9}),['northside'])
    expect(result).toEqual({basis:'stored_publication',reportDate:'2026-10-05',publishedAt:'2026-10-05T12:00:00Z',
      counts:{vehicleCount:8,publicRowCount:7,resourceRecordCount:0},stores:[{storeKey:'northside',publicCount:7,crmCount:6,activeInventoryCount:5}]})
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
    expect(JSON.stringify(result)).not.toContain('foreign')
  })
  it.each([-1,1.5,'4',null,true,Number.MAX_SAFE_INTEGER+1])('omits invalid counter %s rather than substituting zero',value=>{
    expect(storedPublicationCoverage(release({vehicleCount:value,publicStoreCounts:{northside:value}}),['northside'])).toMatchObject({counts:{},stores:[]})
  })
  it('omits nonfinite values and ignores inherited store properties and malformed maps',()=>{
    const input={report_date:'2026-10-05',metadata_json:'{"vehicleCount":1e999,"publicRowCount":-1e999,"publicStoreCounts":[],"crmStoreCounts":{},"activeStoreCounts":{"northside":0}}'}
    expect(storedPublicationCoverage(input,['toString','northside','northside'])).toMatchObject({counts:{},stores:[{storeKey:'northside',activeInventoryCount:0}]})
  })
  it('preserves legacy missing counters as unknown',()=>{
    expect(storedPublicationCoverage(release({completedAt:'2026-10-05T11:00:00Z'}),['northside'])).toMatchObject({counts:{},stores:[]})
    expect(storedPublicationCoverage({report_date:'2026-10-05'})).toBeUndefined()
  })
  it.each(['invalid','null','[]','4','"PRIVATE_MARKER"'])('omits unavailable coverage for invalid metadata %s',metadata_json=>{
    expect(storedPublicationCoverage({metadata_json},['northside'])).toBeUndefined()
  })
})
