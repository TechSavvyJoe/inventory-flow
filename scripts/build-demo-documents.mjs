/** Generates only synthetic static document data; never opens live data. */
import { writeFile, mkdir } from 'node:fs/promises'
import { buildSyntheticRelease } from '../fixtures/synthetic-release.mjs'

const target = new URL('../public/demo-documents/', import.meta.url)
await mkdir(target, { recursive: true })
const samples = Object.fromEntries(buildSyntheticRelease({ includeDemoChanges: true }).vehicles.map(({ vin, publicRecord: v, resourceRecord }) => [vin, {
  vin, title: v.vehicle_name, stock: v.stock_number, store: v.store,
  msrp: v.msrp, exterior: v.exterior_color, interior: v.interior_color,
  engine: v.engine, transmission: v.transmission, drivetrain: v.drivetrain,
  body: v.body_style, features: v.features.split(' | '),
  options: v.windowSticker.options, standardEquipment: v.windowSticker.standardEquipment,
  equipmentGroup: v.windowSticker.equipmentGroup, equipmentGroupContents: v.windowSticker.equipmentGroupContents,
  pricing: resourceRecord?.factoryEquipment ? {
    base: resourceRecord.factoryEquipment.basePrice,
    options: resourceRecord.factoryEquipment.totalOptions,
    destination: resourceRecord.factoryEquipment.destinationCharge,
  } : null,
}]))
await writeFile(new URL('samples.json', target), JSON.stringify(samples, null, 2) + '\n')
console.log(`Generated ${Object.keys(samples).length} synthetic window sticker samples.`)
