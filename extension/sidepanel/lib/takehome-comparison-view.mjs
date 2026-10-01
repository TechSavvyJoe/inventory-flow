// App and companion render the PDF's measured customer-only plan unchanged.
import { el } from './dom.mjs'

export function renderComparisonPage(plan, page) {
  const logo = page.headerStore === 'Bob Maxey' ? null : page.vehicles[0].logo
  const columns = page.vehicles.map((vehicle, index) => el('section', { class:'comparison-vehicle', 'aria-label':vehicle.name },
    ...page.rows.map(row => {
      const cell = row.cells[index]
      const style = { '--comparison-row-height':`${row.height}pt`, '--comparison-text-size':`${row.size}pt`, '--comparison-line-height':`${row.lineHeight}pt`, '--comparison-font-weight':row.fontWeight, '--comparison-label-size':`${row.labelSize}pt`, '--comparison-label-height':`${row.labelHeight}pt` }
      if (row.kind === 'photo') {
        const placeholder = el('span', { class:'comparison-photo-empty', text:'Photo unavailable in this copy' })
        const photo = vehicle.photoSrc ? el('img', { src:vehicle.photoSrc, alt:vehicle.name, referrerpolicy:'no-referrer', onerror:() => photo.replaceWith(placeholder) }) : placeholder
        return el('div', { class:'comparison-cell comparison-photo', style }, photo)
      }
      const content = row.kind === 'name' ? el('h2', { class:'comparison-text' }) : el('div', { class:'comparison-text' })
      for (const line of cell.lines) content.append(el('span', { class:'comparison-line', text:line || '\u00a0' }))
      const label = row.labelLines.length ? el('span', { class:'comparison-label' }, ...row.labelLines.map(line => el('span', { class:'comparison-line', text:line }))) : null
      const value = cell.link ? el('a', { href:cell.link, target:'_blank', rel:'noopener noreferrer' }, content) : content
      return el('div', { class:`comparison-cell comparison-cell--${row.kind}`, style }, label, value)
    }),
  ))
  const headerLogo = logo ? el('img', { class:'comparison-logo', src:logo.src, alt:logo.alt || page.headerStore, onerror:() => headerLogo.replaceWith(el('strong', { text:page.headerStore })) }) : el('strong', { text:page.headerStore })
  return el('article', { class:'comparison-page', 'aria-label':`${page.headerTitle} · ${page.footerPage}`, style:{ '--comparison-page-width':`${plan.width}pt`, '--comparison-page-height':`${plan.height}pt`, '--comparison-margin':`${plan.margin}pt`, '--comparison-columns':page.vehicles.length } },
    el('header', { class:'comparison-head' }, headerLogo, el('div', {}, el('h1', { text:page.headerTitle }), page.headerSite ? el('span', { text:page.headerSite }) : null)),
    el('div', { class:'comparison-grid' }, ...columns),
    el('footer', { class:'comparison-foot' }, el('span', { text:page.footerDisclaimer }), el('span', { text:page.footerPage })),
  )
}
