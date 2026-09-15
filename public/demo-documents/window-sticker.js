const container = document.querySelector('#document')
document.querySelector('#print').addEventListener('click', () => window.print())
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const money = value => typeof value === 'number' ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value) : 'Not supplied'
const row = (label,value) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`
try {
  const response = await fetch('./samples.json')
  if (!response.ok) throw new Error('Sample data unavailable.')
  const samples = await response.json()
  const id = new URLSearchParams(window.location.search).get('vehicle')
  if (!id || !Object.hasOwn(samples,id)) throw new Error('This demo document is available only for the eight synthetic preview vehicles.')
  const v = samples[id]
  document.title = `${v.title} · Demo window sticker`
  container.innerHTML = `<p class="demo-warning">DEMO — NOT AN OFFICIAL WINDOW STICKER · SYNTHETIC DATA</p>
    <header class="sticker-heading"><div><h1>${escape(v.title)}</h1><p>${escape(v.body)} · ${escape(v.drivetrain)} · ${escape(v.engine)}</p><p>${escape(v.transmission)}</p></div><aside>STOCK ${escape(v.stock)}<br>TEST IDENTIFIER ${escape(v.vin)}<br>${escape(v.store)} · Demo inventory</aside></header>
    <div class="sticker-grid"><div class="sticker-column"><section class="block"><h2>Equipment highlights</h2><ul>${v.features.map(feature=>`<li>${escape(feature)}</li>`).join('')}</ul></section><section class="block"><h2>What this sample shows</h2><p>A recognizable equipment-and-price document layout using the synthetic vehicle shown in the preview.</p><p>These are demonstration features, not a verified manufacturer build sheet or a complete list of standard equipment.</p></section></div>
    <div class="sticker-column"><section class="block"><h2>Vehicle configuration</h2><dl>${row('Exterior',v.exterior)}${row('Interior',v.interior)}${row('Engine',v.engine)}${row('Transmission',v.transmission)}${row('Drivetrain',v.drivetrain)}${row('Body',v.body)}</dl></section><section class="block"><h2>Source distinction</h2><p>Created by Inventory Flow for demonstration. Not issued by Ford, Lincoln, Chevrolet, a dealer, or any report provider.</p><p class="muted">Official window stickers, captured equipment reports and history reports remain separate source records in the app.</p></section></div>
    <div class="sticker-column"><section class="block"><h2>Illustrative price information</h2>${v.pricing?`<dl>${row('Base MSRP',money(v.pricing.base))}${row('Options',money(v.pricing.options))}${row('Destination',money(v.pricing.destination))}</dl>`:'<p>A component-level price breakdown was not supplied for this demo vehicle.</p>'}<div class="total"><span>DEMO MSRP</span><strong>${money(v.msrp)}</strong></div></section><section class="block"><h2>Demonstration only</h2><div class="demo-mark">DEMO</div><p>Not valid for purchase, financing, certification, warranty, recall, emissions, or fuel-economy decisions.</p><p>No real vehicle identification or customer information is included.</p></section></div></div>
    <footer class="sticker-footer"><strong>SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS</strong><br>All vehicle facts and amounts shown here are fabricated preview data. This sample is not an official manufacturer record. Use the original source for an actual vehicle.</footer>`
} catch(error) {
  container.replaceChildren(Object.assign(document.createElement('p'),{className:'loading',textContent:error.message || 'Unable to load the demo document.'}))
} finally { container.setAttribute('aria-busy','false') }
