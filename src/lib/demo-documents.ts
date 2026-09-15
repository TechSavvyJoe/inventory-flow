/** Demo resources are separate from official-document URL validation. */
const DEMO_PHOTOS: Record<string, string> = {
  TESTDATAHWELL0001: 'f150', TESTDATAHWELL0002: 'bronco-sport',
  TESTDATAFWELL0001: 'escape', TESTDATAFWELL0002: 'maverick',
  TESTDATADETRT0001: 'explorer', TESTDATADETRT0002: 'silverado',
  TESTDATALNCN00001: 'nautilus', TESTDATALNCN00002: 'corsair',
}

export function getDemoWindowSticker(vehicle: { vin: string; imageUrl?: string | null; imageUrls?: string[] | null }) {
  const photo = DEMO_PHOTOS[vehicle.vin]
  if (!photo || ![vehicle.imageUrl, ...(vehicle.imageUrls ?? [])].includes(`/demo-vehicles/${photo}.png`)) return null
  return {
    url: `/demo-documents/window-sticker.html?vehicle=${encodeURIComponent(vehicle.vin)}`,
    previewUrl: vehicle.vin === 'TESTDATAHWELL0001' ? '/demo-documents/window-sticker-preview.png' : undefined,
    label: 'Demo window sticker' as const,
  }
}
