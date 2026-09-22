const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function isoDay(value) {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : value
}

function earliestDay(...values) {
  const days = values.map(isoDay).filter(Boolean)
  return days.sort()[0] ?? null
}

/** A verified daily arrival starts an enduring queue entry; listing age never completes service. */
export function serviceIntakeRows(release, observedAt) {
  const current = new Map((release?.vehicles ?? []).flatMap((vehicle) => (
    vehicle?.publicRecord && typeof vehicle.vin === 'string'
      ? [[vehicle.vin, isoDay(vehicle.publicRecord.inventory_date)]]
      : []
  )))
  const arrivals = new Map()
  for (const event of release?.publicChangeEvents ?? []) {
    if (event.type !== 'new_arrival' || !current.has(event.vin)) continue
    const firstArrivalDate = earliestDay(event.reportDate, release.reportDate, current.get(event.vin))
    if (!firstArrivalDate) continue
    arrivals.set(event.vin, { vin: event.vin, first_arrival_date: firstArrivalDate, observed_at: observedAt })
  }
  return [...arrivals.values()]
}
