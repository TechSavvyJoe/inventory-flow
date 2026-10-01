// App and companion render the PDF's measured customer-only plan unchanged.
import { el } from './dom.mjs'

export function renderComparisonPage(plan, page) {
  const logo = page.headerLogo
  const columns = page.vehicles.map((vehicle, index) => el('section', { class:'comparison-vehicle', 'aria-label':vehicle.name },
    ...page.rows.map(row => {
      const cell = row.cells[index]
      const style = { '--comparison-row-height':`${row.height}pt`, '--comparison-text-size':`${row.size}pt`, '--comparison-line-height':`${row.lineHeight}pt`, '--comparison-font-weight':row.fontWeight, '--comparison-label-size':`${row.labelSize}pt`, '--comparison-label-height':`${row.labelHeight}pt` }
      if (row.kind === 'photo') {
        const placeholder = el('span', { class:'comparison-photo-empty', text:'Photo unavailable in this copy' })
        const photo = vehicle.photoSrc ? el('img', { src:vehicle.photoSrc, alt:vehicle.name, referrerpolicy:'no-referrer', onerror:() => photo.replaceWith(placeholder) }) : placeholder
        return el('div', { class:'comparison-cell comparison-photo', style }, photo)
      }
      if (row.kind === 'qr') {
        const offer = cell.offer
        const run = (lines, className, top, size, lineHeight) => el('div', { class:className, style:{ '--comparison-run-top':`${top}pt`, '--comparison-run-size':`${size}pt`, '--comparison-run-height':`${lineHeight}pt` } }, ...lines.map(line => el('span', {class:'comparison-line',text:line})))
        const qrContent = el('div', {class:'comparison-qr-target',style:{'--comparison-qr-size':`${offer.qrSize}pt`}},
          cell.qr ? el('img', {src:cell.qr.dataUrl,alt:`Scan to open ${vehicle.name} listing`}) : null,
          run(cell.lines, 'comparison-qr-caption', offer.captionTop, offer.captionSize, offer.captionLineHeight))
        return el('div', {class:'comparison-cell comparison-offer',style:{...style,'--comparison-offer-width':`${offer.textWidth}pt`}},
          el('span', {class:'comparison-offer-label',text:row.label}),
          run(offer.priceLines,'comparison-offer-price',offer.priceTop,offer.priceSize,offer.priceLineHeight),
          run(offer.mileageLines,'comparison-offer-meta',offer.mileageTop,offer.metaSize,offer.metaLineHeight),
          run(offer.stockLines,'comparison-offer-meta',offer.stockTop,offer.metaSize,offer.metaLineHeight),
          cell.link ? el('a', {href:cell.link,target:'_blank',rel:'noopener noreferrer','aria-label':`Open ${vehicle.name} listing`},qrContent) : qrContent)
      }
      const content = row.kind === 'name' ? el('h2', { class:'comparison-text' }) : el('div', { class:'comparison-text' })
      for (const line of cell.lines) content.append(el('span', { class:'comparison-line', text:line || '\u00a0' }))
      const label = row.labelLines.length ? el('span', { class:'comparison-label' }, ...row.labelLines.map(line => el('span', { class:'comparison-line', text:line }))) : null
      const value = cell.link ? el('a', { href:cell.link, target:'_blank', rel:'noopener noreferrer' }, content) : content
      return el('div', { class:`comparison-cell comparison-cell--${row.kind}`, style }, label, value)
    }),
  ))
  const headerLogo = logo ? el('img', { class:'comparison-logo', src:logo.src, alt:logo.alt || page.headerStore, onerror:() => headerLogo.replaceWith(el('strong', { text:page.headerStore })) }) : el('strong', { text:page.headerStore })
  return el('article', { class:'comparison-page', 'aria-label':`${page.headerTitle} · ${page.footerPage}`, style:{ '--comparison-page-width':`${plan.width}pt`, '--comparison-page-height':`${plan.height}pt`, '--comparison-margin':`${plan.margin}pt`, '--comparison-columns':page.vehicles.length, '--comparison-header-top':`${plan.geometry.headerTop}pt`, '--comparison-header-height':`${plan.geometry.bodyTop-plan.geometry.headerTop}pt`, '--comparison-rule-top':`${plan.geometry.headerRuleTop-plan.geometry.headerTop}pt`, '--comparison-footer-top':`${plan.geometry.footerTop}pt` } },
    el('header', { class:'comparison-head' }, headerLogo, el('div', {}, el('h1', { text:page.headerTitle }), page.headerSite ? el('span', { text:page.headerSite }) : null)),
    el('div', { class:'comparison-grid' }, ...columns),
    el('footer', { class:'comparison-foot' }, el('span', { text:page.footerDisclaimer }), el('span', { text:page.footerPage })),
  )
}
