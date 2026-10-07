import { getListingQr } from './takehome-qr.mjs'
import { createComparisonPlan } from './takehome-comparison.mjs'
// One customer-safe PDF renderer shared by the app and the companion. It takes
// only takeHomeModel projections, never a bootstrap, hold or customer record.
import {
  PDFDocument,
  PDFString,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from '../vendor/pdf-lib.js'
import fontkit from '../vendor/fontkit.js'

const INK = rgb(0.04, 0.12, 0.2)
const BLUE = rgb(0.07, 0.39, 0.75)
const MUTED = rgb(0.32, 0.4, 0.47)
const LINE = rgb(0.85, 0.89, 0.93)
const PALE = rgb(0.96, 0.98, 1)
const WHITE = rgb(1, 1, 1)
const MONEY = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 })
const DISCLAIMER = 'Price excludes tax, title, license and dealer fees. Confirm equipment, mileage and availability with the dealership before purchase.'
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

/** Customer PDFs deliberately exclude every MSRP/reference-price field. */
export function customerTakeHomePriceFacts(model) {
  return [
    model.mileage != null ? { label:'MILEAGE', value:`${model.mileage.toLocaleString('en-US')} mi` } : { label:'MILEAGE', value:'Not published' },
    { label:'STOCK', value:clean(model.stockNumber) },
  ]
}

async function bytes(url, fetcher) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetcher(url, { signal:controller.signal, credentials:'same-origin' })
    if (!response.ok) throw new Error('Document asset could not load')
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > 6 * 1024 * 1024) throw new Error('Document asset is too large')
    return new Uint8Array(buffer)
  } finally { clearTimeout(timer) }
}

function safeImage(value, base) {
  try {
    const url = new URL(value, base)
    if (url.username || url.password) return false
    return url.protocol === 'https:' || url.protocol === 'chrome-extension:' || (url.protocol === 'http:' && url.origin === new URL(base).origin) || /^data:image\/(?:png|jpeg);base64,/i.test(value)
  } catch { return false }
}

function safeHttps(value, base) {
  if (!value) return null
  try {
    const candidate = /^https:\/\//i.test(value)
      ? value
      : /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#][^\s]*)?$/i.test(value) ? `https://${value}` : null
    if (!candidate) return null
    const url = new URL(candidate, base)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

/** Images are optional: a blocked photo must not prevent the document itself. */
async function image(pdf, url, fetcher, base) {
  if (!url || !safeImage(url, base)) return null
  try {
    const data = await bytes(new URL(url, base).href, fetcher)
    if (data[0] === 0xff && data[1] === 0xd8) return await pdf.embedJpg(data)
    if (data[0] === 0x89 && data[1] === 0x50) return await pdf.embedPng(data)
    // WebP/AVIF dealer photos become an embedded JPEG when the browser can
    // decode them. The source stays local; no third-party rendering service.
    if (!globalThis.createImageBitmap || !globalThis.document) return null
    const bitmap = await createImageBitmap(new Blob([data]))
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1600 / bitmap.width)
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) { bitmap.close(); return null }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close()
    return await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.88))
  } catch { return null }
}

export async function createTakeHomePdf(models, title, { fetcher = globalThis.fetch, now = new Date(), base = globalThis.location?.href ?? 'https://inventory-ops.joegallant.me/', layoutObserver = null, layout = 'detailed', comparisonObserver = null } = {}) {
  const selected = [...new Map(models.map(model => [model.vin, model])).values()]
  if (!selected.length) throw new Error('Choose a vehicle before preparing a PDF.')
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const [regularBytes, boldBytes] = await Promise.all([
    bytes(new URL('../../fonts/Inter-Regular.woff', import.meta.url).href, fetcher),
    bytes(new URL('../../fonts/Inter-Bold.woff', import.meta.url).href, fetcher),
  ])
  const regular = await pdf.embedFont(regularBytes, { subset:true }), bold = await pdf.embedFont(boldBytes, { subset:true })
  pdf.setTitle(clean(title)); pdf.setAuthor('Inventory Flow'); pdf.setCreator('Inventory Flow'); pdf.setCreationDate(now)

  if (layout === 'comparison') {
    pdf.setTitle('Inventory Flow vehicle comparison')
    const assets = new Map(), photoSources = new Map(), logoSources = new Map()
    for (const model of selected) {
      let photo = null
      for (const src of [...new Set(model.photos ?? [])].slice(0,4)) {
        photo = await image(pdf,src,fetcher,base)
        if (photo) { photoSources.set(model.vin,src); break }
      }
      const branding=model.logo ?? model.brand, logo=await image(pdf,branding?.src,fetcher,base)
      if(logo) logoSources.set(model.vin,{src:branding.src,alt:clean(branding.alt),wide:branding.wide===true})
      assets.set(model.vin,{photo,logo})
    }
    // Repeated equipment/qualification text needs the same shaped width many
    // times. Cache only within this document, keeping exact font measurements.
    const measurements = new Map()
    const measure = (value,size,isBold) => {
      const key = `${isBold ? 'b' : 'r'}:${size}:${value}`
      if (!measurements.has(key)) measurements.set(key,(isBold ? bold : regular).widthOfTextAtSize(value,size))
      return measurements.get(key)
    }
    const wrap = (value,maxWidth,size,isBold) => {
      const result=[]
      for(const paragraph of clean(value).split('\n')) {
        let line=''
        for(const word of paragraph.split(/\s+/).filter(Boolean)) {
          if(line && measure(`${line} ${word}`,size,isBold)>maxWidth) { result.push(line);line='' }
          if(measure(word,size,isBold)<=maxWidth) {line=line?`${line} ${word}`:word;continue}
          let part=''
          for(const char of word) {if(part && measure(part+char,size,isBold)>maxWidth) {result.push(part);part=''}part+=char}
          line=part
        }
        result.push(line)
      }
      return result
    }
    const qrCodes=new Map()
    for(const model of selected) { const url=safeHttps(model.listingUrl,base);if(url && !qrCodes.has(url)) qrCodes.set(url,getListingQr(url)) }
    const plan=createComparisonPlan(selected,{wrap,safeLink:value=>safeHttps(value,base),photoSources,logoSources,qrCodes})
    for(const record of plan.pages) {
      const page=pdf.addPage([plan.width,plan.height]), pageHeight=plan.height
      const draw=(value,x,top,size,font=regular,color=INK)=>page.drawText(clean(value),{x,y:pageHeight-top-size,size,font,color})
      const first=record.vehicles.find(vehicle=>vehicle.logo?.src===record.headerLogo?.src), logo=record.headerLogo?assets.get(first?.vin)?.logo:null
      if(logo) {const scale=Math.min(130/logo.width,28/logo.height);page.drawImage(logo,{x:32,y:pageHeight-plan.geometry.headerTop-28,width:logo.width*scale,height:logo.height*scale})}
      else draw(record.headerStore,32,plan.geometry.headerTop,12,bold,BLUE)
      const titleWidth=bold.widthOfTextAtSize(record.headerTitle,17)
      draw(record.headerTitle,plan.width-32-titleWidth,plan.geometry.headerTop,17,bold)
      if(record.headerSite) draw(record.headerSite,plan.width-32-regular.widthOfTextAtSize(record.headerSite,9),45,9,regular,MUTED)
      page.drawLine({start:{x:32,y:pageHeight-plan.geometry.headerRuleTop},end:{x:plan.width-32,y:pageHeight-plan.geometry.headerRuleTop},thickness:1,color:LINE})
      page.drawLine({start:{x:32,y:pageHeight-plan.geometry.headerRuleTop},end:{x:124,y:pageHeight-plan.geometry.headerRuleTop},thickness:2,color:BLUE})
      for(const row of record.rows) for(const [index,cell] of row.cells.entries()) {
        const column=record.columns[index], vehicle=record.vehicles[index]
        if(row.kind==='photo') {
          page.drawRectangle({x:column.x,y:pageHeight-row.top-row.height,width:column.width,height:row.height,color:PALE})
          const photo=assets.get(vehicle.vin)?.photo
          if(photo) {const scale=Math.min(column.width/photo.width,row.height/photo.height),w=photo.width*scale,h=photo.height*scale;page.drawImage(photo,{x:column.x+(column.width-w)/2,y:pageHeight-row.top-row.height+(row.height-h)/2,width:w,height:h})}
          else for(const [i,line] of wrap('Photo unavailable in this copy',column.width-16,10,false).entries()) draw(line,column.x+8,row.top+row.height/2-8+i*12.5,10,regular,MUTED)
          continue
        }
        if(row.kind==='qr') {
          const offer=cell.offer
          draw(row.label,column.x,row.top,9,regular,MUTED)
          offer.priceLines.forEach((line,i)=>draw(line,column.x,row.top+offer.priceTop+i*offer.priceLineHeight,offer.priceSize,bold,BLUE))
          offer.mileageLines.forEach((line,i)=>draw(line,column.x,row.top+offer.mileageTop+i*offer.metaLineHeight,offer.metaSize,regular))
          offer.stockLines.forEach((line,i)=>draw(line,column.x,row.top+offer.stockTop+i*offer.metaLineHeight,offer.metaSize,regular,MUTED))
          const qrX=column.x+column.width-offer.qrSize, qrTop=row.top+offer.qrTop
          if(cell.qr) {
            page.drawRectangle({x:qrX,y:pageHeight-qrTop-offer.qrSize,width:offer.qrSize,height:offer.qrSize,color:WHITE})
            const unit=offer.qrSize/cell.qr.size
            // One filled vector path avoids antialiased seams between adjacent modules.
            const paths=[]
            cell.qr.modules.forEach((moduleRow,ri)=>{
              for(let ci=0;ci<moduleRow.length;ci++) {
                if(!moduleRow[ci]) continue
                const start=ci
                while(ci+1<moduleRow.length && moduleRow[ci+1]) ci++
                paths.push(`M${start} ${ri}h${ci-start+1}v1H${start}Z`)
              }
            })
            page.drawSvgPath(paths.join(' '),{x:qrX,y:pageHeight-qrTop,scale:unit,color:rgb(0,0,0)})
          }
          cell.lines.forEach((line,i)=>draw(line,qrX,row.top+offer.captionTop+i*offer.captionLineHeight,offer.captionSize,regular,MUTED))
        } else {
          if(row.label) draw(row.label,column.x,row.top,row.labelSize,bold,BLUE)
          cell.lines.forEach((line,lineIndex)=>draw(line,column.x,row.top+row.labelHeight+lineIndex*row.lineHeight,row.size,row.bold?bold:regular,row.kind==='certification'?BLUE:row.kind==='more'?MUTED:INK))
        }
        if(cell.link) {const annotation=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[column.x+column.width-66,pageHeight-row.top-row.height,column.x+column.width,pageHeight-row.top],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(cell.link)}}));page.node.normalizedEntries().Annots.push(annotation)}
      }
      page.drawLine({start:{x:32,y:pageHeight-plan.geometry.footerTop},end:{x:plan.width-32,y:pageHeight-plan.geometry.footerTop},thickness:.5,color:LINE})
      wrap(record.footerDisclaimer,plan.width-64,8,false).forEach((line,index)=>draw(line,32,plan.geometry.footerTop+5+index*10,8,regular,MUTED))
      draw(record.footerPage,plan.width-32-regular.widthOfTextAtSize(record.footerPage,8),595,8,regular,MUTED)
    }
    comparisonObserver?.(plan)
    return new Blob([await pdf.save()],{type:'application/pdf'})
  }

  const footerDate = now.toLocaleDateString('en-US')
  const pageWidth = 612, pageHeight = 792, margin = 32, width = pageWidth - 2 * margin, bottom = 72
  const pageRecords = []
  const measurements = new Map()
  let page, y, currentModel, currentAssets, currentVehicleIndex = 0, currentVehiclePage = 0, currentHeroHighlightCount = 0

  function measure(value, font, size) {
    const normalized = clean(value)
    const key = `${font === bold ? 'b' : 'r'}:${size}:${normalized}`
    if (!measurements.has(key)) measurements.set(key, font.widthOfTextAtSize(normalized, size))
    return measurements.get(key)
  }

  function lines(value, maxWidth, font = regular, size = 10) {
    const result = []
    for (const paragraph of clean(value).split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean)
      if (!words.length) { result.push(''); continue }
      let line = ''
      for (const word of words) {
        const next = line ? `${line} ${word}` : word
        if (line && measure(next, font, size) > maxWidth) { result.push(line); line = '' }
        if (measure(word, font, size) <= maxWidth) { line = line ? `${line} ${word}` : word; continue }
        let part = ''
        for (const character of word) {
          if (part && measure(part + character, font, size) > maxWidth) { result.push(part); part = '' }
          part += character
        }
        line = part
      }
      result.push(line)
    }
    return result
  }

  function drawLines(wrapped, x, top, size = 10, font = regular, color = INK, lineHeight = size + 2.5) {
    wrapped.forEach((line, index) => page.drawText(line, { x, y:top - size - index * lineHeight, font, size, color }))
    return wrapped.length * lineHeight
  }

  function text(value, x, top, maxWidth, size = 10, font = regular, color = INK, lineHeight = size + 2.5) {
    return drawLines(lines(value, maxWidth, font, size), x, top, size, font, color, lineHeight)
  }

  function textRight(value, right, top, maxWidth, size = 10, font = regular, color = INK) {
    const wrapped = lines(value, maxWidth, font, size)
    wrapped.forEach((line, index) => page.drawText(line, { x:right - measure(line, font, size), y:top - size - index * (size + 2.5), font, size, color }))
    return wrapped.length * (size + 2.5)
  }

  function fitPhoto(asset, x, top, w, h) {
    const scale = Math.min(w / asset.width, h / asset.height), drawWidth = asset.width * scale, drawHeight = asset.height * scale
    page.drawImage(asset, { x:x + (w - drawWidth) / 2, y:top - h + (h - drawHeight) / 2, width:drawWidth, height:drawHeight })
  }

  function coverPhoto(asset, x, top, w, h) {
    const scale = Math.max(w / asset.width, h / asset.height), drawWidth = asset.width * scale, drawHeight = asset.height * scale
    page.pushOperators(
      pushGraphicsState(),
      moveTo(x, top - h), lineTo(x, top), lineTo(x + w, top), lineTo(x + w, top - h), closePath(), clip(), endPath(),
    )
    page.drawImage(asset, { x:x + (w - drawWidth) / 2, y:top - h + (h - drawHeight) / 2, width:drawWidth, height:drawHeight })
    page.pushOperators(popGraphicsState())
  }

  function linkAnnotation(url, x, top, w, h) {
    const target = safeHttps(url, base)
    if (!target) return
    const annotation = pdf.context.register(pdf.context.obj({
      Type:'Annot', Subtype:'Link', Rect:[x, top - h, x + w, top], Border:[0, 0, 0],
      A:{ Type:'Action', S:'URI', URI:PDFString.of(target) },
    }))
    page.node.normalizedEntries().Annots.push(annotation)
  }

  function drawBrandHeader() {
    const logo = currentAssets.logo
    if (logo) fitPhoto(logo, margin, y, 132, 34)
    else text(currentModel.storeName, margin, y - 2, 250, 12, bold, BLUE)
    const storeRight = pageWidth - margin
    textRight(currentModel.storeName, storeRight, y - 1, 310, 10, bold, INK)
    if (currentModel.storeSite) {
      const site = clean(currentModel.storeSite)
      const siteWidth = Math.min(measure(site, regular, 8), 260)
      textRight(site, storeRight, y - 17, 260, 8, regular, BLUE)
      linkAnnotation(site, storeRight - siteWidth, y - 16, siteWidth, 12)
    }
    const labelHeight = selected.length > 1 ? textRight(title, storeRight, y - 31, 310, 7.5, regular, MUTED) : 0
    y -= Math.max(43, 33 + labelHeight)
    page.drawLine({ start:{ x:margin, y }, end:{ x:pageWidth - margin, y }, thickness:1.4, color:INK })
    page.drawLine({ start:{ x:margin, y:y - 2.5 }, end:{ x:margin + 92, y:y - 2.5 }, thickness:2.2, color:BLUE })
    y -= 11
  }

  function newPage(continued = false, continuationLabel = 'Details continued') {
    page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - 28; currentVehiclePage += 1
    pageRecords.push({ page, model:currentModel, vehicleIndex:currentVehicleIndex, vehiclePage:currentVehiclePage })
    drawBrandHeader()
    if (continued) {
      y -= text(`${currentModel.name} · ${continuationLabel}`, margin, y, width, 14, bold, INK, 17) + 2
      y -= text(`Stock ${currentModel.stockNumber} · VIN ${currentModel.vin}`, margin, y, width, 8, regular, MUTED, 10) + 7
    }
  }

  function ensure(height, continuationLabel = 'Details continued') {
    if (y - height < bottom) { newPage(true, continuationLabel); return true }
    return false
  }

  function sectionHeading(label, reserveHeight = 0, continuationLabel = label) {
    ensure(22 + reserveHeight, continuationLabel)
    page.drawLine({ start:{ x:margin, y }, end:{ x:pageWidth - margin, y }, thickness:0.55, color:LINE })
    y -= 6
    y -= text(label, margin, y, width, 9.5, bold, BLUE, 12) + 3
  }

  function drawTitle() {
    const nameHeight = text(currentModel.name, margin, y, width, 18.5, bold, INK, 21)
    y -= nameHeight + 2
    const descriptorWidth = currentModel.certified ? width - 205 : width
    const descriptorHeight = currentModel.descriptor ? text(currentModel.descriptor, margin, y, descriptorWidth, 8.5, regular, MUTED, 11) : 0
    let certificationHeight = 0
    if (currentModel.certified?.name) certificationHeight = textRight(currentModel.certified.name, pageWidth - margin, y, 195, 8.5, bold, BLUE)
    y -= Math.max(descriptorHeight, certificationHeight, 11) + 7
  }

  function drawHero() {
    const photos = currentAssets.photos
    const hero = photos[0], supporting = photos.slice(1, 3)
    currentHeroHighlightCount = 0
    const heroHeight = 214, photoWidth = 402, railGap = 12
    const railX = margin + photoWidth + railGap, railWidth = width - photoWidth - railGap
    page.drawRectangle({ x:margin, y:y - heroHeight, width:photoWidth, height:heroHeight, color:PALE, borderColor:LINE, borderWidth:0.6 })
    if (hero) {
      coverPhoto(hero, margin, y, photoWidth, heroHeight)
    } else {
      text('Photo unavailable in this copy', margin + 18, y - heroHeight / 2 + 8, photoWidth - 36, 10, bold, MUTED)
      text('View the full listing for current photos.', margin + 18, y - heroHeight / 2 - 9, photoWidth - 36, 8.5, regular, MUTED)
    }

    const priceHeight = 91, inset = railX + 10, inner = railWidth - 20
    page.drawRectangle({ x:railX, y:y - priceHeight, width:railWidth, height:priceHeight, color:WHITE, borderColor:LINE, borderWidth:0.6 })
    text('PUBLISHED PRICE', inset, y - 10, inner, 6.5, bold, BLUE, 8)
    text(currentModel.price != null ? MONEY.format(currentModel.price) : 'Call for price', inset, y - 24, inner, 17, bold, BLUE, 20)
    page.drawLine({ start:{ x:inset, y:y - 55 }, end:{ x:railX + railWidth - 10, y:y - 55 }, thickness:0.5, color:LINE })
    const facts = customerTakeHomePriceFacts(currentModel), factWidth = inner / 2
    facts.forEach((fact, index) => {
      const factX = inset + index * factWidth
      text(fact.label, factX, y - 62, factWidth - 5, 6.2, bold, MUTED, 8)
      text(fact.value, factX, y - 75, factWidth - 5, fact.label === 'STOCK' ? 7.5 : 8.2, bold, INK, 9)
    })

    const supportTop = y - priceHeight - 6, supportHeight = heroHeight - priceHeight - 6
    if (supporting.length) {
      const thumbGap = 5, thumbHeight = (supportHeight - thumbGap * (supporting.length - 1)) / supporting.length
      supporting.forEach((photo, index) => coverPhoto(photo, railX, supportTop - index * (thumbHeight + thumbGap), railWidth, thumbHeight))
    } else {
      const headingHeight = 22, itemGap = 3, lineHeight = 9
      const candidates = (currentModel.highlights ?? []).slice(0, 4).map(value => {
        const wrapped = lines(`• ${value}`, railWidth, regular, 7.3)
        return { value, wrapped, height:wrapped.length * lineHeight }
      })
      const fitted = []
      let usedHeight = 0
      for (const candidate of candidates) {
        const requiredHeight = candidate.height + (fitted.length ? itemGap : 0)
        if (usedHeight + requiredHeight > supportHeight - headingHeight) break
        fitted.push(candidate); usedHeight += requiredHeight
      }
      currentHeroHighlightCount = fitted.length
      const remaining = (currentModel.highlights ?? []).slice(currentHeroHighlightCount)
      layoutObserver?.({
        type:'hero-highlights', vehicleIndex:currentVehicleIndex, successfulPhotos:photos.length,
        supportTop, supportBottom:supportTop - supportHeight, highlightBottom:supportTop - headingHeight - usedHeight,
        fitted:fitted.map(item => item.value), remaining,
      })
      if (!fitted.length) { y -= heroHeight + 7; return }
      page.drawLine({ start:{ x:railX, y:supportTop }, end:{ x:railX + railWidth, y:supportTop }, thickness:1.5, color:BLUE })
      text('STANDOUT FEATURES', railX, supportTop - 8, railWidth, 6.4, bold, MUTED, 8)
      let quickY = supportTop - 22
      fitted.forEach((item, index) => {
        if (index) quickY -= itemGap
        drawLines(item.wrapped, railX, quickY, 7.3, regular, INK, lineHeight)
        quickY -= item.height
      })
      if (quickY < supportTop - supportHeight) {
        throw new Error('Take-home highlight rail exceeded its measured bounds.')
      }
    }
    y -= heroHeight + 7
  }

  function drawIdentity() {
    const entries = [
      ['VIN', currentModel.vin],
      ['VEHICLE HISTORY', currentModel.history || 'Details available from the store'],
    ]
    const gap = 14, columns = [width * .34, width * .66 - gap], size = 7.5, lineHeight = 9.5
    const wrapped = entries.map(([, value], index) => lines(value, columns[index] - 8, regular, size))
    const height = Math.max(...wrapped.map(item => item.length)) * lineHeight + 21
    page.drawRectangle({ x:margin, y:y - height, width, height, color:PALE })
    const positions = [margin + 8, margin + columns[0] + gap]
    entries.forEach(([label], index) => text(label, positions[index], y - 5, columns[index] - 8, 6.3, bold, MUTED, 8))
    wrapped.forEach((entry, index) => drawLines(entry, positions[index], y - 15, size, index === 0 ? bold : regular, index === 0 ? INK : MUTED, lineHeight))
    y -= height + 7
  }

  function rowHeight(row, lineHeight) {
    return Math.max(1, ...row.filter(Boolean).map(item => item.length)) * lineHeight + 2
  }

  function drawPairedOverview() {
    const gap = 22, colWidth = (width - gap) / 2, size = 8.5, lineHeight = 10.5
    const left = (currentModel.specs ?? []).map(([label, value]) => lines(`${label}: ${value}`, colWidth, regular, size))
    const remainingHighlights = (currentModel.highlights ?? []).slice(currentHeroHighlightCount)
    layoutObserver?.({ type:'overview-highlights', vehicleIndex:currentVehicleIndex, values:[...remainingHighlights] })
    const rightValues = remainingHighlights.length ? remainingHighlights : ['See additional equipment below.']
    const right = rightValues.map(value => lines(`• ${value}`, colWidth, regular, size))
    const rows = Array.from({ length:Math.max(left.length, right.length) }, (_, index) => [left[index] ?? [], right[index] ?? []])
    const headingHeight = 19
    const reserve = rows.slice(0, 2).reduce((total, row) => total + rowHeight(row, lineHeight), 0)
    const headings = continued => {
      ensure(headingHeight + Math.min(reserve, lineHeight * 4), 'Specifications & features')
      page.drawLine({ start:{ x:margin, y }, end:{ x:pageWidth - margin, y }, thickness:0.55, color:LINE }); y -= 6
      text(continued ? 'Specifications · continued' : 'Specifications', margin, y, colWidth, 9.5, bold, BLUE)
      text(continued ? 'Standout features · continued' : 'Standout features', margin + colWidth + gap, y, colWidth, 9.5, bold, BLUE)
      y -= 15
    }
    headings(false)
    for (const row of rows) {
      let leftOffset = 0, rightOffset = 0
      do {
        const remaining = Math.max(row[0].length - leftOffset, row[1].length - rightOffset, 1)
        let available = Math.floor((y - bottom - 2) / lineHeight)
        if (available < 1) { newPage(true, 'Specifications & features'); headings(true); available = Math.floor((y - bottom - 2) / lineHeight) }
        const take = Math.min(remaining, available)
        drawLines(row[0].slice(leftOffset, leftOffset + take), margin, y, size, regular, INK, lineHeight)
        drawLines(row[1].slice(rightOffset, rightOffset + take), margin + colWidth + gap, y, size, regular, INK, lineHeight)
        leftOffset += Math.min(take, Math.max(0, row[0].length - leftOffset))
        rightOffset += Math.min(take, Math.max(0, row[1].length - rightOffset))
        y -= take * lineHeight + 2
        if (leftOffset < row[0].length || rightOffset < row[1].length) { newPage(true, 'Specifications & features'); headings(true) }
      } while (leftOffset < row[0].length || rightOffset < row[1].length)
    }
    y -= 2
  }

  function drawGridSection(label, values, columns = 3, size = 8.1, lineHeight = 10.3) {
    if (!values.length) return
    const gap = 14, colWidth = (width - gap * (columns - 1)) / columns
    const wrapped = values.map(value => lines(`• ${value}`, colWidth, regular, size))
    const rows = []
    for (let index = 0; index < wrapped.length; index += columns) rows.push(wrapped.slice(index, index + columns))
    const reserve = rows.slice(0, 2).reduce((total, row) => total + rowHeight(row, lineHeight), 0)
    const heading = continued => sectionHeading(`${label}${continued ? ' · continued' : ''}`, Math.min(reserve, lineHeight * 5), `${label} continued`)
    heading(false)
    for (const row of rows) {
      while (row.length < columns) row.push([])
      let offsets = row.map(() => 0)
      while (offsets.some((offset, index) => offset < row[index].length)) {
        const remaining = Math.max(...row.map((entry, index) => entry.length - offsets[index]))
        let available = Math.floor((y - bottom - 2) / lineHeight)
        if (available < 1) { newPage(true, `${label} continued`); heading(true); available = Math.floor((y - bottom - 2) / lineHeight) }
        const take = Math.min(remaining, available)
        row.forEach((entry, index) => drawLines(entry.slice(offsets[index], offsets[index] + take), margin + index * (colWidth + gap), y, size, regular, INK, lineHeight))
        offsets = offsets.map((offset, index) => offset + Math.min(take, Math.max(0, row[index].length - offset)))
        y -= take * lineHeight + 2
        if (offsets.some((offset, index) => offset < row[index].length)) { newPage(true, `${label} continued`); heading(true) }
      }
    }
    y -= 2
  }

  function drawParagraphSection(label, value, size = 8.1, color = INK) {
    if (!value) return
    const lineHeight = size + 2.2, wrapped = lines(value, width, regular, size)
    sectionHeading(label, Math.min(2, wrapped.length) * lineHeight, `${label} continued`)
    let offset = 0
    while (offset < wrapped.length) {
      let available = Math.floor((y - bottom) / lineHeight)
      if (available < 1) {
        newPage(true, `${label} continued`)
        sectionHeading(`${label} · continued`, Math.min(2, wrapped.length - offset) * lineHeight, `${label} continued`)
        available = Math.floor((y - bottom) / lineHeight)
      }
      const take = Math.min(wrapped.length - offset, available)
      drawLines(wrapped.slice(offset, offset + take), margin, y, size, regular, color, lineHeight)
      y -= take * lineHeight
      offset += take
    }
    y -= 3
  }

  for (const [modelIndex, model] of selected.entries()) {
    currentModel = model; currentVehicleIndex = modelIndex; currentVehiclePage = 0
    const photoUrls = [...new Set(model.photos ?? [])].slice(0, 3)
    const loaded = await Promise.all([
      image(pdf, photoUrls[0], fetcher, base),
      image(pdf, (model.logo ?? model.brand)?.src, fetcher, base),
      ...photoUrls.slice(1).map(url => image(pdf, url, fetcher, base)),
    ])
    currentAssets = { logo:loaded[1], photos:[loaded[0], ...loaded.slice(2)].filter(Boolean) }
    newPage(false)
    drawTitle()
    drawHero()
    drawIdentity()
    drawPairedOverview()

    const highlights = new Set(currentModel.highlights ?? [])
    const equipment = (currentModel.equipment ?? []).filter(value => !highlights.has(value))
    drawGridSection(`Additional equipment · ${equipment.length}`, equipment)
    drawParagraphSection('About this vehicle', currentModel.description)
    if (currentModel.certified) {
      const certificationTerms = currentModel.certified.terms ?? []
      drawGridSection(currentModel.certified.name, certificationTerms, certificationTerms.length > 1 ? 2 : 1, 8.1, 10.3)
      drawParagraphSection('Certification details', currentModel.certified.note, 8.1, MUTED)
    }
  }

  const vehiclePageTotals = new Map()
  for (const record of pageRecords) vehiclePageTotals.set(record.vehicleIndex, (vehiclePageTotals.get(record.vehicleIndex) ?? 0) + 1)
  for (const record of pageRecords) {
    page = record.page
    const listing = safeHttps(record.model.listingUrl, base)
    page.drawLine({ start:{ x:margin, y:62 }, end:{ x:pageWidth - margin, y:62 }, thickness:0.6, color:LINE })
    text(DISCLAIMER, margin, 57, width, 8.1, regular, MUTED, 10)
    if (listing) {
      const label = 'View full vehicle listing'
      const labelWidth = measure(label, bold, 8)
      textRight(label, pageWidth - margin, 42, 180, 8, bold, BLUE)
      page.drawLine({ start:{ x:pageWidth - margin - labelWidth, y:31.5 }, end:{ x:pageWidth - margin, y:31.5 }, thickness:0.5, color:BLUE })
      linkAnnotation(listing, pageWidth - margin - labelWidth, 43, labelWidth, 14)
    }
    const pageLabel = `Vehicle ${record.vehicleIndex + 1} of ${selected.length} · Page ${record.vehiclePage} of ${vehiclePageTotals.get(record.vehicleIndex)}`
    text(`Prepared ${footerDate} · ${pageLabel}`, margin, 42, width - 190, 7.5, regular, MUTED, 9)
  }
  return new Blob([await pdf.save()], { type:'application/pdf' })
}
