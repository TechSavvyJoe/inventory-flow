/** A verified daily arrival starts an enduring queue entry; listing age never completes service. */
export function serviceIntakeRows(release, observedAt) {
  const current = new Set((release?.vehicles ?? []).filter((vehicle) => vehicle.publicRecord).map((vehicle) => vehicle.vin))
  const arrivals = new Map()
  for (const event of release?.publicChangeEvents ?? []) {
    if (event.type !== 'new_arrival' || !current.has(event.vin)) continue
    arrivals.set(event.vin, { vin: event.vin, first_arrival_date: event.reportDate || release.reportDate, observed_at: observedAt })
  }
  return [...arrivals.values()]
}
