// Workspaces the panel can talk to. Production is the Access-gated app; the
// local demo is the synthetic `pnpm dev:demo` server and is never live data.
export const WORKSPACES = Object.freeze({
  production: Object.freeze({ id: 'production', label: 'Production', origin: 'https://inventory-ops.joegallant.me', demo: false }),
  demo: Object.freeze({ id: 'demo', label: 'Local demo', origin: 'http://127.0.0.1:4173', demo: true }),
})

export const STORES = Object.freeze(['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'])
export const ROLES = Object.freeze(['sales', 'manager', 'coordinator', 'porter', 'driver', 'group_manager'])

export const DEFAULT_SETTINGS = Object.freeze({
  workspace: 'production',
  theme: 'light',       // Match the app for new installs; preserve saved system | light | dark.
  density: 'comfortable', // comfortable | compact
  demoRole: 'sales',
  demoStore: 'Howell',
})

// Bootstrap is re-fetched in the background once it is older than this while
// the panel is open; a manual refresh is always available in the footer.
export const STALE_AFTER_MS = 5 * 60 * 1000

export function normalizeSettings(value) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    workspace: Object.hasOwn(WORKSPACES, input.workspace) ? input.workspace : DEFAULT_SETTINGS.workspace,
    theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    density: ['comfortable', 'compact'].includes(input.density) ? input.density : DEFAULT_SETTINGS.density,
    demoRole: ROLES.includes(input.demoRole) ? input.demoRole : DEFAULT_SETTINGS.demoRole,
    demoStore: STORES.includes(input.demoStore) ? input.demoStore : DEFAULT_SETTINGS.demoStore,
  }
}

/**
 * The panel runs in three hosts: the real Chrome side panel, a plain browser
 * tab during `pnpm extension:preview` (no chrome.* APIs, same-origin proxy to
 * the demo API), and Node during unit tests. Everything else in the panel asks
 * this module rather than sniffing `chrome` itself.
 */
export function detectHost() {
  const chromeApi = globalThis.chrome
  if (chromeApi?.storage?.sync && chromeApi?.runtime?.id) return 'extension'
  if (typeof location !== 'undefined' && location.protocol.startsWith('http')) return 'preview'
  return 'node'
}

export function workspaceFor(settings, host = detectHost()) {
  if (host === 'preview') {
    // The preview server proxies /api to the demo API on its own origin.
    return { id: 'demo', label: 'Local demo (preview)', origin: location.origin, demo: true }
  }
  return WORKSPACES[settings.workspace] ?? WORKSPACES.production
}
