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

export function autoCheckUrl(value) {
  const url = parseHttps(value)
  return url && OFFICIAL_HOSTS.has(url.hostname.toLowerCase()) && url.pathname.toLowerCase() === '/autocheck.aspx' ? url.href : null
}

export function windowStickerUrl(value) {
  const url = parseHttps(value)
  return url && OFFICIAL_HOSTS.has(url.hostname.toLowerCase()) && WINDOW_STICKER_PATH.test(url.pathname) ? url.href : null
}

/** vAuto's informational equipment label — never presented as a Monroney sticker. */
export function factoryEquipmentUrl(value) {
  const url = parseHttps(value)
  if (!url || url.hostname.toLowerCase() !== VAUTO_HOST || !VAUTO_PATH.test(url.pathname) || url.search || url.hash) return null
  return url.href
}

/** Photos come from dealer sites over https only; anything else is dropped. */
export function photoUrl(value) {
  const url = parseHttps(value)
  return url ? url.href : null
}
