const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character])
const safeHttps = (value) => { try { return new URL(value).protocol === 'https:' } catch { return false } }

export function normalizeTakeHomeDocument(payload) {
  const source = payload?.version === 2 && Array.isArray(payload.models) ? payload.models : payload ? [payload] : []
  const models = [...new Map(source.filter((model) => model && typeof model === 'object' && typeof model.vin === 'string').map((model) => [model.vin, model])).values()]
  return { version:2, listLabel:typeof payload?.listLabel === 'string' ? payload.listLabel.trim() : '', models }
}

export const publicListingLinks = (models) => [...new Set(models.map((model) => model.listingUrl).filter(safeHttps))]

export function standaloneTakeHomeHtml(root, title, css = '') {
  const clone = root.cloneNode(true)
  clone.querySelectorAll('a[href]').forEach((link) => { if (!safeHttps(link.href)) link.removeAttribute('href') })
  clone.querySelectorAll('img[src]').forEach((image) => {
    try { const url = new URL(image.src); if (!['https:', 'data:', 'chrome-extension:'].includes(url.protocol)) image.removeAttribute('src') } catch { image.removeAttribute('src') }
  })
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}</style></head><body class="th-page"><main class="th-stage">${clone.innerHTML}</main></body></html>`
}

export async function selfContainedTakeHomeHtml(root, title, css = '', fetcher = globalThis.fetch) {
  const clone = root.cloneNode(true)
  await Promise.all([...clone.querySelectorAll('img[src]')].map(async (image) => {
    if (image.src.startsWith('data:image/')) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await fetcher(image.src, { signal: controller.signal }); const blob = await response.blob()
      if (!response.ok || !blob.type.startsWith('image/') || blob.size > 6 * 1024 * 1024) return
      image.src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
    } catch { /* Retain the vetted source URL if embedding is blocked. */ }
    finally { clearTimeout(timeout) }
  }))
  return standaloneTakeHomeHtml(clone, title, css)
}

export function downloadTakeHomeHtml(html, title, environment = globalThis) {
  const fileName = `${String(title).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'vehicle-list'}.html`
  const url = environment.URL.createObjectURL(new Blob([html], { type:'text/html;charset=utf-8' }))
  const link = environment.document.createElement('a'); link.href = url; link.download = fileName; link.click(); environment.URL.revokeObjectURL(url)
  return fileName
}

export async function shareTakeHomeHtml({ html, title, links, environment = globalThis }) {
  const fileName = `${String(title).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'vehicle-list'}.html`
  const file = new File([html], fileName, { type:'text/html' })
  if (environment.navigator.share && (!environment.navigator.canShare || environment.navigator.canShare({ files:[file] }))) {
    try { await environment.navigator.share({ title, files:[file] }); return 'shared' }
    catch (error) { if (error?.name === 'AbortError') return 'cancelled' }
  }
  if (links.length && environment.navigator.clipboard?.writeText) {
    try { await environment.navigator.clipboard.writeText(links.join('\n')); return 'copied' } catch { /* Save when clipboard permission is denied. */ }
  }
  downloadTakeHomeHtml(html, title, environment); return 'saved'
}
