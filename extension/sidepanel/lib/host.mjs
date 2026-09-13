// Adapters over the environment the panel runs in. In Chrome these are the
// real extension APIs; in `pnpm extension:preview` (a plain tab) they fall
// back to web storage so the same UI can be reviewed and screenshotted.
import { detectHost, normalizeSettings } from './config.mjs'

export const host = detectHost()
const SETTINGS_KEY = 'settings'
const CACHE_KEY = 'bootstrapCache'
const PENDING_KEY = 'pendingQuery'
const COMPARE_KEY = 'compare'
const FILTERS_KEY = 'filters'
const TAKEHOME_PREFIX = 'takehome:'
// A page opened with window.open does not reliably share sessionStorage, so
// the preview hands the take-home model over through localStorage instead.
const handoffArea = () => (host === 'extension' ? chrome.storage.session : webStore(globalThis.localStorage))

const webStore = (area) => ({
  async get(key) { try { const raw = area.getItem(`ifx.${key}`); return raw ? { [key]: JSON.parse(raw) } : {} } catch { return {} } },
  async set(values) { for (const [key, value] of Object.entries(values)) { try { area.setItem(`ifx.${key}`, JSON.stringify(value)) } catch { /* quota or private mode */ } } },
  async remove(key) { try { area.removeItem(`ifx.${key}`) } catch { /* ignore */ } },
})

const syncArea = host === 'extension' ? chrome.storage.sync : webStore(globalThis.localStorage)
const sessionArea = host === 'extension' ? chrome.storage.session : webStore(globalThis.sessionStorage)

export const storage = {
  async getSettings() { const { [SETTINGS_KEY]: value } = await syncArea.get(SETTINGS_KEY); return normalizeSettings(value) },
  async setSettings(patch) {
    const next = normalizeSettings({ ...(await this.getSettings()), ...patch })
    await syncArea.set({ [SETTINGS_KEY]: next })
    return next
  },
  async getCache() { const { [CACHE_KEY]: value } = await sessionArea.get(CACHE_KEY); return value && typeof value === 'object' ? value : null },
  async setCache(value) { try { await sessionArea.set({ [CACHE_KEY]: value }) } catch { /* over quota: live data still renders */ } },
  async clearCache() { await sessionArea.remove(CACHE_KEY) },
  /** The compare set is just VINs; it is pruned against live inventory on every load. */
  async getCompare() { const { [COMPARE_KEY]: value } = await sessionArea.get(COMPARE_KEY); return Array.isArray(value) ? value.filter((vin) => typeof vin === 'string').slice(0, 3) : [] },
  async setTakeHome(vin, model) { await handoffArea().set({ [`${TAKEHOME_PREFIX}${vin}`]: model }) },
  async takeTakeHome(vin) {
    const key = `${TAKEHOME_PREFIX}${vin}`
    const { [key]: value } = await handoffArea().get(key)
    // Left in place so a reload of the print tab still renders; it is only
    // the published subset and lives no longer than the session.
    return value && typeof value === 'object' ? value : null
  },
  async getFilters() { const { [FILTERS_KEY]: value } = await sessionArea.get(FILTERS_KEY); return value && typeof value === 'object' ? value : null },
  async setFilters(value) { try { await sessionArea.set({ [FILTERS_KEY]: value }) } catch { /* ignore */ } },
  async setCompare(vins) { try { await sessionArea.set({ [COMPARE_KEY]: vins.slice(0, 3) }) } catch { /* ignore */ } },
  async takePendingQuery() {
    const { [PENDING_KEY]: value } = await sessionArea.get(PENDING_KEY)
    if (!value?.text) return null
    await sessionArea.remove(PENDING_KEY)
    return String(value.text)
  },
  onPendingQuery(callback) {
    if (host !== 'extension') return
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes[PENDING_KEY]?.newValue?.text) {
        sessionArea.remove(PENDING_KEY).catch(() => {})
        callback(String(changes[PENDING_KEY].newValue.text))
      }
    })
  },
}

/** Preview-only: `?photos=1` paints generated placeholder photos so the photo
 * hero and thumbnails can be reviewed with the synthetic fixture, which has none.
 * Never active in the extension. */
export const previewFlags = Object.freeze({
  photos: host === 'preview' && new URLSearchParams(location.search).has('photos'),
})

export function placeholderPhotos(vehicle, count = 4) {
  const hue = Math.abs([...vehicle.vin].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 360
  return Array.from({ length: count }, (_, index) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="hsl(${hue} 32% ${58 - index * 6}%)"/><rect x="40" y="96" width="240" height="56" rx="14" fill="hsl(${hue} 40% 26%)"/><rect x="80" y="64" width="150" height="44" rx="14" fill="hsl(${hue} 40% 30%)"/><circle cx="96" cy="152" r="18" fill="#101820"/><circle cx="224" cy="152" r="18" fill="#101820"/><text x="160" y="186" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#fff" opacity=".8">Placeholder ${index + 1} · ${vehicle.stockNumber}</text></svg>`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/** Opens one of the extension's own pages (print sheet) in a tab. */
export function openExtensionPage(path) {
  if (host === 'extension') { openUrl(chrome.runtime.getURL(`sidepanel/${path}`)); return }
  window.open(new URL(path, location.href).href, '_blank')
}

export function openUrl(url) {
  if (host === 'extension') { chrome.tabs.create({ url }).catch(() => window.open(url, '_blank', 'noopener,noreferrer')); return }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function copyText(value) {
  try { await navigator.clipboard.writeText(value); return true } catch { /* fall through */ }
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:-1000px;opacity:0'
  document.body.append(area)
  area.select()
  let copied = false
  try { copied = document.execCommand('copy') } catch { copied = false }
  area.remove()
  return copied
}
