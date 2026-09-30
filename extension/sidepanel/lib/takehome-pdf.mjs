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

export async function createTakeHomePdf(models, title, { fetcher = globalThis.fetch, now = new Date(), base = globalThis.location?.href ?? 'https://inventory-ops.joegallant.me/' } = {}) {
  const selected = [...new Map(models.map(model => [model.vin, model])).values()]
  if (!selected.length) throw new Error('Choose a vehicle before preparing a PDF.')
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const [regularBytes, boldBytes] = await Promise.all([
    bytes(new URL('../../fonts/Inter-Regular.woff', import.meta.url).href, fetcher),
    bytes(new URL('../../fonts/Inter-Bold.woff', import.meta.url).href, fetcher),
  ])
  const regular = await pdf.embedFont(regularBytes, { subset:true }), bold = await pdf.embedFont(boldBytes, { subset:true })
  pdf.setTitle(clean(title)); pdf.setAuthor('Inventory Flow · Bob Maxey'); pdf.setCreator('Inventory Flow'); pdf.setCreationDate(now)

  const footerDate = now.toLocaleDateString('en-US')
  const pageWidth = 612, pageHeight = 792, margin = 32, width = pageWidth - 2 * margin, bottom = 72
  const pageRecords = []
  const measurements = new Map()
  let page, y, currentModel, currentAssets, currentVehicleIndex = 0, currentVehiclePage = 0

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

  function displayDate(value) {
    if (!value) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString('en-US')
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
    page.drawLine({ start:{ x:margin, y }, end:{ x:pageWidth - margin, y }, thickness:0.7, color:LINE })
    y -= 9
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
    const hero = photos[0]
    const heroHeight = hero ? 214 : 146
    const photoWidth = 394, priceX = margin + 408, priceWidth = width - 408
    page.drawRectangle({ x:margin, y:y - heroHeight, width:photoWidth, height:heroHeight, color:PALE, borderColor:LINE, borderWidth:0.6 })
    if (hero) {
      const thumbWidth = photos.length > 1 ? 58 : 0
      const heroWidth = photos.length > 1 ? photoWidth - thumbWidth - 7 : photoWidth
      coverPhoto(hero, margin, y, heroWidth, heroHeight)
      if (photos.length > 1) {
        const gap = 5, thumbHeight = (heroHeight - gap * 2) / 3
        photos.slice(1, 4).forEach((photo, index) => coverPhoto(photo, margin + heroWidth + 7, y - index * (thumbHeight + gap), thumbWidth, thumbHeight))
      }
    } else {
      text('Photo unavailable in this copy', margin + 18, y - heroHeight / 2 + 8, photoWidth - 36, 10, bold, MUTED)
      text('View the full listing for current photos.', margin + 18, y - heroHeight / 2 - 9, photoWidth - 36, 8.5, regular, MUTED)
    }

    page.drawRectangle({ x:priceX, y:y - heroHeight, width:priceWidth, height:heroHeight, color:WHITE, borderColor:LINE, borderWidth:0.6 })
    const inset = priceX + 12, inner = priceWidth - 24
    text('PUBLISHED PRICE', inset, y - 13, inner, 7, bold, MUTED, 9)
    text(currentModel.price != null ? MONEY.format(currentModel.price) : 'Call for price', inset, y - 29, inner, 19, bold, BLUE, 22)
    let priceY = y - 60
    if (currentModel.msrp != null) { text('MSRP', inset, priceY, 40, 7, regular, MUTED); textRight(MONEY.format(currentModel.msrp), priceX + priceWidth - 12, priceY, inner - 42, 8.5, bold); priceY -= 15 }
    if (currentModel.savings) { text('UNDER MSRP', inset, priceY, 75, 7, regular, MUTED); textRight(MONEY.format(currentModel.savings), priceX + priceWidth - 12, priceY, inner - 70, 8.5, bold, BLUE); priceY -= 18 }
    page.drawLine({ start:{ x:inset, y:priceY }, end:{ x:priceX + priceWidth - 12, y:priceY }, thickness:0.5, color:LINE }); priceY -= 10
    text('MILEAGE', inset, priceY, inner, 7, bold, MUTED)
    text(currentModel.mileage != null ? `${currentModel.mileage.toLocaleString('en-US')} mi` : 'Not published', inset, priceY - 14, inner, 9.5, bold)
    priceY -= 40
    text('STOCK', inset, priceY, inner, 7, bold, MUTED)
    text(currentModel.stockNumber, inset, priceY - 14, inner, 8.5, bold)
    y -= heroHeight + 7
  }

  function drawIdentity() {
    const snapshot = displayDate(currentModel.publishedAt)
    const historyDate = displayDate(currentModel.historyCapturedAt)
    const entries = [
      `VIN ${currentModel.vin}`,
      currentModel.history ? `${currentModel.history}${historyDate ? ` · report ${historyDate}` : ''}` : 'Vehicle history details available from the store',
      snapshot ? `Inventory snapshot ${snapshot}` : 'Confirm current inventory with the store',
    ]
    const gap = 12, colWidth = (width - gap * 2) / 3, size = 7.3, lineHeight = 9.2
    const wrapped = entries.map(entry => lines(entry, colWidth, regular, size))
    const height = Math.max(...wrapped.map(item => item.length)) * lineHeight + 10
    page.drawRectangle({ x:margin, y:y - height, width, height, color:PALE })
    wrapped.forEach((entry, index) => drawLines(entry, margin + 8 + index * (colWidth + gap), y - 5, size, index === 0 ? bold : regular, index === 0 ? INK : MUTED, lineHeight))
    y -= height + 7
  }

  function rowHeight(row, lineHeight) {
    return Math.max(1, ...row.filter(Boolean).map(item => item.length)) * lineHeight + 2
  }

  function drawPairedOverview() {
    const gap = 22, colWidth = (width - gap) / 2, size = 8.5, lineHeight = 10.5
    const left = (currentModel.specs ?? []).map(([label, value]) => lines(`${label}: ${value}`, colWidth, regular, size))
    const rightValues = currentModel.highlights?.length ? currentModel.highlights : ['Ask the store about installed equipment.']
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
    const loaded = await Promise.all([
      image(pdf, model.photos?.[0], fetcher, base),
      image(pdf, (model.logo ?? model.brand)?.src, fetcher, base),
      ...(model.photos ?? []).slice(1, 4).map(url => image(pdf, url, fetcher, base)),
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
      drawGridSection(currentModel.certified.name, currentModel.certified.terms ?? [], 2, 8.1, 10.3)
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
