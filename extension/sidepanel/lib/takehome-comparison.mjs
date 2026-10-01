// Customer-only comparison projection and deterministic measured pagination.
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
  const highlights = [...new Set((model.highlights ?? []).map(clean).filter(Boolean))]
  return [
    {kind:'name',label:'',value:clean(model.name)},
    {kind:'price',label:'Selling price',value:model.price == null ? 'Call for price' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(model.price)},
    {kind:'fact',label:'Mileage',value:model.mileage == null ? 'Not published' : `${model.mileage.toLocaleString('en-US')} mi`},
    {kind:'fact',label:'Stock number',value:clean(model.stockNumber) || 'Not published'},
    {kind:'fact',label:'Dealership',value:clean(model.storeName)},
    ...COMPARISON_SPECS.map(([label,key]) => ({kind:'fact',label,value:clean(specs.get(key)) || 'Not published'})),
    {kind:'fact',label:'Certification',value:clean(model.certified?.name) || 'Not published'},
    ...Array.from({length:4},(_,index) => ({kind:'highlight',label:index === 0 ? 'Standout features' : '',value:highlights[index] ?? ''})),
    {kind:'more',label:'',value:highlights.length > 4 || (model.equipment ?? []).some(value=>!highlights.slice(0,4).includes(value)) ? 'More equipment in the full listing.' : ''},
  ]
}
export function createComparisonPlan(models, {wrap, safeLink = () => null, photoSources = new Map(), logoSources = new Map()} = {}) {
  const selected = [...new Map(models.map(model => [model.vin,model])).values()]
  const plan = {title:'Vehicle comparison',width:612,height:792,margin:32,pages:[]}
  const makeRows = group => {
    const columnWidth = (548 - 12 * (group.length - 1)) / group.length
    const facts = group.map(comparisonFacts)
    const rows = [{kind:'photo',label:'',height:group.length === 3 ? 100 : 142,size:10,lineHeight:12.5,bold:false,cells:group.map(() => ({lines:[]}))}]
    for (let index=0; index<facts[0].length; index++) {
      const fact = facts[0][index], size = fact.kind === 'name' ? 14 : fact.kind === 'price' ? 20 : 10
      const lineHeight = size + 2.5, bold = fact.kind === 'name' || fact.kind === 'price'
      const cells = facts.map(list => ({lines:list[index].value ? wrap(list[index].value,columnWidth,size,bold) : []}))
      if (!cells.some(cell => cell.lines.length)) continue
      rows.push({kind:fact.kind,label:fact.label,height:(fact.label ? 10 : 0) + Math.max(...cells.map(cell => cell.lines.length)) * lineHeight + 3,size,lineHeight,bold,cells})
    }
    const cells = group.map(model => {
      const link = safeLink(model.listingUrl)
      return {lines:wrap(link ? `View full vehicle listing\n${link}` : 'Contact the dealership for listing details.',columnWidth,8.5,false),...(link ? {link} : {})}
    })
    rows.push({kind:'listing',label:'',height:Math.max(...cells.map(cell => cell.lines.length))*11+5,size:8.5,lineHeight:11,bold:false,cells})
    return rows
  }
  const safeVehicle = model => ({vin:clean(model.vin),name:clean(model.name),stockNumber:clean(model.stockNumber),storeName:clean(model.storeName),storeSite:clean(model.storeSite),logo:logoSources.get(model.vin) ?? null,photoSrc:photoSources.get(model.vin) ?? null,listingUrl:safeLink(model.listingUrl)})
  let offset = 0
  while(offset < selected.length) {
    let count = comparisonGroups(selected.length-offset)[0]
    let group = selected.slice(offset,offset+count), rows = makeRows(group)
    while(count > 1 && rows.reduce((sum,row)=>sum+row.height,0)>632) { count--; group=selected.slice(offset,offset+count); rows=makeRows(group) }
    const vehicles = group.map(safeVehicle), columnWidth=(548-12*(count-1))/count
    const columns=group.map((_,index)=>({x:32+index*(columnWidth+12),width:columnWidth}))
    let current, top
    const nextPage = continued => {
      const sameStore=vehicles.every(vehicle=>vehicle.storeName===vehicles[0].storeName)
      current={index:plan.pages.length+1,continued,vehicles,columns,headerTitle:'Vehicle comparison',headerStore:sameStore?vehicles[0].storeName:'Bob Maxey',headerSite:sameStore?vehicles[0].storeSite:'',footerDisclaimer:'Price excludes tax, title, license and dealer fees. Confirm equipment, mileage and availability with the dealership before purchase.',footerPage:'',rows:[]}; plan.pages.push(current); top=82
      if(continued) {
        const cells=vehicles.map(vehicle=>({lines:wrap(`Stock ${vehicle.stockNumber} · details continued`,columnWidth,10,true)}))
        const compact=cells.map((cell,index)=>cell.lines.length<=3?cell:{lines:wrap(`Vehicle ${offset+index+1} · details continued`,columnWidth,10,true)})
        const height=Math.max(...compact.map(cell=>cell.lines.length))*12.5+8
        current.rows.push({kind:'continuation',label:'',top,height,size:10,lineHeight:12.5,bold:true,cells:compact});top+=height
      }
    }
    nextPage(false)
    for(const row of rows) {
      if(top+row.height<=714) { current.rows.push({...row,top});top+=row.height;continue }
      if(row.height<=632 && top>82) nextPage(true)
      if(top+row.height<=714) {current.rows.push({...row,top});top+=row.height;continue}
      let consumed=0, total=Math.max(...row.cells.map(cell=>cell.lines.length))
      while(consumed<total) {
        const available=Math.floor((714-top-(row.label?10:0)-5)/row.lineHeight)
        if(available<1) {nextPage(true);continue}
        const take=Math.min(available,total-consumed)
        const height=(row.label?10:0)+take*row.lineHeight+5
        current.rows.push({...row,top,height,cells:row.cells.map(cell=>({...cell,lines:cell.lines.slice(consumed,consumed+take)}))})
        top+=height;consumed+=take
        if(consumed<total) nextPage(true)
      }
    }
    offset+=count
  }
  for(const page of plan.pages) {
    page.footerPage=`Page ${page.index} of ${plan.pages.length}`
    for(const row of page.rows) Object.assign(row,{fontWeight:row.bold?700:400,labelLines:row.label?[row.label]:[],labelSize:8.5,labelHeight:row.label?10:0})
  }
  return plan
}
