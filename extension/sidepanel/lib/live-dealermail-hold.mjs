const DEALERMAIL_HOSTS = new Set(['dealermail.com', 'www.dealermail.com'])

export function isDealerMailInventoryTab(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && DEALERMAIL_HOSTS.has(parsed.hostname.toLowerCase()) &&
      parsed.pathname.toLowerCase().startsWith('/prospect_manager/')
  } catch { return false }
}

// Runs in the active DealerMail tab. Only the status and count cross back to
// the panel; customer names, cookies, and the page HTML stay in DealerMail.
export async function inspectDealerMailHoldPage(stockNumber) {
  const stock = String(stockNumber ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9-]{3,32}$/.test(stock)) return { status: 'unavailable' }
  try {
    const url = new URL('/prospect_manager/V2_inventory_USED_hold_edit.asp', location.origin)
    url.searchParams.set('s', stock)
    const response = await fetch(url.href, { credentials: 'include', cache: 'no-store', redirect: 'follow' })
    if (!response.ok || new URL(response.url).origin !== location.origin) return { status: 'unavailable' }
    const html = await response.text()
    if (/Session Ended/i.test(html)) return { status: 'unavailable' }
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const headers = [...doc.querySelectorAll('th, td')].map((cell) => cell.textContent.trim().toUpperCase())
    if (!headers.includes('HOLD ORDER') || !headers.includes('STOCKNO')) return { status: 'unavailable' }
    const cellValue = (cell) => String(cell.querySelector('input, select, textarea')?.value ?? cell.textContent ?? '').trim().toUpperCase()
    const activeOrders = []
    for (const row of doc.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('td')]
      if (cells.length < 8) continue
      const order = cellValue(cells[0])
      if (!/^(?:DELETED|\d+)$/.test(order)) continue
      if (cellValue(cells[1]) !== stock) return { status: 'unavailable' }
      if (order !== 'DELETED') activeOrders.push(order)
    }
    if (activeOrders.length && (!activeOrders.includes('1') || new Set(activeOrders).size !== activeOrders.length)) {
      return { status: 'unavailable' }
    }
    return { status: 'verified', stock, activeCount: activeOrders.length, checkedAt: new Date().toISOString() }
  } catch { return { status: 'unavailable' } }
}

export async function dealerMailTabId({ tabs = globalThis.chrome?.tabs } = {}) {
  if (!tabs?.query) return null
  try {
    const openTabs = await tabs.query({ currentWindow: true })
    const tab = openTabs.filter((item) => item?.id && isDealerMailInventoryTab(item.url))
      .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)))[0]
    return tab?.id ?? null
  } catch { return null }
}

export async function checkLiveDealerMailHold(tabId, stock, { scripting = globalThis.chrome?.scripting } = {}) {
  if (!tabId || !scripting?.executeScript) return { status: 'unavailable' }
  try {
    const [result] = await scripting.executeScript({ target: { tabId }, func: inspectDealerMailHoldPage, args: [stock] })
    const check = result?.result
    if (check?.status !== 'verified' || check.stock !== String(stock).trim().toUpperCase() ||
        !Number.isInteger(check.activeCount) || check.activeCount < 0) return { status: 'unavailable' }
    return check
  } catch { return { status: 'unavailable' } }
}

export function withLiveDealerMailHold(vehicle, check) {
  if (!check) return vehicle
  const verified = check.status === 'verified'
  const held = verified && check.activeCount > 0
  const hold = {
    ...vehicle.hold,
    state: verified ? (held ? (check.activeCount > 1 ? 'multiple' : 'primary') : 'none_observed') : 'unknown',
    dataState: verified ? 'current' : 'unavailable',
    hasActiveHold: verified ? held : null,
    position: held ? (check.activeCount > 1 ? 'multiple' : 'primary') : null,
    backupCount: held ? check.activeCount - 1 : 0,
    label: verified ? (held ? 'Active hold verified in DealerMail' : 'No active hold in DealerMail')
      : check.status === 'checking' ? 'Checking DealerMail hold' : 'Live hold check unavailable',
    tone: verified ? (held ? 'held' : 'clear') : 'unverified',
    canViewEvidence: false,
    detailLoaded: false,
    evidence: [], comments: [], alerts: [], commentsCount: 0, alertsCount: 0, cdkStatus: null,
    liveCheckStatus: check.status,
    liveCheckedAt: verified ? check.checkedAt : null,
  }
  return { ...vehicle, hold }
}
