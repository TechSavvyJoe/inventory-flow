// Renders the take-home sheet the panel handed over, then lets the browser's
// print dialog produce the PDF. The sheet only ever contains published facts.
import { el } from './lib/dom.mjs'
import { storage } from './lib/host.mjs'
import { renderTakeHome } from './lib/takehome.mjs'
import { downloadTakeHomeHtml, normalizeTakeHomeDocument, publicListingLinks, selfContainedTakeHomeHtml, shareTakeHomeHtml } from './lib/takehome-export.mjs'

const stage = document.getElementById('stage')
const documentId = decodeURIComponent(location.hash.slice(1))
let activeDocument = null
let stylesheet = ''

function fail(message) {
  stage.replaceChildren(el('div', { class: 'th-missing' }, el('h1', { text: 'Nothing to print' }), el('p', { text: message })))
}

async function boot() {
  const payload = documentId ? await storage.takeTakeHome(documentId) : null
  activeDocument = normalizeTakeHomeDocument(payload)
  if (!activeDocument.models.length) { fail('Open a vehicle or customer saved list in the Deal Desk panel and choose “Take-home page” again.'); return }
  const title = activeDocument.listLabel || (activeDocument.models.length === 1 ? `${activeDocument.models[0].name} · ${activeDocument.models[0].stockNumber}` : `Customer vehicle list · ${activeDocument.models.length} vehicles`)
  document.title = title
  document.getElementById('toolbar-title').textContent = title
  stage.replaceChildren(...activeDocument.models.map((model) => renderTakeHome(model)))
  stylesheet = await fetch('./takehome.css').then((response) => response.ok ? response.text() : '').catch(() => '')
  await Promise.all([...stage.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve }))))
}

document.getElementById('print').addEventListener('click', () => window.print())
document.querySelector('[data-action="save"]').addEventListener('click', async () => {
  if (!activeDocument) return
  const title = document.title
  downloadTakeHomeHtml(await selfContainedTakeHomeHtml(stage, title, stylesheet), title)
})
document.querySelector('[data-action="share"]').addEventListener('click', async () => {
  if (!activeDocument) return
  const status = await shareTakeHomeHtml({ html:await selfContainedTakeHomeHtml(stage, document.title, stylesheet), title:document.title, links:publicListingLinks(activeDocument.models) })
  document.querySelector('[data-share-status]').textContent = status === 'copied' ? 'Public listing links copied' : status === 'saved' ? 'Saved HTML document' : status === 'shared' ? 'Shared document' : ''
})
document.getElementById('close').addEventListener('click', () => window.close())
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'p') { event.preventDefault(); window.print() } })
boot().catch((error) => { console.error(error); fail('The vehicle could not be loaded for printing.') })
