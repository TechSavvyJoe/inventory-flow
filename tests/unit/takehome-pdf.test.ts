// @vitest-environment node
// @ts-nocheck -- shared framework-free browser module; fabricated records only.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFDict, PDFName, PDFString } from 'pdf-lib'
import { createTakeHomePdf, customerTakeHomePriceFacts } from '../../extension/sidepanel/lib/takehome-pdf.mjs'

const model = {
  vin:'TESTDATASYN000001', stockNumber:'DEMO-1', name:'2024 Ford Explorer Active',
  storeName:'Bob Maxey Ford of Howell', price:32000, msrp:40000, savings:8000, mileage:12000,
  specs:[['Engine','2.3L EcoBoost'],['Exterior','Carbonized Gray']], highlights:['Heated front seats'],
  equipment:['Heated front seats','Adaptive cruise control'], description:'Synthetic vehicle description.',
  listingUrl:'https://example.com/synthetic-listing',
}
const options = {
  now:new Date('2026-09-30T12:00:00Z'),
  fetcher:async (url:string) => new Response(await readFile(new URL(url))),
}
const load = async (blob:Blob) => PDFDocument.load(await blob.arrayBuffer())

describe('shared customer PDF', () => {
  it('keeps MSRP and reference pricing out of the customer price rail', () => {
    expect(customerTakeHomePriceFacts({ ...model, factoryPrices:{original:{value:40000},base:{value:35000}}, msrp:40000, savings:8000 })).toEqual([
      { label:'MILEAGE', value:'12,000 mi' },
      { label:'STOCK', value:'DEMO-1' },
    ])
  })

  it('loads at most three public photos for one vehicle', async () => {
    const requested:string[] = []
    const photo = await readFile(new URL('../../public/demo-vehicles/f150.jpg', import.meta.url))
    const fetcher = async (url:string) => {
      if (url.startsWith('file:')) return options.fetcher(url)
      requested.push(url)
      return new Response(photo)
    }
    const photos = ['https://example.com/1.jpg','https://example.com/2.jpg','https://example.com/2.jpg','https://example.com/3.jpg','https://example.com/4.jpg']
    await createTakeHomePdf([{...model,photos}], 'Three photos', {...options,fetcher})
    expect(requested).toEqual(['https://example.com/1.jpg','https://example.com/2.jpg','https://example.com/3.jpg'])
  })

  it.each([0,1])('measures long rail highlights with %i successful photo and preserves every full label', async (successfulPhotos) => {
    const photo = await readFile(new URL('../../public/demo-vehicles/f150.jpg', import.meta.url))
    const fetcher = async (url:string) => {
      if (url.startsWith('file:')) return options.fetcher(url)
      return successfulPhotos ? new Response(photo) : new Response(null, { status:403 })
    }
    const highlights = [
      'Badlands equipment group with premium-trim interior appointments, advanced trail systems, and model-specific appearance details',
      'Class II trailer tow package with factory hitch receiver, trailer-sway control, wiring connector, and documented cooling upgrades',
      'Ford Co-Pilot360 driver-assistance collection with blind-spot information, lane-keeping support, and automatic emergency braking',
      'Cargo management package with configurable dividers, reversible load floor, rear-seat protection, and covered small-item storage',
    ]
    expect(highlights.every(value => value.length >= 110)).toBe(true)
    const layouts:any[] = []
    const blob = await createTakeHomePdf([{ ...model, highlights, photos:['https://example.com/hero.jpg'] }], 'Measured highlights', {
      ...options, fetcher, layoutObserver:(layout:any) => layouts.push(layout),
    })
    const rail = layouts.find(layout => layout.type === 'hero-highlights')
    const overview = layouts.find(layout => layout.type === 'overview-highlights')
    expect(rail.successfulPhotos).toBe(successfulPhotos)
    expect(rail.fitted).toEqual(highlights.slice(0,2))
    expect(rail.highlightBottom).toBeGreaterThanOrEqual(rail.supportBottom)
    expect([...rail.fitted,...overview.values]).toEqual(highlights)
    expect(overview.values).toEqual(rail.remaining)
    expect(await load(blob)).toHaveProperty('getPageCount')
  })

  it('generates a readable PDF with embedded fonts and Unicode metadata', async () => {
    const blob = await createTakeHomePdf([model], 'José’s vehicle choices', options)
    expect(blob.type).toBe('application/pdf')
    expect(Buffer.from(await blob.arrayBuffer()).subarray(0,8).toString()).toBe('%PDF-1.7')
    const pdf = await load(blob)
    expect(pdf.getTitle()).toBe('José’s vehicle choices')
    expect(pdf.getAuthor()).toBe('Inventory Flow')
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getSize()).toEqual({ width:612, height:792 })
  })

  it('keeps two complete representative customer sheets to two branded pages', async () => {
    const rich = { ...model, storeSite:'bobmaxeyfordhowell.com',
      photos:['/demo-vehicles/f150.jpg','/demo-vehicles/f150.jpg'], logo:{src:'/brands/bob-maxey-ford.png'},
      specs:[['Body','SuperCrew pickup'],['Drivetrain','Four-wheel drive'],['Engine','2.7L EcoBoost V6'],['Transmission','10-speed automatic'],['Fuel','Gasoline'],['Fuel economy','18 city / 24 hwy'],['Exterior','Carbonized Gray Metallic'],['Interior','Black cloth']],
      highlights:['Ford Co-Pilot360','Heated front seats','SYNC 4 with 12-inch display','Apple CarPlay and Android Auto','Trailer tow package','Remote start','Blind-spot monitoring','Lane-keeping system'],
      equipment:['Class IV trailer hitch receiver','LED box lighting','Skid plates','BoxLink cargo management','Integrated trailer brake controller','Zone lighting','Electronic locking rear axle','Rear parking sensors','Power sliding rear window','36-gallon extended-range fuel tank','All-weather floor liners','Keyless-entry keypad'],
      certified:{name:'Ford Blue Certified',terms:['139-point inspection completed','14-day / 1,000-mile money-back guarantee','90-day / 4,000-mile comprehensive limited warranty'],note:'See the dealer for complete program eligibility, coverage, exclusions and transfer terms.'},
      description:'A well-equipped, locally traded pickup with the towing, driver-assistance and connectivity features customers ask for most. Clean cabin and a practical configuration for daily driving or weekend work.',
    }
    const fetcher = async (url:string) => url.startsWith('file:') ? options.fetcher(url) : new Response(await readFile(new URL('../../public'+new URL(url).pathname, import.meta.url)))
    const pdf = await load(await createTakeHomePdf([rich,{...rich,vin:'TESTDATASYN000002'}], 'Synthetic vehicle choices', {...options,fetcher,base:'http://127.0.0.1:4173/'}))
    expect(pdf.getPageCount()).toBe(2)
    const links = pdf.getPage(0).node.Annots()!.asArray().map(ref => pdf.context.lookup(ref,PDFDict).lookup(PDFName.of('A'),PDFDict).lookup(PDFName.of('URI'),PDFString).decodeText())
    expect(links).toEqual(['https://bobmaxeyfordhowell.com/',model.listingUrl])
  })

  it('never embeds unsafe or authenticated URL actions', async () => {
    for (const listingUrl of ['javascript:alert(1)','https://private:secret@example.com/']) {
      const pdf = await load(await createTakeHomePdf([{ ...model, listingUrl }], 'Safe links', options))
      expect(pdf.getPage(0).node.Annots()!.size()).toBe(0)
    }
  })

  it('starts each customer vehicle on a new page and deduplicates VINs', async () => {
    const other = { ...model, vin:'TESTDATASYN000002', name:'2024 Ford Escape' }
    const pdf = await load(await createTakeHomePdf([model, other, model], 'Two vehicle choices', options))
    expect(pdf.getPageCount()).toBe(2)
  })

  it('continues full descriptions and equipment rather than clipping content', async () => {
    const long = { ...model, equipment:Array.from({length:90},(_,i) => `Synthetic factory option ${i} with important qualifications`), description:'Full customer-facing description. '.repeat(600) }
    const pdf = await load(await createTakeHomePdf([long], 'Full details', options))
    expect(pdf.getPageCount()).toBeGreaterThan(3)
  })

  it('still creates the document when photos are unavailable', async () => {
    const fetcher = async (url:string) => url.startsWith('file:') ? options.fetcher(url) : new Response(null, {status:403})
    const pdf = await load(await createTakeHomePdf([{ ...model, photos:['https://example.com/blocked.jpg'] }], 'Photo failure', { ...options, fetcher }))
    expect(pdf.getPageCount()).toBe(1)
  })


  it.each([[2,1],[3,1],[4,2],[7,3]])('compares %i ordinary vehicles in %i landscape pages', async (count,pages) => {
    const models=Array.from({length:count},(_,index)=>({...model,vin:`TESTDATASYN${String(index).padStart(6,'0')}`,stockNumber:`DEMO-${index}`,highlights:['Heated front seats','Adaptive cruise control','Remote start','Rear parking sensors']}))
    let plan:any
    const pdf=await load(await createTakeHomePdf(models,'CUSTOMER LABEL PRIVATE',{...options,layout:'comparison',comparisonObserver:value=>plan=value}))
    expect(pdf.getPageCount()).toBe(pages)
    expect(pdf.getTitle()).toBe('Inventory Flow vehicle comparison')
    expect(pdf.getAuthor()).toBe('Inventory Flow')
    expect(plan.pages.map(page=>page.vehicles.length)).toEqual(count===4?[2,2]:count===7?[3,2,2]:[count])
    expect(plan.pages.flatMap(page=>page.vehicles.map(vehicle=>vehicle.vin))).toEqual(models.map(model=>model.vin))
    for(const page of plan.pages) for(const row of page.rows) expect(row.top+row.height).toBeLessThanOrEqual(548)
    const serialized=JSON.stringify(plan)
    expect(serialized).not.toContain('CUSTOMER LABEL PRIVATE')
    expect(serialized).not.toContain('2026-09-30')
    expect(serialized).not.toContain('msrp')
    expect(serialized).not.toContain('40000')
  })

  it('deduplicates comparison vehicles and exposes only customer fact projections', async () => {
    let plan:any
    const unsafe={...model,holdReason:'PRIVATE HOLD',customerName:'PRIVATE CUSTOMER',operationalMovement:'PRIVATE MOVE',history:'PRIVATE HISTORY',description:'PRIVATE DESCRIPTION'}
    await createTakeHomePdf([unsafe,{...unsafe,vin:'TESTDATASYN000002'},unsafe],'Private customer label',{...options,layout:'comparison',comparisonObserver:value=>plan=value})
    expect(plan.pages.flatMap(page=>page.vehicles.map(vehicle=>vehicle.vin))).toEqual([model.vin,'TESTDATASYN000002'])
    expect(JSON.stringify(plan)).not.toContain('PRIVATE')
    const labels=plan.pages[0].rows.map(row=>row.label)
    expect(labels).toEqual(expect.arrayContaining(['Selling price','Powertrain','Vehicle details']))
    expect(plan.width).toBe(792);expect(plan.height).toBe(612)
    const rows=plan.pages[0].rows.flatMap(row=>row.cells.flatMap(cell=>cell.lines)).join(' ')
    expect(rows).toContain('Engine: 2.3L EcoBoost');expect(rows).toContain('Exterior: Carbonized Gray')
    expect(rows).not.toContain(model.listingUrl)
  })

  it('preserves full pathological names, specifications and selected highlights across continuation pages', async () => {
    const name='Long synthetic vehicle designation '.repeat(110)
    const engine='Complete documented engine qualification '.repeat(190)
    const highlight='Full equipment package with every meaningful qualification '.repeat(200)
    let plan:any
    const pdf=await load(await createTakeHomePdf([{...model,name,specs:[['Engine',engine]],highlights:[highlight,'Second complete highlight','Third complete highlight','Fourth complete highlight','Fifth highlight']}],'Choices',{...options,layout:'comparison',comparisonObserver:value=>plan=value}))
    expect(pdf.getPageCount()).toBeGreaterThan(3)
    const rows=plan.pages.flatMap(page=>page.rows)
    const join=(kind,label)=>rows.filter(row=>row.kind===kind && (label===undefined || row.label===label)).flatMap(row=>row.cells[0].lines).join(' ').replace(/\s/g,'')
    expect(join('name')).toBe(name.replace(/\s/g,''))
    expect(join('specs','Powertrain')).toContain(engine.replace(/\s/g,''))
    expect(join('highlight')).toContain(highlight.replace(/\s/g,''))
    expect(join('highlight')).toContain('Fourthcompletehighlight')
    expect(join('more')).toBe('Moreequipmentavailableinthefulllisting.')
    expect(plan.pages.slice(1).every(page=>page.continued)).toBe(true)
    for(const page of plan.pages) for(const row of page.rows) expect(row.top+row.height).toBeLessThanOrEqual(548)
  })

  it('falls back to a decoded photo and keeps broken images optional in comparisons', async () => {
    const photo=await readFile(new URL('../../public/demo-vehicles/f150.jpg',import.meta.url)), requested:string[]=[]
    let plan:any
    const fetcher=async (url:string)=>{
      if(url.startsWith('file:')) return options.fetcher(url)
      requested.push(url)
      return url.endsWith('/good.jpg')?new Response(photo):new Response(null,{status:403})
    }
    const pdf=await load(await createTakeHomePdf([{...model,photos:['https://example.com/bad.jpg','https://example.com/good.jpg','https://example.com/unused.jpg']},{...model,vin:'OTHER',photos:['https://example.com/blocked.jpg']}],'Choices',{...options,fetcher,layout:'comparison',comparisonObserver:value=>plan=value}))
    expect(pdf.getPageCount()).toBe(1)
    expect(plan.pages[0].vehicles.map(vehicle=>vehicle.photoSrc)).toEqual(['https://example.com/good.jpg',null])
    expect(requested).not.toContain('https://example.com/unused.jpg')
  })

  it('attaches safe clickable listing links to each comparison column', async () => {
    for(const listingUrl of [model.listingUrl,'javascript:alert(1)','https://private:secret@example.com/']) {
      let plan:any
      const pdf=await load(await createTakeHomePdf([{...model,listingUrl}],'Choices',{...options,layout:'comparison',comparisonObserver:value=>plan=value}))
      const annotations=pdf.getPage(0).node.Annots()?.asArray() ?? []
      const links=annotations.map(ref=>pdf.context.lookup(ref,PDFDict).lookup(PDFName.of('A'),PDFDict).lookup(PDFName.of('URI'),PDFString).decodeText())
      expect(links).toEqual(listingUrl===model.listingUrl?[listingUrl]:[])
      expect(plan.pages[0].vehicles[0].listingUrl).toBe(listingUrl===model.listingUrl?listingUrl:null)
    }
  })


  it('prints a legible quiet-zone QR instead of an unreadable raw listing slug', async () => {
    let plan:any
    const url='https://example.com/inventory/2024-ford-explorer-active-TESTDATASYN000001'
    const pdf=await load(await createTakeHomePdf([{...model,listingUrl:url}],'Customer private label',{...options,layout:'comparison',comparisonObserver:value=>plan=value}))
    expect(pdf.getPage(0).getSize()).toEqual({width:792,height:612})
    expect(plan.geometry).toEqual({headerTop:24,headerRuleTop:56,bodyTop:70,bodyBottom:548,footerTop:564})
    const row=plan.pages[0].rows.find(row=>row.kind==='qr'),cell=row.cells[0]
    expect(row.height).toBeGreaterThanOrEqual(90)
    expect(cell.offer.qrSize).toBe(66)
    expect(cell.qr.modules.length).toBe(cell.qr.size)
    expect(cell.qr.modules.flat().some(Boolean)).toBe(true)
    expect(cell.qr.modules.slice(0,4).flat().some(Boolean)).toBe(false)
    expect(cell.qr.modules.slice(-4).flat().some(Boolean)).toBe(false)
    expect(cell.qr.modules.every(line=>!line.slice(0,4).some(Boolean)&&!line.slice(-4).some(Boolean))).toBe(true)
    expect(cell.lines.join(' ')).toBe('Scan vehicle details')
    expect(cell.link).toBe(url)
    expect(plan.pages[0].rows.flatMap(row=>row.cells.flatMap(cell=>cell.lines)).join(' ')).not.toContain(url)
  })

  it('keeps all eight published specifications in compact comparison groups', async () => {
    const specs=[['Body','SuperCrew pickup'],['Drivetrain','Four-wheel drive'],['Engine','2.7L EcoBoost V6'],['Transmission','10-speed automatic'],['Fuel','Gasoline'],['Fuel economy','18 city / 24 hwy'],['Exterior','Carbonized Gray Metallic'],['Interior','Black cloth']]
    let plan:any
    const pdf=await load(await createTakeHomePdf(Array.from({length:3},(_,i)=>({...model,vin:`FULL-SPECS-${i}`,storeName:i===2?'Bob Maxey Ford in Fowlerville':model.storeName,certified:{name:'Ford Blue Certified'},equipment:['Additional factory option'],specs,highlights:['Heated front seats','Adaptive cruise control','Remote start','Trailer tow package']})),'Choices',{...options,layout:'comparison',comparisonObserver:value=>plan=value}))
    expect(pdf.getPageCount()).toBe(1)
    const text=plan.pages[0].rows.filter(row=>row.kind==='specs').flatMap(row=>row.cells[0].lines).join(' ')
    for(const [,value] of specs) expect(text).toContain(value)
    expect(plan.pages[0].rows.filter(row=>row.kind==='specs')).toHaveLength(2)
  })

  it('reports missing required fonts so the interface can offer a retry', async () => {
    await expect(createTakeHomePdf([model], 'Retry', { ...options, fetcher:async () => new Response(null, {status:503}) })).rejects.toThrow('Document asset could not load')
  })

  it('ships the reviewed library bytes with a self-contained companion wrapper', async () => {
    const root = new URL('../../', import.meta.url)
    const library = await readFile(new URL('node_modules/pdf-lib/dist/pdf-lib.esm.min.js', root), 'utf8')
    expect(await readFile(new URL('extension/sidepanel/vendor/pdf-lib.js', root), 'utf8')).toBe(library.split('\n').filter(line => !line.startsWith('//# sourceMappingURL=')).join('\n'))
    const fontkit = await readFile(new URL('node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js', root), 'utf8')
    const wrapped = await readFile(new URL('extension/sidepanel/vendor/fontkit.js', root), 'utf8')
    expect(wrapped).toBe('// Self-contained browser module. See README.md for source and licenses.\nconst module = { exports:{} }; const exports = module.exports;\n'+fontkit+'\nexport default module.exports;\n')
  })
})
