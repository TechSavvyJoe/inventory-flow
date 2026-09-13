// Multi-criteria filtering and sorting over the panel's vehicles. Search
// ranking finds the exact vehicle; these narrow a list to the kind of vehicle
// a customer is asking for (make, body, drivetrain, fuel, year, price, miles,
// certified, listed, unheld) and order it the way the conversation needs.

export const SORTS = Object.freeze([
  { id: 'relevance', label: 'Best match' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'price-asc', label: 'Price · low to high' },
  { id: 'price-desc', label: 'Price · high to low' },
  { id: 'mileage-asc', label: 'Mileage · low to high' },
  { id: 'year-desc', label: 'Year · newest first' },
  { id: 'days-asc', label: 'Newest on the lot' },
  { id: 'days-desc', label: 'Longest on the lot' },
  { id: 'savings-desc', label: 'Most under MSRP' },
])

export const EMPTY_FILTERS = Object.freeze({
  makes: [], models: [], bodies: [], drivetrains: [], fuels: [], stores: [],
  yearMin: null, yearMax: null, priceMax: null, mileageMax: null,
  certified: false, listed: false, noHold: false, photos: false,
})

const norm = (value) => String(value ?? '').trim().toLowerCase()
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export function normalizeFilters(value) {
  const source = value && typeof value === 'object' ? value : {}
  const list = (key) => (Array.isArray(source[key]) ? [...new Set(source[key].map((item) => String(item).trim()).filter(Boolean))] : [])
  const num = (key) => number(source[key])
  return {
    makes: list('makes'), models: list('models'), bodies: list('bodies'), drivetrains: list('drivetrains'), fuels: list('fuels'), stores: list('stores'),
    yearMin: num('yearMin'), yearMax: num('yearMax'), priceMax: num('priceMax'), mileageMax: num('mileageMax'),
    certified: source.certified === true, listed: source.listed === true, noHold: source.noHold === true, photos: source.photos === true,
  }
}

function tally(vehicles, read) {
  const counts = new Map()
  for (const vehicle of vehicles) {
    const value = String(read(vehicle) ?? '').trim()
    if (!value) continue
    const key = norm(value)
    const entry = counts.get(key) ?? { value, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
}

/** Distinct values with counts, so the sheet only offers choices that exist. */
export function filterOptions(vehicles) {
  const years = vehicles.map((item) => number(Number(item.year))).filter((item) => item !== null)
  const prices = vehicles.map((item) => item.price).filter((item) => item !== null)
  const miles = vehicles.map((item) => item.mileage).filter((item) => item !== null)
  return {
    makes: tally(vehicles, (item) => item.make),
    models: tally(vehicles, (item) => item.model),
    bodies: tally(vehicles, (item) => item.bodyStyle),
    drivetrains: tally(vehicles, (item) => item.drivetrain),
    fuels: tally(vehicles, (item) => item.fuelType),
    stores: tally(vehicles, (item) => item.homeStore),
    yearMin: years.length ? Math.min(...years) : null,
    yearMax: years.length ? Math.max(...years) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    mileageMax: miles.length ? Math.max(...miles) : null,
    certified: vehicles.filter((item) => item.certified).length,
    photos: vehicles.filter((item) => item.photos.length).length,
  }
}

const inSet = (values, value) => values.length === 0 || values.some((item) => norm(item) === norm(value))

export function matchesFilters(vehicle, filters) {
  const f = filters
  const year = number(Number(vehicle.year))
  if (!inSet(f.makes, vehicle.make)) return false
  if (!inSet(f.models, vehicle.model)) return false
  if (!inSet(f.bodies, vehicle.bodyStyle)) return false
  if (!inSet(f.drivetrains, vehicle.drivetrain)) return false
  if (!inSet(f.fuels, vehicle.fuelType)) return false
  if (!inSet(f.stores, vehicle.homeStore)) return false
  if (f.yearMin !== null && (year === null || year < f.yearMin)) return false
  if (f.yearMax !== null && (year === null || year > f.yearMax)) return false
  if (f.priceMax !== null && (vehicle.price === null || vehicle.price > f.priceMax)) return false
  if (f.mileageMax !== null && (vehicle.mileage === null || vehicle.mileage > f.mileageMax)) return false
  if (f.certified && !vehicle.certified) return false
  if (f.listed && vehicle.listing?.isListed !== true) return false
  // "No hold" means the current snapshot found none — never an availability promise.
  if (f.noHold && vehicle.hold?.hasActiveHold !== false) return false
  if (f.photos && !vehicle.photos.length) return false
  return true
}

export function applyFilters(matches, filters) {
  return matches.filter((match) => matchesFilters(match.vehicle ?? match, filters))
}

// Missing values sort last in both directions.
const compare = (read, direction) => (left, right) => {
  const a = read(left.vehicle), b = read(right.vehicle)
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return direction * (a - b)
}
const asc = (read) => compare(read, 1)
const desc = (read) => compare(read, -1)
const byName = (left, right) => left.vehicle.name.localeCompare(right.vehicle.name) || left.vehicle.stockNumber.localeCompare(right.vehicle.stockNumber, undefined, { numeric: true })

export function sortMatches(matches, sortId, { hasQuery = false } = {}) {
  const comparators = {
    'price-asc': asc((v) => v.price), 'price-desc': desc((v) => v.price),
    'mileage-asc': asc((v) => v.mileage),
    'year-desc': desc((v) => number(Number(v.year))),
    'days-asc': asc((v) => v.daysListed), 'days-desc': desc((v) => v.daysListed),
    'savings-desc': desc((v) => v.savings),
    name: byName,
  }
  const comparator = comparators[sortId]
  if (!comparator) return hasQuery ? matches : [...matches].sort(byName)
  // Nulls sort last for every order; ties fall back to the name.
  return [...matches].sort((left, right) => comparator(left, right) || byName(left, right))
}

export function activeFilterCount(filters) {
  const f = normalizeFilters(filters)
  return [f.makes, f.models, f.bodies, f.drivetrains, f.fuels, f.stores].filter((list) => list.length).length
    + [f.yearMin !== null || f.yearMax !== null, f.priceMax !== null, f.mileageMax !== null, f.certified, f.listed, f.noHold, f.photos].filter(Boolean).length
}

const money = (value) => `$${Math.round(value / 1000)}k`

export function describeFilters(filters) {
  const f = normalizeFilters(filters)
  const parts = [
    f.makes.join('/'), f.models.join('/'), f.bodies.join('/'), f.drivetrains.join('/'), f.fuels.join('/'), f.stores.join('/'),
    f.yearMin !== null && f.yearMax !== null ? (f.yearMin === f.yearMax ? String(f.yearMin) : `${f.yearMin}–${f.yearMax}`) : f.yearMin !== null ? `${f.yearMin}+` : f.yearMax !== null ? `to ${f.yearMax}` : null,
    f.priceMax !== null ? `under ${money(f.priceMax)}` : null,
    f.mileageMax !== null ? `under ${Math.round(f.mileageMax / 1000)}k mi` : null,
    f.certified ? 'certified' : null, f.listed ? 'listed' : null, f.noHold ? 'no hold found' : null, f.photos ? 'with photos' : null,
  ].filter(Boolean)
  return parts.join(' · ')
}
