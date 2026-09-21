type VehiclePhotoRecord = {
  imageUrl?: string | null
  imageUrls?: readonly (string | null | undefined)[] | null
}

function compact(values: readonly (string | null | undefined)[]) {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
}

function unique(values: readonly string[]) {
  return [...new Set(values)]
}

export function vehiclePhotoFullSources(vehicle: VehiclePhotoRecord) {
  return unique(compact([...(vehicle.imageUrls ?? []), vehicle.imageUrl]))
}

export function dealerOnSizedPhoto(source: string, width: number) {
  try {
    const url = new URL(source)
    if (url.protocol !== 'https:' || !url.pathname.toLowerCase().startsWith('/inventoryphotos/')) return null
    url.searchParams.set('width', String(width))
    return url.toString()
  } catch {
    return null
  }
}

export function vehiclePhotoDisplaySources(vehicle: VehiclePhotoRecord, { width = 240 } = {}) {
  return unique(vehiclePhotoFullSources(vehicle).flatMap((source) => {
    const sized = dealerOnSizedPhoto(source, width)
    return sized && sized !== source ? [sized, source] : [source]
  }))
}
