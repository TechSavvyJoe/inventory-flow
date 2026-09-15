// Every outbound link the panel can open. Writes never happen here: the panel
// deep-links into the app's own request and tracking screens, so each action
// runs through the app's validation, role checks and idempotency, exactly as
// if the user had clicked the same button inside Inventory Flow.

const OFFICIAL_HOSTS = new Set([
  'www.bobmaxeyfordhowell.com',
  'www.bobmaxeyfordinfowlerville.com',
  'www.bobmaxeyford.com',
  'www.bobmaxeylincoln.com',
])
const WINDOW_STICKER_PATH = /^\/api\/vhcliaa\/inventory\/[0-9]{1,8}\/window-sticker$/i
const VAUTO_HOST = 'assets.cai-media-management.com'
const VAUTO_PATH = /^\/window-stickers\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i

// DealerMail's per-vehicle screens are HTML fragments that only work inside the
// full inventory page, so the app (and this panel) opens the complete screen
// and copies the stock number for DealerMail's own search box.
export const DEALERMAIL_INVENTORY_URL =
  'https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp?selectedStore=26,25,27,95'

function appUrl(origin, path, params = {}) {
  const url = new URL(path, origin)
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, String(value))
  return url.href
}

export function appHomeUrl(origin) { return appUrl(origin, '/') }
export function inventorySearchUrl(origin, query) { return appUrl(origin, '/inventory', { q: query }) }
export function workspaceUrl(origin, destination) {
  const destinations = { attention: ['/attention'], moves: ['/transfers'], new: ['/updates', { view: 'new' }], price: ['/updates', { view: 'price' }], service: ['/service'] }
  const target = Object.hasOwn(destinations, destination) ? destinations[destination] : null
  return target ? appUrl(origin, target[0], target[1]) : null
}
export function serviceStatusUrl(origin, vin) { return appUrl(origin, '/service', { vin }) }
export function requestVehicleUrl(origin, vin) { return appUrl(origin, '/transfers/new', { vin }) }
export function trackMovementUrl(origin, { transferId, vin }) {
  return transferId ? appUrl(origin, '/transfers', { id: transferId }) : appUrl(origin, '/transfers', { vin })
}

const FORD_INVOICE_BASE_URL = 'https://fordvisions.dealerconnection.com/vinv/GetInvoice.aspx'
const FORD_OASIS_BASE_URL = 'https://www.fordtechservice.dealerconnection.com/oasis/Index'

function normalizedVin(value) {
  const vin = String(value ?? '').trim().toUpperCase()
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null
}

/** Ford/Lincoln dealer tools for an exact VIN, mirroring the app; DealerConnection may require its own sign-in. */
export function fordInvoiceUrl(value) {
  const vin = normalizedVin(value)
  if (!vin) return null
  const url = new URL(FORD_INVOICE_BASE_URL)
  url.searchParams.set('v', vin); url.searchParams.set('n', ','); url.searchParams.set('pa', '00000'); url.searchParams.set('p', ''); url.searchParams.set('ct', 'USA')
  return url.href
}

export function fordOasisUrl(value) {
  const vin = normalizedVin(value)
  if (!vin) return null
  const url = new URL(FORD_OASIS_BASE_URL)
  url.searchParams.set('vin', vin)
  return url.href
}

function parseHttps(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    return url
  } catch { return null }
}

/** The dealer website listing for this exact vehicle, on an official host only. */
export function listingUrl(value) {
  const url = parseHttps(value)
  return url && OFFICIAL_HOSTS.has(url.hostname.toLowerCase()) ? url.href : null
}

function hasExactlyOneNonEmptyValue(url, key) {
  const values = url.searchParams.getAll(key)
  return values.length === 1 && Boolean(values[0]?.trim())
}

/** Mirrors the app's officialVehicleDocumentUrl guard; a captured report can
 * remain readable even when its original source URL is not safe to open. */
function officialDocumentUrl(value, kind, vehicleListingUrl) {
  const url = parseHttps(value)
  if (!url || !OFFICIAL_HOSTS.has(url.hostname.toLowerCase()) || url.hash) return null
  try {
    if (decodeURIComponent(url.pathname).split('/').includes('..')) return null
    if (vehicleListingUrl) {
      const listing = new URL(vehicleListingUrl)
      if (listing.protocol !== 'https:' || listing.hostname.toLowerCase() !== url.hostname.toLowerCase()) return null
    }
    const keys = [...url.searchParams.keys()]
    if (kind === 'autocheck') {
      if (url.pathname.toLowerCase() !== '/autocheck.aspx' || keys.length !== 2
        || !hasExactlyOneNonEmptyValue(url, 'sv') || !hasExactlyOneNonEmptyValue(url, 'ac')
        || keys.some((key) => key !== 'sv' && key !== 'ac')) return null
    } else {
      const allowed = new Set(['sv', 'make', 'vehicleType', 'dealerCode'])
      if (!WINDOW_STICKER_PATH.test(url.pathname) || keys.some((key) => !allowed.has(key))
        || keys.length < 3 || keys.length > 4
        || !hasExactlyOneNonEmptyValue(url, 'sv') || !hasExactlyOneNonEmptyValue(url, 'make')
        || !hasExactlyOneNonEmptyValue(url, 'vehicleType') || url.searchParams.getAll('dealerCode').length > 1) return null
    }
    return url.href
  } catch { return null }
}

export function autoCheckUrl(value, vehicleListingUrl) { return officialDocumentUrl(value, 'autocheck', vehicleListingUrl) }

export function windowStickerUrl(value, vehicleListingUrl) { return officialDocumentUrl(value, 'window-sticker', vehicleListingUrl) }

/** vAuto's informational equipment label — never presented as a Monroney sticker. */
export function factoryEquipmentUrl(value) {
  const url = parseHttps(value)
  if (!url || url.hostname.toLowerCase() !== VAUTO_HOST || !VAUTO_PATH.test(url.pathname) || url.search || url.hash) return null
  return url.href
}

function localOrLiteralHost(hostname) {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    || /^\[[0-9a-f:.]+\]$/i.test(host)
}

/** Photos come from dealer sites over https only; loopback and literal-IP
 * targets are dropped so a bad feed record cannot turn the panel into a
 * request to a local device. Production host allowlisting belongs at ingest. */
export function photoUrl(value) {
  const url = parseHttps(value)
  return url && !localOrLiteralHost(url.hostname) ? url.href : null
}
