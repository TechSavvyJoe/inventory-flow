// The one-page take-home sheet: a customer-facing summary of a vehicle built
// only from published facts. Nothing operational goes on it — no hold,
// custody, movement, manager-log, in-service or warranty estimates.
import { brandFor } from './brand.mjs'
import { el, icon } from './dom.mjs'
import * as fmt from './format.mjs'
import { certifiedTerms } from './warranty.mjs'
import { listingUrl as safeListingUrl } from './links.mjs'

const STORE_NAMES = Object.freeze({ Howell: 'Bob Maxey Ford of Howell', Fowlerville: 'Bob Maxey Ford in Fowlerville', 'Ford Detroit': 'Bob Maxey Ford', Lincoln: 'Bob Maxey Lincoln' })
const STORE_SITES = Object.freeze({ Howell: 'bobmaxeyfordhowell.com', Fowlerville: 'bobmaxeyfordinfowlerville.com', 'Ford Detroit': 'bobmaxeyford.com', Lincoln: 'bobmaxeylincoln.com' })

/** The subset of a panel vehicle that may leave the building. */
export function takeHomeModel(vehicle, photos = []) {
  const equipment = (vehicle.equipment?.byCategory ?? []).flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))
  const standout = (vehicle.equipment?.standout ?? []).map((item) => item.label)
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
    msrp: vehicle.msrp,
    savings: vehicle.savings,
    mileage: vehicle.mileage,
    certified: vehicle.certifiedProgram ? certifiedTerms(vehicle.certifiedProgram.store) : null,
    photos: photos.slice(0, 4),
    specs: [
      ['Body', vehicle.bodyStyle], ['Drivetrain', vehicle.drivetrain], ['Engine', vehicle.engine], ['Transmission', vehicle.transmission], ['Fuel', vehicle.fuelType],
      ['Fuel economy', vehicle.specs?.mpgCity !== null || vehicle.specs?.mpgHighway !== null ? `${vehicle.specs?.mpgCity ?? '—'} city / ${vehicle.specs?.mpgHighway ?? '—'} hwy` : null],
      ['Exterior', vehicle.exteriorColor], ['Interior', vehicle.interiorColor],
    ].filter(([, value]) => value),
    highlights: standout.length ? standout.slice(0, 8) : equipment.slice(0, 8).map((item) => item.label),
    equipment: equipment.map((item) => item.label),
    history: ac ? fmt.joinFacts([ac.score !== null ? `AutoCheck score ${ac.score}` : null, ac.ownerCount !== null ? `${ac.ownerCount} owner${ac.ownerCount === 1 ? '' : 's'} reported` : null]) || null : null,
    description: vehicle.dealerComments,
    listingUrl: safeListingUrl(vehicle.listing?.url),
    listed: vehicle.listing?.isListed === true,
  }
}

const money = (value) => (value === null || value === undefined ? null : fmt.formatMoney(value))

export function renderTakeHome(model, { now = new Date() } = {}) {
  const heroPhoto = model.photos[0] ?? null
  const equipmentCap = model.description ? 27 : 36
  const hidden = Math.max(0, model.equipment.length - equipmentCap)
  const site = model.storeSite
  const listing = safeListingUrl(model.listingUrl)
  return el('article', { class: 'th' },
    el('header', { class: 'th-head' },
      model.brand ? el('img', { class: `th-logo ${model.brand.wide ? '' : 'is-square'}`.trim(), src: model.brand.src, alt: model.brand.alt }) : el('b', { class: 'th-logo-text', text: model.storeName }),
      el('div', { class: 'th-store' }, el('b', { text: model.storeName }), site ? el('span', { text: site }) : null),
    ),
    el('section', { class: 'th-title' },
      el('div', {}, el('h1', { text: model.name }), model.descriptor ? el('p', { text: model.descriptor }) : null),
      model.certified ? el('span', { class: 'th-cert' }, icon('badge-check', { size: 14 }), model.certified.name) : null,
    ),
    el('section', { class: `th-hero ${heroPhoto ? '' : 'is-empty'}`.trim() },
      el('div', { class: 'th-photos' },
        heroPhoto ? el('img', { class: 'th-photo', src: heroPhoto, alt: model.name, referrerpolicy: 'no-referrer' }) : el('div', { class: 'th-photo th-photo-empty' }, icon('image', { size: 22 }), el('span', { text: 'Photos available at the store' })),
        model.photos.length > 1 ? el('div', { class: 'th-thumbs' }, ...model.photos.slice(1, 4).map((src) => el('img', { src, alt: '', referrerpolicy: 'no-referrer' }))) : null,
      ),
      el('dl', { class: 'th-price' },
        el('div', { class: 'th-price-main' }, el('dt', { text: 'Price' }), el('dd', { text: money(model.price) ?? 'Call for price' })),
        model.msrp !== null && model.msrp !== undefined ? el('div', {}, el('dt', { text: 'MSRP' }), el('dd', { text: money(model.msrp) })) : null,
        model.savings ? el('div', { class: 'th-save' }, el('dt', { text: 'Under MSRP' }), el('dd', { text: money(model.savings) })) : null,
        model.mileage !== null && model.mileage !== undefined ? el('div', {}, el('dt', { text: 'Mileage' }), el('dd', { text: fmt.formatMileage(model.mileage) })) : null,
        el('div', {}, el('dt', { text: 'Stock' }), el('dd', { class: 'th-mono', text: model.stockNumber })),
        el('div', {}, el('dt', { text: 'VIN' }), el('dd', { class: 'th-mono', text: model.vin })),
        model.history ? el('div', {}, el('dt', { text: 'History' }), el('dd', { text: model.history })) : null,
      ),
    ),
    el('section', { class: 'th-grid' },
      el('div', { class: 'th-block' }, el('h2', { text: 'Specifications' }), el('dl', { class: 'th-specs' }, ...model.specs.map(([label, value]) => el('div', {}, el('dt', { text: label }), el('dd', { text: value }))))),
      el('div', { class: 'th-block' }, el('h2', { text: 'Highlights' }), model.highlights.length ? el('ul', { class: 'th-chips' }, ...model.highlights.map((label) => el('li', { text: label }))) : el('p', { class: 'th-muted', text: 'Ask us about the equipment on this vehicle.' })),
    ),
    model.equipment.length ? el('section', { class: 'th-block' }, el('h2', { text: `Equipment · ${model.equipment.length}` }), el('ul', { class: 'th-equipment' }, ...model.equipment.slice(0, equipmentCap).map((label) => el('li', { text: label })), hidden ? el('li', { class: 'th-muted', text: `+ ${hidden} more captured items · ask the store for the complete list` }) : null)) : null,
    model.description ? el('section', { class: 'th-block' }, el('h2', { text: 'About this vehicle' }), el('p', { class: 'th-desc', text: model.description })) : null,
    model.certified ? el('section', { class: 'th-block th-cert-block' }, el('h2', { text: model.certified.name }), el('ul', { class: 'th-terms' }, ...model.certified.terms.map((term) => el('li', { text: term })))) : null,
    el('footer', { class: 'th-foot' },
      listing ? el('a', { class: 'th-listing-link', href: listing, target: '_blank', rel: 'noopener noreferrer' }, 'View vehicle listing', icon('external', { size: 14 })) : null,
      el('span', { text: `Prepared ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ${model.storeName}${site ? ` · ${site}` : ''}` }),
      el('span', { text: 'Price excludes tax, title, license and dealer fees. Vehicle information is believed accurate but not guaranteed; confirm equipment, mileage and availability with the dealership before purchase.' }),
    ),
  )
}
