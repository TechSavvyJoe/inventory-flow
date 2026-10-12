// Customer-only landscape comparison: measured once for PDF and browser print.
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
export const COMPARISON_SPECS = Object.freeze([
  ['Body style','Body'], ['Drivetrain','Drivetrain'], ['Engine','Engine'], ['Transmission','Transmission'],
  ['Fuel type','Fuel'], ['Fuel economy','Fuel economy'], ['Exterior color','Exterior'], ['Interior color','Interior'],
])
export function comparisonGroups(count) {
  const groups = []
  while (count > 0) { const size = count === 4 ? 2 : Math.min(3, count); groups.push(size); count -= size }
  return groups
}
export function comparisonFacts(model) {
  const specs = new Map(model.specs ?? [])
  const fact = (label,key) => clean(specs.get(key)) ? `${label}: ${clean(specs.get(key))}` : null
  const join = (...values) => values.filter(Boolean).join(' · ')
  const powertrain = [join(fact('Engine','Engine'),clean(specs.get('Drivetrain'))),join(fact('Transmission','Transmission'),clean(specs.get('Fuel')))].filter(Boolean)
  const details = [join(fact('Body','Body'),clean(specs.get('Fuel economy'))),fact('Exterior','Exterior'),fact('Interior','Interior')].filter(Boolean)
  const highlights = [...new Set((model.highlights ?? []).map(clean).filter(Boolean))]
  return [
    {kind:'specs',label:'Powertrain',value:powertrain.join('\n') || 'Powertrain details not published.'},
    {kind:'specs',label:'Vehicle details',value:details.join('\n') || 'Vehicle specifications not published.'},
    ...Array.from({length:4},(_,index) => ({kind:'highlight',label:index === 0 ? 'Standout features' : '',value:highlights[index] ?? ''})),
    {kind:'more',label:'',value:highlights.length > 4 || (model.equipment ?? []).some(value=>!highlights.slice(0,4).includes(value)) ? 'More equipment available in the full listing.' : ''},
  ]
}
export function createComparisonPlan(models, {wrap, safeLink = () => null, photoSources = new Map(), logoSources = new Map(), qrCodes = new Map()} = {}) {
  const selected = [...new Map(models.map(model => [model.vin,model])).values()]
  const geometry={headerTop:24,headerRuleTop:56,bodyTop:70,bodyBottom:548,footerTop:564}
  const plan = {title:'Vehicle comparison',width:792,height:612,margin:32,geometry,pages:[]}
  const capacity=geometry.bodyBottom-geometry.bodyTop
  const makeRows = group => {
    const columnWidth = (728 - 12 * (group.length - 1)) / group.length
    const facts = group.map(comparisonFacts), mixed=!group.every(model=>model.storeName===group[0].storeName)
    const rows=[]
    const add=(kind,label,values,size=10,bold=false,lineHeight=size+2.5) => {
      const cells=values.map(value=>({lines:value?wrap(value,columnWidth,size,bold):[]}))
      if(!cells.some(cell=>cell.lines.length)) return
      rows.push({kind,label,height:(label?12:0)+Math.max(...cells.map(cell=>cell.lines.length))*lineHeight+4,size,lineHeight,bold,cells})
    }
    add('name','',group.map(model=>clean(model.name)),14,true,17)
    if(mixed) add('store','',group.map(model=>clean(model.storeName)),10,false,12.5)
    if(group.some(model=>model.certified?.name)) add('certification','',group.map(model=>clean(model.certified?.name)),10,true,12.5)
    rows.push({kind:'photo',label:'',height:group.length===3?126:150,size:10,lineHeight:12.5,bold:false,cells:group.map(()=>({lines:[]}))})
    const longStock=[]
    const offerCells=group.map(model=> {
      const link=safeLink(model.listingUrl), qr=link?qrCodes.get(link) ?? null:null, textWidth=columnWidth-78
      const price=model.price==null?'Call for price':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(model.price)
      const stock=`Stock ${clean(model.stockNumber)||'not published'}`, stockLines=wrap(stock,textWidth,10,false)
      longStock.push(stockLines.length>2?stock:'')
      const caption=qr?'Scan vehicle details':'Ask dealership for details'
      const priceLines=wrap(price,textWidth,22,true), mileageLines=wrap(model.mileage==null?'Mileage not published':`${model.mileage.toLocaleString('en-US')} miles`,textWidth,10,false)
      const mileageTop=10+priceLines.length*25+7, stockTop=mileageTop+mileageLines.length*12.5+3
      return {lines:wrap(caption,66,9,false),...(link?{link}:{}),qr,offer:{priceLines,mileageLines,stockLines:stockLines.length>2?[]:stockLines,textWidth,priceSize:22,priceLineHeight:25,metaSize:10,metaLineHeight:12.5,priceTop:10,mileageTop,stockTop,qrSize:66,qrTop:0,captionTop:69,captionSize:9,captionLineHeight:10}}
    })
    rows.push({kind:'qr',label:'Selling price',height:Math.max(90,...offerCells.map(cell=>Math.max(69+cell.lines.length*10+4,cell.offer.stockTop+cell.offer.stockLines.length*12.5+5))),size:10,lineHeight:12.5,bold:false,cells:offerCells})
    add('stock','',longStock)
    for(let index=0;index<facts[0].length;index++) add(facts[0][index].kind,facts[0][index].label,facts.map(list=>list[index].value),facts[0][index].kind==='more'?9:10,false,facts[0][index].kind==='more'?11:12.5)
    // Keep ordinary comparisons together before discarding a column: a store
    // label or one extra text line can use the photo's flexible height. Never
    // shrink customer text or go below the existing three-column photo size.
    if (group.length > 1) {
      const overflow = rows.reduce((sum,row) => sum + row.height,0) - capacity
      const photo = rows.find(row => row.kind === 'photo')
      if (overflow > 0) photo.height = Math.max(126,photo.height - overflow)
    }
    return rows
  }
  const safeVehicle = model => ({vin:clean(model.vin),name:clean(model.name),stockNumber:clean(model.stockNumber),storeName:clean(model.storeName),storeSite:clean(model.storeSite),logo:logoSources.get(model.vin) ?? null,photoSrc:photoSources.get(model.vin) ?? null,listingUrl:safeLink(model.listingUrl)})
  let offset = 0
  while(offset < selected.length) {
    let count = comparisonGroups(selected.length-offset)[0]
    let group = selected.slice(offset,offset+count), rows = makeRows(group)
    while(count>1 && rows.reduce((sum,row)=>sum+row.height,0)>capacity) {count--;group=selected.slice(offset,offset+count);rows=makeRows(group)}
    const vehicles=group.map(safeVehicle), columnWidth=(728-12*(count-1))/count
    const columns=group.map((_,index)=>({x:32+index*(columnWidth+12),width:columnWidth}))
    let current, top
    const nextPage=continued=> {
      const sameStore=vehicles.every(vehicle=>vehicle.storeName===vehicles[0].storeName)
      // A shared logo must be supplied by every store; never infer a dealer group from its name.
      const sharedLogo=vehicles[0].logo?.src && vehicles.every(vehicle=>vehicle.logo?.src===vehicles[0].logo.src)
      const headerLogo=sameStore || sharedLogo?vehicles[0].logo:null
      current={index:plan.pages.length+1,continued,vehicles,columns,headerLogo,headerTitle:'Vehicle comparison',headerStore:sameStore?vehicles[0].storeName || 'Inventory Flow':'Inventory Flow',headerSite:sameStore?vehicles[0].storeSite:'',footerDisclaimer:'Price excludes tax, title, license and dealer fees. Confirm equipment, mileage and availability with the dealership before purchase.',footerPage:'',rows:[]}
      plan.pages.push(current);top=geometry.bodyTop
      if(continued) {
        const cells=vehicles.map((vehicle,index)=> {
          const lines=wrap(`Stock ${vehicle.stockNumber} · details continued`,columnWidth,10,true)
          return {lines:lines.length<=3?lines:wrap(`Vehicle ${offset+index+1} · details continued`,columnWidth,10,true)}
        })
        const height=Math.max(...cells.map(cell=>cell.lines.length))*12.5+8
        current.rows.push({kind:'continuation',label:'',top,height,size:10,lineHeight:12.5,bold:true,cells});top+=height
      }
    }
    nextPage(false)
    for(const row of rows) {
      if(top+row.height<=geometry.bodyBottom) {current.rows.push({...row,top});top+=row.height;continue}
      if(row.height<=capacity && top>geometry.bodyTop) nextPage(true)
      if(top+row.height<=geometry.bodyBottom) {current.rows.push({...row,top});top+=row.height;continue}
      let consumed=0,total=Math.max(...row.cells.map(cell=>cell.lines.length))
      while(consumed<total) {
        const available=Math.floor((geometry.bodyBottom-top-(row.label?12:0)-4)/row.lineHeight)
        if(available<1) {nextPage(true);continue}
        const take=Math.min(available,total-consumed),height=(row.label?12:0)+take*row.lineHeight+4
        current.rows.push({...row,top,height,cells:row.cells.map(cell=>({...cell,lines:cell.lines.slice(consumed,consumed+take)}))})
        top+=height;consumed+=take
        if(consumed<total) nextPage(true)
      }
    }
    offset+=count
  }
  for(const page of plan.pages) {
    page.footerPage=`Page ${page.index} of ${plan.pages.length}`
    for(const row of page.rows) Object.assign(row,{fontWeight:row.bold?700:400,labelLines:row.label?[row.label]:[],labelSize:9,labelHeight:row.label?12:0})
  }
  return plan
}
