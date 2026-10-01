import { describe, expect, it } from 'vitest'
import { factoryPricing, factoryPriceLabel, formatFactoryPrice } from '../../extension/sidepanel/lib/factory-pricing.mjs'

describe('document-owned factory pricing', () => {
  it('prefers each explicit sticker amount and preserves its currency', () => {
    const prices = factoryPricing({windowSticker:{dataState:'current',totalMsrp:42000,basePrice:35000,pricingCurrency:'CAD'},factoryEquipment:{dataState:'current',totalMsrp:50000,basePrice:40000}})
    expect(prices.original).toEqual({value:42000,source:'window-sticker',currency:'CAD'})
    expect(prices.base).toEqual({value:35000,source:'window-sticker',currency:'CAD'})
    expect(formatFactoryPrice(prices.original.value,prices.original.currency)).toBe('CAD 42,000')
  })
  it('uses an explicit vAuto base when the sticker has only a total, without implying an OEM source', () => {
    const prices = factoryPricing({windowSticker:{dataState:'stale',totalMsrp:42000},factoryEquipment:{dataState:'current',basePrice:35000}})
    expect(prices.original.source).toBe('window-sticker')
    expect(prices.base).toEqual({value:35000,source:'vauto',currency:null})
    expect(factoryPriceLabel(prices.base.source,true)).toBe('vAuto base MSRP')
    expect(formatFactoryPrice(prices.base.value,prices.base.currency)).toBe('35,000')
  })
  it('never derives a base or uses incomplete documents or listing MSRP', () => {
    const prices = factoryPricing({windowSticker:{dataState:'incomplete',totalMsrp:50000,basePrice:41000},factoryEquipment:{dataState:'unavailable',basePrice:40000}})
    expect(prices.original.value).toBeNull()
    expect(prices.base.value).toBeNull()
    expect(factoryPricing({windowSticker:{dataState:'current',totalMsrp:42000}}).base.value).toBeNull()
  })
})
