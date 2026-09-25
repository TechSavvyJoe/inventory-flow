export interface IssuePhotoUpload { data: string }

/** Resize and re-encode in memory; original camera metadata is not uploaded. */
export async function prepareIssuePhoto(file: File): Promise<IssuePhotoUpload> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new Error('Choose a photo from your camera or library.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode().catch(() => { throw new Error('This photo could not be opened. Try a JPEG or take a new photo.') })
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Photo preparation is unavailable in this browser.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.82, 0.65, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', quality).split(',')[1]
      if (data && data.length <= Math.floor(500 * 1024 / 3) * 4) return { data }
    }
    throw new Error('This photo is too detailed to upload. Crop it or choose a smaller photo.')
  } finally { URL.revokeObjectURL(url) }
}
