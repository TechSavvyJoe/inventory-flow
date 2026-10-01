import './VehicleQuickFacts.css'

interface VehicleQuickFactsProps {
  vehicle?: {
    engine?: string | null
    drivetrain?: string | null
    transmission?: string | null
    exteriorColor?: string | null
    interiorColor?: string | null
    fuelType?: string | null
    mpgCity?: number | null
    mpgHighway?: number | null
  }
  standouts?: string[]
}

/** The same public configuration order on each operational vehicle preview. */
export function VehicleQuickFacts({ vehicle, standouts = [] }: VehicleQuickFactsProps) {
  if (!vehicle) return null
  const powertrain = [vehicle.engine, vehicle.drivetrain].filter(Boolean).join(' · ')
  const colors = [vehicle.exteriorColor, vehicle.interiorColor].filter(Boolean).join(' / ')
  const economy = [
    Number.isFinite(vehicle.mpgCity) && vehicle.mpgCity != null && vehicle.mpgCity > 0 ? `${vehicle.mpgCity} city` : null,
    Number.isFinite(vehicle.mpgHighway) && vehicle.mpgHighway != null && vehicle.mpgHighway > 0 ? `${vehicle.mpgHighway} hwy` : null,
  ].filter(Boolean).join(' / ')
  const driving = [vehicle.transmission, vehicle.fuelType, economy ? `${economy} MPG` : null].filter(Boolean).join(' · ')
  const facts = [
    ['Engine / drive', powertrain],
    ['Exterior / interior', colors],
    ['Transmission / fuel', driving],
    ['Standout equipment', standouts.join(' · ')],
  ].filter(([, value]) => value)
  if (!facts.length) return null
  return <span className="vehicle-quick-facts" role="group" aria-label="Vehicle quick facts">
    {facts.map(([label, value]) => <span className="vehicle-quick-facts__item" key={label} aria-label={`${label}: ${value}`} title={label}>{value}</span>)}
  </span>
}
