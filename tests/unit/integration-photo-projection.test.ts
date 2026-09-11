// @vitest-environment node
// @ts-nocheck -- SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS; no live data or requests.
import { describe, expect, it } from 'vitest'
import { integrationBootstrapFromSource } from '../../server/integrations/source-bootstrap.mjs'
import { createIntegrationReadService } from '../../server/integrations/read-service.mjs'

const VIN = '1FTFW1E50NFA00001', OTHER_VIN = '1FTFW1E50NFA00002'
const STORES = {
  Howell: 'www.bobmaxeyfordhowell.com',
  Fowlerville: 'www.bobmaxeyfordinfowlerville.com',
  'Ford Detroit': 'www.bobmaxeyford.com',
  Lincoln: 'www.bobmaxeylincoln.com',
}
const photo = (host = STORES.Howell, index = 1, vin = VIN) => `https://${host}/inventoryphotos/100/${vin}/${index}.jpg`
function projected(urls, store = 'Howell') {
  const release = { vehicles: [{ vin: VIN, publicRecord: { vin: VIN, store, stock_number: 'SYNTHETIC-0001', photo_count: urls.length } }] }
  const bootstrap = {
    meta: { reportDate: '2026-09-09', publicFreshness: 'current', dealerMailFreshness: 'current' },
    vehicles: [{ vin: VIN, imageUrl: urls[0] ?? null, imageUrls: urls, hold: {}, movement: {} }],
  }
  return createIntegrationReadService({
    bootstrap: integrationBootstrapFromSource(bootstrap, release),
    principal: { clientId: 'synthetic-gallery-client', userId: 'synthetic-user', role: 'sales', stores: Object.keys(STORES), scopes: ['inventory.read'] },
    bundleSha256: 'a'.repeat(64), cursorSecret: 'synthetic-gallery-cursor-key-0123456789',
  })
}

describe('VIN-specific public gallery integration', () => {
  it.each(Object.entries(STORES))('retains the complete approved %s gallery through bootstrap, list and detail', (store, host) => {
    const urls = [photo(host, 1), photo(host, 2), photo(host, 3)]
    const api = projected(urls, store)
    expect(api.inventory().data[0]).toMatchObject({ photoCount: 3, imageUrl: urls[0], imageUrls: urls })
    expect(api.vehicle(VIN).data).toMatchObject({ photoCount: 3, imageUrl: urls[0], imageUrls: urls })
  })

  it('retains same-VIN dealer photos across stores without mistaking the photo host for physical location', () => {
    const urls = Object.values(STORES).map(host => photo(host))
    const value = projected(urls).vehicle(VIN).data
    expect(value.imageUrls).toEqual(urls)
    expect(value.publicStore).toBe('Howell')
  })

  it('canonicalizes accepted dealer image paths and drops unrelated queries and fragments', () => {
    const url = `https://WWW.BOBMAXEYFORDHOWELL.COM/inventoryphotos//100/${VIN}/1.JPG?width=640#viewer`
    const value = projected([url]).vehicle(VIN).data
    expect(value.imageUrl).toBe(`https://www.bobmaxeyfordhowell.com/inventoryphotos/100/${VIN}/1.JPG`)
    expect(value.imageUrls).toEqual([value.imageUrl])
  })

  it.each([
    photo('www.bobmaxeyfordhowell.com.unapproved.example'),
    photo('photos.www.bobmaxeyfordhowell.com'),
    photo('bobmaxeyfordhowell.com'),
    photo('unapproved.example'),
    photo(STORES.Howell, 1, OTHER_VIN),
    `https://${STORES.Howell}/inventoryphotos/100/${OTHER_VIN}/1.jpg?vin=${VIN}`,
    `https://${STORES.Howell}/inventoryphotos/100/${OTHER_VIN}/${VIN}.jpg`,
    `https://${STORES.Howell}/other/${VIN}/1.jpg`,
    photo().replace('https:', 'http:'),
    photo().replace('https://', 'https://user:password@'),
    photo().replace('.com/', '.com:8443/'),
    photo().replace('.jpg', '.svg'),
    photo().replace('.jpg', '.html'),
    `https://${STORES.Howell}/inventoryphotos/100/${VIN}/%2e%2e%2fprivate.jpg`,
    `https://${STORES.Howell}/inventoryphotos/100/${VIN}/%2e%2e%5cprivate.jpg`,
    `https://${STORES.Howell}/inventoryphotos/100/${VIN}/%ZZ.jpg`,
    photo() + '?access_token=synthetic-secret',
    photo() + '?session=synthetic-session',
  ])('rejects an unapproved, unrelated or unsafe dealer photo %#', url => {
    const value = projected([url]).vehicle(VIN).data
    expect(value.imageUrl).toBeNull()
    expect(value.imageUrls).toEqual([])
  })

  it('preserves existing approved CDN hosts without expanding their host or credential rules', () => {
    const accepted = ['dealeron.com', 'homenetinc.com', 'cai-media-management.com', 'vauto.com'].map(host => `https://images.${host}/synthetic-car.jpg`)
    expect(projected(accepted).vehicle(VIN).data.imageUrls).toEqual(accepted)
    const rejected = ['https://dealeron.com.unapproved.example/car.jpg', 'https://images.dealeron.com/car.jpg?api_key=synthetic-secret']
    expect(projected(rejected).vehicle(VIN).data.imageUrls).toEqual([])
  })
})
