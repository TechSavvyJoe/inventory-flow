// Two jobs only: open the side panel, and hand a text selection to it.
// State never lives here (the worker is ephemeral); the panel owns its own.

const MENU_ID = 'inventory-flow-search-selection'

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
