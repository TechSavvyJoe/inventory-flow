const safeHttps = (value) => { try { return new URL(value).protocol === 'https:' } catch { return false } }

export function normalizeTakeHomeDocument(payload) {
  const source = payload?.version === 2 && Array.isArray(payload.models) ? payload.models : payload ? [payload] : []
  const models = [...new Map(source.filter((model) => model && typeof model === 'object' && typeof model.vin === 'string').map((model) => [model.vin, model])).values()]
  return { version:2, listLabel:typeof payload?.listLabel === 'string' ? payload.listLabel.trim() : '', models }
}

export const publicListingLinks = (models) => [...new Set(models.map((model) => model.listingUrl).filter(safeHttps))]

const pdfName = title => `${String(title).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'vehicle-list'}.pdf`

export function downloadTakeHomePdf(pdf, title, environment = globalThis) {
  const fileName = pdfName(title)
  if (pdf?.type !== 'application/pdf') throw new Error('A PDF is required for saving.')
  const url = environment.URL.createObjectURL(pdf)
  const link = environment.document.createElement('a'); link.href = url; link.download = fileName; link.click()
  // Let the browser finish opening the download before revoking its URL.
  setTimeout(() => environment.URL.revokeObjectURL(url), 1000)
  return fileName
}

export async function shareTakeHomePdf({ pdf, title, environment = globalThis }) {
  if (pdf?.type !== 'application/pdf') throw new Error('A PDF is required for sharing.')
  const fileName = pdfName(title)
  const file = new File([pdf], fileName, { type:'application/pdf' })
  if (environment.navigator.share && (!environment.navigator.canShare || environment.navigator.canShare({ files:[file] }))) {
    try { await environment.navigator.share({ title, files:[file] }); return 'shared' }
    catch (error) { if (error?.name === 'AbortError') return 'cancelled' }
  }
  downloadTakeHomePdf(pdf, title, environment); return 'saved'
}
