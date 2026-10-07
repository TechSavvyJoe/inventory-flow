// Renders and exports the panel's customer-safe sheet as a real PDF.
// Browser printing remains available independently of PDF preparation.
import { el } from './lib/dom.mjs'
import { storage } from './lib/host.mjs'
import { renderTakeHome } from './lib/takehome.mjs'
import { downloadTakeHomePdf, normalizeTakeHomeDocument, shareTakeHomePdf } from './lib/takehome-export.mjs'

import { createTakeHomePdf } from './lib/takehome-pdf.mjs'
import { renderComparisonPage } from './lib/takehome-comparison-view.mjs'

const stage = document.getElementById('stage')
const documentId = decodeURIComponent(location.hash.slice(1))
let activeDocument = null
let pdf = null
let layout = 'detailed'
let generation = 0
let detailedTitle = ''
const exportButtons = [...document.querySelectorAll('[data-action="save"], [data-action="share"]')]
exportButtons.forEach(button => { button.disabled = true })

function fail(message) {
  stage.replaceChildren(el('div', { class: 'th-missing' }, el('h1', { text: 'Nothing to print' }), el('p', { text: message })))
}

async function boot() {
  const payload = documentId ? await storage.takeTakeHome(documentId) : null
  activeDocument = normalizeTakeHomeDocument(payload)
  if (!activeDocument.models.length) { fail('Open a vehicle or customer saved list in the Deal Desk panel and choose “Take-home page” again.'); return }
  detailedTitle = activeDocument.listLabel || (activeDocument.models.length === 1 ? `${activeDocument.models[0].name} · ${activeDocument.models[0].stockNumber}` : `Customer vehicle list · ${activeDocument.models.length} vehicles`)
  await preparePdf()
}

async function preparePdf() {
  if (!activeDocument) return
  const request = ++generation
  pdf = null
  exportButtons.forEach(button => { button.disabled = true })
  document.getElementById('print').disabled = layout === 'comparison'
  document.title = layout === 'comparison' ? 'Inventory Flow vehicle comparison' : detailedTitle
  document.getElementById('toolbar-title').textContent = document.title
  stage.replaceChildren(...(layout === 'comparison' ? [el('p', {text:'Preparing comparison sheet…'})] : activeDocument.models.map(model => renderTakeHome(model))))
  const status = document.querySelector('[data-share-status]')
  status.textContent = 'Preparing PDF…'
  try {
    let comparison = null
    const prepared = await createTakeHomePdf(activeDocument.models, document.title, {layout,comparisonObserver:plan => { comparison = plan }})
    if (request !== generation) return
    pdf = prepared
    if (comparison) stage.replaceChildren(...comparison.pages.map(page => renderComparisonPage(comparison, page)))
    document.getElementById('print').disabled = false
    exportButtons.forEach(button => { button.disabled = false })
    status.textContent = ''
  } catch {
    if (request !== generation) return
    status.textContent = 'PDF could not be prepared. '
    const retry = el('button', { class:'th-btn', text:'Retry PDF', type:'button' })
    retry.addEventListener('click', () => { void preparePdf() })
    status.append(retry)
  }
}

document.getElementById('format').addEventListener('change', event => { layout = event.target.value; void preparePdf() })

document.getElementById('print').addEventListener('click', () => window.print())
document.querySelector('[data-action="save"]').addEventListener('click', () => {
  if (!pdf) return
  downloadTakeHomePdf(pdf, document.title)
  document.querySelector('[data-share-status]').textContent = 'Saved PDF document'
})
document.querySelector('[data-action="share"]').addEventListener('click', async () => {
  if (!pdf) return
  try {
    const status = await shareTakeHomePdf({ pdf, title:document.title })
    document.querySelector('[data-share-status]').textContent = status === 'saved' ? 'PDF saved. Share that file with your customer.' : status === 'shared' ? 'Shared PDF document' : ''
  } catch { document.querySelector('[data-share-status]').textContent = 'The PDF could not be shared. Use Save PDF and share the saved file.' }
})
document.getElementById('close').addEventListener('click', () => window.close())
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'p') { event.preventDefault(); if (!document.getElementById('print').disabled) window.print() } })
boot().catch((error) => { console.error(error); fail('The vehicle could not be loaded for printing.') })
