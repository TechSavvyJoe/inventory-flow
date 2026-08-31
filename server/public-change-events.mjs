const CHANGE_DEFINITIONS = Object.freeze([
  {
    type: 'price_change',
    field: 'Listed price',
    key: 'listed_price',
    valueType: 'money',
  },
  {
    type: 'mileage_change',
    field: 'Mileage',
    key: 'mileage',
    valueType: 'mileage',
  },
  {
    type: 'website_status_change',
    field: 'Website Status',
    key: 'availability',
    valueType: 'text',
  },
  {
    type: 'stock_correction',
    field: 'Stock number',
    key: 'stock_number',
    valueType: 'text',
  },
  {
    type: 'store_transfer',
    field: 'Source physical store',
    key: 'store',
    valueType: 'store',
  },
])

function cleanText(value) {
  const text = String(value ?? '').trim()
  return text || null
}

function comparableValue(value, valueType) {
  if (value === null || value === undefined || value === '') return null
  if (valueType === 'money' || valueType === 'mileage') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return cleanText(value)
}

function vehicleIdentity(vehicle, fallbackVin) {
  return {
    vin: cleanText(vehicle?.vin) || fallbackVin,
    stockNumber: cleanText(vehicle?.stock_number) || '',
    vehicleName:
      cleanText(vehicle?.vehicle_name) ||
      [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim]
        .map(cleanText)
        .filter(Boolean)
        .join(' '),
    store: cleanText(vehicle?.store) || '',
    listingUrl: cleanText(vehicle?.listing_url),
  }
}

function eventId(reportDate, type, vin) {
  return `${reportDate}:${type}:${vin}`
}

function changeEvent({
  type,
  field,
  valueType,
  reportDate,
  previousReportDate,
  vehicle,
  fallbackVin,
  beforeValue,
  afterValue,
  currentVehicle,
}) {
  return {
    id: eventId(reportDate, type, fallbackVin),
    type,
    field,
    valueType,
    reportDate,
    previousReportDate,
    ...vehicleIdentity(vehicle, fallbackVin),
    beforeValue,
    afterValue,
    currentVehicle,
  }
}

/**
 * Compare two already-validated complete public inventory snapshots.
 * A source-store change stays one change event for the VIN; it is never emitted
 * as a removal plus an arrival.
 */
export function buildPublicChangeEvents({ previousSnapshot, currentSnapshot }) {
  const previousVehicles = previousSnapshot?.vehicles ?? {}
  const currentVehicles = currentSnapshot?.vehicles ?? {}
  const reportDate = cleanText(currentSnapshot?.report_date) || ''
  const previousReportDate = cleanText(previousSnapshot?.report_date) || ''
  const events = []

  for (const [vin, current] of Object.entries(currentVehicles)) {
    const previous = previousVehicles[vin]
    if (!previous) {
      events.push(
        changeEvent({
          type: 'new_arrival',
          field: 'Public listing',
          valueType: 'state',
          reportDate,
          previousReportDate,
          vehicle: current,
          fallbackVin: vin,
          beforeValue: 'Not in prior public release',
          afterValue: 'Listed in current public release',
          currentVehicle: true,
        }),
      )
      continue
    }

    for (const definition of CHANGE_DEFINITIONS) {
      const beforeValue = comparableValue(previous[definition.key], definition.valueType)
      const afterValue = comparableValue(current[definition.key], definition.valueType)
      if (beforeValue === afterValue) continue
      events.push(
        changeEvent({
          ...definition,
          reportDate,
          previousReportDate,
          vehicle: current,
          fallbackVin: vin,
          beforeValue,
          afterValue,
          currentVehicle: true,
        }),
      )
    }
  }

  for (const [vin, previous] of Object.entries(previousVehicles)) {
    if (currentVehicles[vin]) continue
    events.push(
      changeEvent({
        type: 'removed',
        field: 'Public listing',
        valueType: 'state',
        reportDate,
        previousReportDate,
        vehicle: previous,
        fallbackVin: vin,
        beforeValue: 'Listed in prior public release',
        afterValue: 'Not in current public release',
        currentVehicle: false,
      }),
    )
  }

  return events.sort(
    (left, right) =>
      left.type.localeCompare(right.type) ||
      left.store.localeCompare(right.store) ||
      left.stockNumber.localeCompare(right.stockNumber, undefined, { numeric: true }) ||
      left.vin.localeCompare(right.vin),
  )
}

export function summarizePublicChangeEvents(events) {
  const counts = {
    new_arrival: 0,
    removed: 0,
    price_change: 0,
    mileage_change: 0,
    website_status_change: 0,
    stock_correction: 0,
    store_transfer: 0,
  }
  for (const event of events ?? []) {
    if (Object.prototype.hasOwnProperty.call(counts, event.type)) counts[event.type] += 1
  }
  return counts
}

