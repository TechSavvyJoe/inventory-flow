// Three jobs only: open the side panel, hand a text selection to it, and
// execute an explicitly user-initiated saved-list mutation in the app origin.
// State never lives here (the worker is ephemeral); the panel owns its own.

const MENU_ID = 'inventory-flow-search-selection'
const SAVED_LIST_MESSAGE = 'inventory-flow:saved-list-mutation'
const ALLOWED_ORIGINS = new Set(['https://inventory-ops.joegallant.me', 'http://127.0.0.1:4173'])
const DEMO_ROLES = new Set(['sales', 'manager', 'coordinator', 'porter', 'driver', 'group_manager'])
const DEMO_STORES = new Set(['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'])
const ACTION_FIELDS = Object.freeze({
  create: ['action', 'label'], rename: ['action', 'listId', 'label', 'expectedRevision'],
  delete: ['action', 'listId', 'expectedRevision'], add: ['action', 'listId', 'vin', 'expectedRevision'],
  remove: ['action', 'listId', 'vin', 'expectedRevision'],
})

function validSavedListMessage(message, sender) {
  if (sender.id !== chrome.runtime.id || sender.tab ||
      sender.url !== chrome.runtime.getURL('sidepanel/index.html') ||
      message?.type !== SAVED_LIST_MESSAGE || !ALLOWED_ORIGINS.has(message.origin)) return false
  const action = String(message.input?.action ?? '')
  const fields = ACTION_FIELDS[action]
  const expectedOwnerId = message.expectedOwnerId
  return Boolean(fields && message.input && typeof message.input === 'object' && !Array.isArray(message.input) &&
    Object.keys(message.input).every((key) => fields.includes(key)) &&
    typeof message.idempotencyKey === 'string' && message.idempotencyKey.length > 0 && message.idempotencyKey.length <= 160 &&
    typeof expectedOwnerId === 'string' && expectedOwnerId.length > 0 && expectedOwnerId.length <= 160 &&
    expectedOwnerId === expectedOwnerId.trim() && !/[\u0000-\u001f\u007f]/u.test(expectedOwnerId) &&
    (message.origin !== 'http://127.0.0.1:4173' ||
      (DEMO_ROLES.has(message.demo?.role) && DEMO_STORES.has(message.demo?.store))))
}

async function waitForTab(tabId) {
  const current = await chrome.tabs.get(tabId)
  if (current.status === 'complete') return
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('App tab timed out')) }, 15000)
    function listener(updatedId, change) {
      if (updatedId !== tabId || change.status !== 'complete') return
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function savedListMutation(message) {
  let createdTab = false
  let tab = (await chrome.tabs.query({ url: `${message.origin}/*` }))[0]
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: message.origin, active: false })
    createdTab = true
  }
  try {
    await waitForTab(tab.id)
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      args: [message.input, message.idempotencyKey, message.origin, message.demo ?? null, message.expectedOwnerId],
      func: async (input, idempotencyKey, expectedOrigin, demo, expectedOwnerId) => {
        if (location.origin !== expectedOrigin) return { kind: 'signin', status: 0 }
        const endpoint = new URL('/api/saved-lists', expectedOrigin)
        const requestHeaders = {
          Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey,
          'x-inventory-saved-list-owner': expectedOwnerId,
        }
        if (demo) {
          endpoint.searchParams.set('role', demo.role)
          endpoint.searchParams.set('homeStore', demo.store)
          requestHeaders['x-inventory-demo-role'] = demo.role
          requestHeaders['x-inventory-demo-store'] = demo.store
          requestHeaders['x-inventory-demo-user'] = 'Local prototype user'
        }
        let response
        try {
          response = await fetch(endpoint.href, {
            method: 'POST', credentials: 'include', redirect: 'manual', cache: 'no-store',
            headers: requestHeaders,
            body: JSON.stringify(input),
          })
        } catch { return { kind: 'offline', status: 0 } }
        const contentType = response.headers.get('content-type') ?? ''
        const payload = /^application\/json(?:\s*;|$)/i.test(contentType) ? await response.json().catch(() => null) : null
        return { status: response.status, redirected: response.type === 'opaqueredirect', payload }
      },
    })
    return execution?.result ?? { kind: 'server', status: 0 }
  } finally {
    if (createdTab && tab?.id) await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

async function configure() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({ id: MENU_ID, title: 'Search Inventory Flow for “%s”', contexts: ['selection'] })
}

chrome.runtime.onInstalled.addListener(() => { configure().catch((error) => console.error('Deal Desk setup failed', error)) })
chrome.runtime.onStartup.addListener(() => { configure().catch((error) => console.error('Deal Desk setup failed', error)) })

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.windowId) return
  const text = String(info.selectionText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  // Opening the panel consumes the user gesture, so it must come before any
  // await; the query is stored right after and the panel picks it up.
  chrome.sidePanel.open({ windowId: tab.windowId })
    .then(() => chrome.storage.session.set({ pendingQuery: { text, at: Date.now() } }))
    .catch((error) => console.error('Deal Desk could not open', error))
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!validSavedListMessage(message, sender)) return false
  savedListMutation(message).then(sendResponse, () => sendResponse({ kind: 'server', status: 0 }))
  return true
})
