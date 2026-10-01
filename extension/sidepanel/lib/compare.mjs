// Side-by-side comparison of two or three panel vehicles: the facts a deal
// turns on, plus the equipment each one has that the others do not.
import { equipmentKey, publishedEquipment } from './equipment.mjs'
import { formatMileage, formatMoney, formatNumber } from './format.mjs'
import { serviceWorkflowStatus } from './service-readiness.mjs'
import { factoryPricing, factoryPriceLabel, formatFactoryPrice } from './factory-pricing.mjs'

function documentPrice(vehicle, key) {
  const price = factoryPricing(vehicle.documents)[key];
  return price.value === null ? 'Not captured' : `${formatFactoryPrice(price.value, price.currency)} · ${factoryPriceLabel(price.source, key === 'base')}`;
}

const FACTS = [
  ['Price', (v) => formatMoney(v.price)],
  ['Original / vAuto MSRP', (v) => documentPrice(v, 'original')],
  ['Base MSRP', (v) => documentPrice(v, 'base')],
  ['Mileage', (v) => (v.mileage === null ? '—' : formatMileage(v.mileage))],
  ['Days listed', (v) => (v.daysListed === null ? '—' : formatNumber(v.daysListed))],
  ['Year', (v) => String(v.year || '—')],
  ['Trim', (v) => v.trim ?? '—'],
  ['Body', (v) => v.bodyStyle ?? '—'],
  ['Drivetrain', (v) => v.drivetrain ?? '—'],
  ['Engine', (v) => v.engine ?? '—'],
  ['Transmission', (v) => v.transmission ?? '—'],
  ['Fuel', (v) => v.fuelType ?? '—'],
  ['MPG', (v) => (v.specs.mpgCity !== null || v.specs.mpgHighway !== null ? `${v.specs.mpgCity ?? '—'} / ${v.specs.mpgHighway ?? '—'}` : '—')],
  ['Exterior', (v) => v.exteriorColor ?? '—'],
  ['Interior', (v) => v.interiorColor ?? '—'],
  ['Certified', (v) => (v.certified ? v.certifiedProgram?.name ?? 'Certified' : 'No')],
  ['AutoCheck', (v) => (v.documents.autoCheck?.score !== null && v.documents.autoCheck?.score !== undefined ? String(v.documents.autoCheck.score) : '—')],
  ['Hold', (v) => v.hold.label],
  ['Service', (v) => ({ needs_service: 'Waiting for service', in_service: 'In service', serviced: 'Ready' })[serviceWorkflowStatus(v.serviceReadiness)]],
  ['Location', (v) => [v.location.label, v.location.provenance].filter(Boolean).join(' · ')],
  ['Movement', (v) => v.movement?.label ?? v.movement?.state ?? 'No move recorded'],
  ['Home store', (v) => v.homeStore],
  ['Stock', (v) => v.stockNumber],
  ['VIN', (v) => v.vin],
]

export function compareVehicles(vehicles) {
  const list = vehicles.slice(0, 3)
  const facts = FACTS.map(([label, read]) => {
    const values = list.map(read)
    return { label, values, differs: new Set(values).size > 1 }
  })
  const equipment = list.map((vehicle) => new Map(publishedEquipment(vehicle).map((item) => [equipmentKey(item.label), item.label])))
  const onlyOn = list.map((vehicle, index) => ({
    vehicle,
    items: [...equipment[index].entries()].filter(([key]) => equipment.every((other, position) => position === index || !other.has(key))).map(([, label]) => label),
  }))
  const shared = list.length > 1 ? [...equipment[0].keys()].filter((key) => equipment.every((other) => other.has(key))).length : 0
  return { vehicles: list, facts, onlyOn, shared }
}
