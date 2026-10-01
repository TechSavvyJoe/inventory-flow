// The one-page take-home sheet: a customer-facing summary of a vehicle built
// only from published facts. Nothing operational goes on it — no hold,
// custody, movement, manager-log, in-service or warranty estimates.
import { brandFor } from './brand.mjs'
import { el, icon } from './dom.mjs'
import * as fmt from './format.mjs'
import { certifiedTerms } from './warranty.mjs'
import { listingUrl as safeListingUrl } from './links.mjs'
import { customerHistorySummary } from './customer-history.mjs'

const STORE_NAMES = Object.freeze({ Howell: 'Bob Maxey Ford of Howell', Fowlerville: 'Bob Maxey Ford in Fowlerville', 'Ford Detroit': 'Bob Maxey Ford', Lincoln: 'Bob Maxey Lincoln' })
const STORE_SITES = Object.freeze({ Howell: 'bobmaxeyfordhowell.com', Fowlerville: 'bobmaxeyfordinfowlerville.com', 'Ford Detroit': 'bobmaxeyford.com', Lincoln: 'bobmaxeylincoln.com' })
const customerEquipmentLabel = (value) => value.replace(/^[·|.]\s*/, '')
  .replace(/\s+[·|]\s*(?:USD|CAD)\s*\$?[\d,]+(?:\.\d{2})?$/i, '')
  .replace(/\s+[·|]\s*NO\s*CHARGE$/i, '')
  .replace(/\s+[·|]\s*[A-Z]{2,}-[A-Z0-9-]+$/, '')
  .replace(/\s+\([A-Z0-9]{2,}(?:-[A-Z0-9]+)+\)$/, '').trim()
const safePhoto = (value) => {
  if (typeof value !== 'string') return false
  if (/^https:\/\//i.test(value) || /^data:image\//i.test(value)) return true
  // Repository-safe illustrations are served by the localhost preview only.
  try {
    const url = new URL(value)
    return globalThis.location?.hostname === '127.0.0.1' && url.origin === location.origin
      && /^\/demo-vehicles\/[a-z0-9-]+\.(?:jpg|png|webp)$/i.test(url.pathname)
      && !url.search && !url.hash
  } catch { return false }
}

/** The subset of a panel vehicle that may leave the building. */
export function takeHomeModel(vehicle, photos = []) {
  const equipment = (vehicle.equipment?.byCategory ?? []).flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))
  const labels = [...new Set(equipment.map(item => customerEquipmentLabel(item.label)).filter(Boolean))]
  const standout = [...new Set((vehicle.equipment?.standout ?? []).map((item) => customerEquipmentLabel(item.label)).filter(Boolean))]
  const ac = vehicle.documents?.autoCheck
  return {
    store: vehicle.homeStore,
    storeName: STORE_NAMES[vehicle.homeStore] ?? vehicle.homeStore,
    storeSite: STORE_SITES[vehicle.homeStore] ?? null,
    brand: brandFor(vehicle.homeStore),
    name: vehicle.name,
    descriptor: fmt.joinFacts([vehicle.bodyStyle, vehicle.drivetrain, vehicle.engine, vehicle.exteriorColor]),
    stockNumber: vehicle.stockNumber,
    vin: vehicle.vin,
    price: vehicle.price,
    mileage: vehicle.mileage,
    certified: vehicle.certifiedProgram ? certifiedTerms(vehicle.certifiedProgram.store) : null,
    photos: [...new Set(photos.filter(safePhoto))].slice(0, 4),
    specs: [
      ['Body', vehicle.bodyStyle], ['Drivetrain', vehicle.drivetrain], ['Engine', vehicle.engine], ['Transmission', vehicle.transmission], ['Fuel', vehicle.fuelType],
      ['Fuel economy', vehicle.specs?.mpgCity !== null || vehicle.specs?.mpgHighway !== null ? `${vehicle.specs?.mpgCity ?? '—'} city / ${vehicle.specs?.mpgHighway ?? '—'} hwy` : null],
      ['Exterior', vehicle.exteriorColor], ['Interior', vehicle.interiorColor],
    ].filter(([, value]) => value),
    highlights: [...new Set([...standout, ...labels])].slice(0, 8),
    equipment: labels,
    history: customerHistorySummary(ac),
    description: vehicle.dealerComments,
    listingUrl: safeListingUrl(vehicle.listing?.url),
    listed: vehicle.listing?.isListed === true,
  }
}

const money = (value) => (value === null || value === undefined ? null : fmt.formatMoney(value))

export function renderTakeHome(model, { now = new Date() } = {}) {
  const documentPhotos = [...new Set(model.photos)].slice(0, 3)
  const heroPhoto = documentPhotos[0] ?? null
  const supportingPhotos = documentPhotos.slice(1)
  const railHighlights = supportingPhotos.length ? [] : model.highlights.slice(0, 4)
  const remainingHighlights = model.highlights.slice(railHighlights.length)
  const equipmentCap = heroPhoto ? 24 : model.description ? 30 : 36
  const additionalEquipment = model.equipment.filter(label => !model.highlights.includes(label))
  const hidden = Math.max(0, additionalEquipment.length - equipmentCap)
  const site = model.storeSite
  const listing = safeListingUrl(model.listingUrl)
  return el('article', { class: 'th' },
    el('header', { class: 'th-head' },
      model.brand ? el('img', { class: `th-logo ${model.brand.wide ? '' : 'is-square'}`.trim(), src: model.brand.src, alt: model.brand.alt }) : el('b', { class: 'th-logo-text', text: model.storeName }),
      el('div', { class: 'th-store' }, el('b', { text: model.storeName }), site ? el('span', { text: site }) : null),
    ),
    el('section', { class: 'th-title' },
      el('div', {}, el('h1', { text: model.name }), model.descriptor ? el('p', { text: model.descriptor }) : null),
      model.certified ? el('span', { class: 'th-title-cert' }, icon('check', { size: 14 }), model.certified.name) : null,
    ),
    el('section', { class: 'th-hero' },
      el('div', { class: 'th-photos' },
        heroPhoto ? el('img', { class: 'th-photo', src: heroPhoto, alt: model.name, referrerpolicy: 'no-referrer' }) : el('div', { class: 'th-photo th-photo-empty' }, icon('image', { size: 22 }), el('span', { text: 'Photos available at the store' })),
      ),
      el('div', { class: 'th-hero-rail' },
        el('dl', { class: 'th-price' },
          el('div', { class: 'th-price-main' }, el('dt', { text: 'Price' }), el('dd', { text: money(model.price) ?? 'Call for price' })),
          model.mileage !== null && model.mileage !== undefined ? el('div', {}, el('dt', { text: 'Mileage' }), el('dd', { text: fmt.formatMileage(model.mileage) })) : null,
          el('div', {}, el('dt', { text: 'Stock' }), el('dd', { class: 'th-mono', text: model.stockNumber })),
        ),
        supportingPhotos.length ? el('div', { class: `th-thumbs ${supportingPhotos.length === 1 ? 'is-single' : ''}`.trim() }, ...supportingPhotos.map((src, index) => el('img', { src, alt: `${model.name} view ${index + 2}`, referrerpolicy: 'no-referrer' }))) : railHighlights.length ? el('div', { class: 'th-quick' }, el('b', { text:'Standout features' }), el('ul', {}, ...railHighlights.map(label => el('li', { text:label })))) : null,
      ),
    ),
    el('dl', { class: 'th-identity' },
      el('div', {}, el('dt', { text: 'VIN' }), el('dd', { class: 'th-mono', text: model.vin })),
      model.history ? el('div', {}, el('dt', { text: 'Vehicle history' }), el('dd', { text: model.history })) : null,
    ),
    el('section', { class: 'th-grid' },
      el('div', { class: 'th-block' }, el('h2', { text: 'Specifications' }), el('dl', { class: 'th-specs' }, ...model.specs.map(([label, value]) => el('div', {}, el('dt', { text: label }), el('dd', { text: value }))))),
      el('div', { class: 'th-block' }, el('h2', { text: 'Highlights' }), remainingHighlights.length ? el('ul', { class: 'th-chips' }, ...remainingHighlights.map((label) => el('li', { text: label }))) : el('p', { class: 'th-muted', text: 'Ask us about the equipment on this vehicle.' })),
    ),
    additionalEquipment.length ? el('section', { class: 'th-block' }, el('h2', { text: `Additional equipment · ${additionalEquipment.length}` }), el('ul', { class: 'th-equipment' }, ...additionalEquipment.slice(0, equipmentCap).map((label) => el('li', { text: label })), hidden ? el('li', { class: 'th-muted', text: `+ ${hidden} more captured items · ask the store for the complete list` }) : null)) : null,
    model.description || model.certified ? el('section', { class: `th-bottom-grid ${model.description && model.certified ? '' : 'is-single'}`.trim() },
      model.description ? el('div', { class: 'th-block' }, el('h2', { text: 'About this vehicle' }), el('p', { class: 'th-desc', text: model.description })) : null,
      model.certified ? el('div', { class: 'th-block th-cert-block' },
        el('span', { class: `th-cert th-cert-${model.certified.brand ?? 'generic'}` }, model.certified.brand ? el('img', { src: `../resource-brands/${model.certified.brand === 'ford' ? 'ford-blue-certified.svg' : 'lincoln-certified.png'}`, alt: model.certified.name }) : icon('badge-check', { size: 14 })),
        el('div', {}, el('h2', { text: model.certified.name }), el('ul', { class: 'th-terms' }, ...model.certified.terms.map((term) => el('li', { text: term }))), model.certified.note ? el('p', { class: 'th-cert-note', text: model.certified.note }) : null),
      ) : null,
    ) : null,
    el('footer', { class: 'th-foot' },
      listing ? el('a', { class: 'th-listing-link', href: listing, target: '_blank', rel: 'noopener noreferrer' }, 'View vehicle listing', icon('external', { size: 14 })) : null,
      el('span', { text: `Prepared ${fmt.formatDate(now)} · ${model.storeName}${site ? ` · ${site}` : ''}` }),
      el('span', { text: 'Price excludes tax, title, license and dealer fees. Vehicle information is believed accurate but not guaranteed; confirm equipment, mileage and availability with the dealership before purchase.' }),
    ),
  )
}
