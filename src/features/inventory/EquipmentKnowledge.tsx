import { ExternalLink } from 'lucide-react'
import { equipmentTalkingPoints, manufacturerReferences } from '../../../extension/sidepanel/lib/manufacturer-knowledge.mjs'
import { publishedEquipment } from './vehicle-feature-utils'
import type { InventoryVehicle } from './types'
import './EquipmentKnowledge.css'

export function EquipmentKnowledge({ vehicle }: { vehicle: InventoryVehicle }) {
  const references = manufacturerReferences(vehicle)
  const points = equipmentTalkingPoints(vehicle, publishedEquipment(vehicle).map(item => item.label))
  if (!references.length && !points.length) return null
  return <details className="equipment-knowledge">
    <summary>Sales guide · packages &amp; feature differences</summary>
    <p>US manufacturer references for {vehicle.year} {vehicle.make} {vehicle.model}. The vehicle records above show what is captured for this VIN; these guides explain features and differences. Check the original market and guide revision.</p>
    {points.length ? <ul>{points.map(point => <li key={point.id}><strong>{point.title}</strong><span>{point.detail}</span>{point.url ? <a href={point.url} target="_blank" rel="noreferrer">Manufacturer reference<ExternalLink size={14} aria-hidden="true" /></a> : null}</li>)}</ul> : null}
    <nav aria-label="Manufacturer reference guides">{references.map(reference => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer">{reference.label}<ExternalLink size={14} aria-hidden="true" /></a>)}</nav>
  </details>
}
