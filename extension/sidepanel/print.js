// Renders the take-home sheet the panel handed over, then lets the browser's
// print dialog produce the PDF. The sheet only ever contains published facts.
import { el } from './lib/dom.mjs'
import { storage } from './lib/host.mjs'
import { renderTakeHome } from './lib/takehome.mjs'

const stage = document.getElementById('stage')
const vin = decodeURIComponent(location.hash.slice(1))

function fail(message) {
  stage.replaceChildren(el('div', { class: 'th-missing' }, el('h1', { text: 'Nothing to print' }), el('p', { text: message })))
}

async function boot() {
  const model = vin ? await storage.takeTakeHome(vin) : null
  if (!model) { fail('Open a vehicle in the Deal Desk panel and choose “Take-home page” again.'); return }
  document.title = `${model.name} · ${model.stockNumber}`
  document.getElementById('toolbar-title').textContent = `${model.name} · ${model.stockNumber}`
  stage.replaceChildren(renderTakeHome(model))
  await Promise.all([...stage.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve }))))
}

document.getElementById('print').addEventListener('click', () => window.print())
document.getElementById('close').addEventListener('click', () => window.close())
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'p') { event.preventDefault(); window.print() } })
boot().catch((error) => { console.error(error); fail('The vehicle could not be loaded for printing.') })
