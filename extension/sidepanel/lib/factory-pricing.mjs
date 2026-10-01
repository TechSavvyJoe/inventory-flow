// Original document figures are separate from a dealer's listing MSRP.
// Base price must be explicit; never subtract options/destination or infer it.
const usable = source => source && ['current', 'stale'].includes(source.dataState)
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const currency = source => /^[A-Z]{3}$/.test(source?.pricingCurrency?.trim().toUpperCase() ?? '') ? source.pricingCurrency.trim().toUpperCase() : null

export function factoryPricing({ windowSticker, factoryEquipment } = {}) {
  const pick = key => {
    for (const [source, kind] of [[windowSticker, 'window-sticker'], [factoryEquipment, 'vauto']]) {
      if (usable(source) && number(source[key])) return { value:source[key], source:kind, currency:currency(source) }
    }
    return { value:null, source:null, currency:null }
  }
  return { original:pick('totalMsrp'), base:pick('basePrice') }
}

export function factoryPriceLabel(source, base = false) {
  return source === 'vauto' ? base ? 'vAuto base MSRP' : 'vAuto MSRP' : base ? 'Base MSRP' : 'Original MSRP'
}

export function formatFactoryPrice(value, currency) {
  if (!number(value)) return 'Not captured'
  return new Intl.NumberFormat('en-US', currency
    ? { style:'currency', currency, currencyDisplay:currency === 'USD' ? 'symbol' : 'code', minimumFractionDigits:0, maximumFractionDigits:2 }
    : { maximumFractionDigits:2 }).format(value).replace(/\u00a0/g, ' ')
}
