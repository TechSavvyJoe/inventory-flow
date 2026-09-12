// Adapters over the environment the panel runs in. In Chrome these are the
// real extension APIs; in `pnpm extension:preview` (a plain tab) they fall
// back to web storage so the same UI can be reviewed and screenshotted.
import { detectHost, normalizeSettings } from './config.mjs'

export const host = detectHost()
const SETTINGS_KEY = 'settings'
const CACHE_KEY = 'bootstrapCache'
const PENDING_KEY = 'pendingQuery'

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
