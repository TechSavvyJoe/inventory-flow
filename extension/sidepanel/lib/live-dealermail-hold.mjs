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
    const cellValue = (cell) => String(cell.querySelector('input, select, textarea')?.value ?? cell.textContent ?? '').trim().toUpperCase()
    const headerRows = [...doc.querySelectorAll('tr')].filter((row) => {
      const cells = [...row.children].filter((cell) => ['TH', 'TD'].includes(cell.tagName))
      return cells[0]?.textContent.trim().toUpperCase() === 'HOLD ORDER' && cells[1]?.textContent.trim().toUpperCase() === 'STOCKNO'
    })
    if (headerRows.length !== 1) return { status: 'unavailable' }
    const header = headerRows[0]
    const table = header.closest('table')
    if (!table) return { status: 'unavailable' }
    const rows = [...table.querySelectorAll('tr')].filter((row) => row.closest('table') === table)
    const activeOrders = []
    let parsedRows = 0
    for (const row of rows) {
      if (row === header) continue
      const cells = [...row.children].filter((cell) => ['TH', 'TD'].includes(cell.tagName))
      // An unexpected row is not evidence of no holds. In particular, never
      // skip truncated source rows or an unrecognized order value.
      if (cells.length !== 8 || cells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) return { status: 'unavailable' }
      const order = cellValue(cells[0])
      if (!/^(?:DELETED|[1-9]\d*)$/.test(order)) return { status: 'unavailable' }
      if (cellValue(cells[1]) !== stock) return { status: 'unavailable' }
      parsedRows += 1
      if (order !== 'DELETED') activeOrders.push(order)
    }
    // A header-only response is recognized as empty only with the complete
    // eight-column schema. A partial header could be an incomplete response.
    if (!parsedRows && (header.children.length !== 8 || [...header.children].some((cell) => !cell.textContent.trim() || cell.colSpan !== 1 || cell.rowSpan !== 1))) return { status: 'unavailable' }
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
  if (!verified) {
    const lastKnownActiveHold = vehicle.hold.lastKnownActiveHold === true || vehicle.hold.hasActiveHold === true
    return { ...vehicle, hold: {
      ...vehicle.hold,
      state: 'unknown', dataState: 'stale', hasActiveHold: null, tone: 'unverified',
      lastKnownActiveHold,
      label: lastKnownActiveHold ? 'Last verified hold — confirm in DealerMail' : 'Hold status not verified',
      liveCheckStatus: check.status, liveCheckedAt: null,
    } }
  }
  const held = check.activeCount > 0
  const hold = {
    ...vehicle.hold,
    state: verified ? (held ? (check.activeCount > 1 ? 'multiple' : 'primary') : 'none_observed') : 'unknown',
    dataState: verified ? 'current' : 'unavailable',
    hasActiveHold: verified ? held : null,
    lastKnownActiveHold: verified ? false : vehicle.hold.lastKnownActiveHold === true,
    lastKnownNoHold: false,
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
