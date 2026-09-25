import { createHash } from 'node:crypto'
import { WorkflowError } from './workflow.mjs'

export const ISSUE_PHOTO_BYTES = 500 * 1024
export const ISSUE_BODY_BYTES = 2100 * 1024
const MAX_DIMENSION = 1600
const fail = (message) => { throw new WorkflowError(message, { code: 'INVALID_ISSUE_PHOTO' }) }

// Browser uploads are re-encoded photographs. Also remove every metadata and
// comment segment at the trust boundary: EXIF/GPS must not survive a custom
// client. Do not accept SVG, arbitrary URLs, trailing payloads or huge rasters.
export function sanitizeIssueJpeg(input) {
  const source = Buffer.from(input)
  if (source.length > ISSUE_PHOTO_BYTES) fail('Each photo must be 500 KB or smaller.')
  if (source.length < 20 || source[0] !== 0xff || source[1] !== 0xd8) fail('Photos must be JPEG images.')
  const chunks = [source.subarray(0, 2)]
  let offset = 2, hasFrame = false, hasScan = false, progressive = false
  const frameComponents = new Set()
  while (offset < source.length) {
    const start = offset
    if (source[offset++] !== 0xff) fail('The photo is not a valid JPEG.')
    while (source[offset] === 0xff) offset++
    const marker = source[offset++]
    if (marker === 0xd9) {
      if (!hasFrame || !hasScan || offset !== source.length) fail('The photo is incomplete or contains unexpected data.')
      chunks.push(source.subarray(start, offset))
      return Buffer.concat(chunks)
    }
    if (![0xc0, 0xc2, 0xc4, 0xdb, 0xdd, 0xda, 0xfe].includes(marker) && !(marker >= 0xe0 && marker <= 0xef)) fail('The photo uses an unsupported JPEG format.')
    if (offset + 2 > source.length) fail('The photo is incomplete.')
    const length = source.readUInt16BE(offset)
    if (length < 2 || offset + length > source.length) fail('The photo is incomplete.')
    if (marker === 0xc0 || marker === 0xc2) {
      if (hasFrame || length < 11) fail('The photo has an invalid frame.')
      const height = source.readUInt16BE(offset + 3), width = source.readUInt16BE(offset + 5)
      const components = source[offset + 7]
      if (source[offset + 2] !== 8 || ![1, 3].includes(components) || length !== 8 + 3 * components || !width || !height || Math.max(width, height) > MAX_DIMENSION) fail('Photos must be at most 1600 pixels on either side.')
      for (let index = 0; index < components; index++) {
        const position = offset + 8 + index * 3
        const id = source[position], sampling = source[position + 1]
        if (frameComponents.has(id) || !(sampling >> 4) || !(sampling & 15) || (sampling >> 4) > 4 || (sampling & 15) > 4 || source[position + 2] > 3) fail('The photo has an invalid frame.')
        frameComponents.add(id)
      }
      progressive = marker === 0xc2
      hasFrame = true
    }
    if (marker === 0xda) {
      const components = source[offset + 2]
      if (!hasFrame || !components || components > frameComponents.size || length !== 6 + 2 * components) fail('The photo has an invalid scan.')
      const scanComponents = new Set()
      for (let index = 0; index < components; index++) {
        const id = source[offset + 3 + index * 2], tables = source[offset + 4 + index * 2]
        if (!frameComponents.has(id) || scanComponents.has(id) || (tables >> 4) > 3 || (tables & 15) > 3) fail('The photo has an invalid scan.')
        scanComponents.add(id)
      }
      const spectralStart = source[offset + length - 3], spectralEnd = source[offset + length - 2]
      const approximation = source[offset + length - 1], high = approximation >> 4, low = approximation & 15
      if ((!progressive && (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0)) ||
          (progressive && (spectralStart > spectralEnd || spectralEnd > 63 || (spectralStart === 0 && spectralEnd !== 0) || (spectralStart > 0 && components !== 1) || low > 13 || high > 13 || (high !== 0 && high !== low + 1)))) fail('The photo has an invalid scan.')
    }
    offset += length
    if (marker === 0xda) {
      hasScan = true
      const entropyStart = offset
      // Stuffed FF bytes and restart markers belong to the entropy stream.
      while (offset < source.length) {
        if (source[offset] !== 0xff) { offset++; continue }
        const next = source[offset + 1]
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue }
        break
      }
      if (offset === entropyStart) fail('The photo has an empty scan.')
    }
    if (marker !== 0xfe && !(marker >= 0xe0 && marker <= 0xef)) chunks.push(source.subarray(start, offset))
  }
  fail('The photo is incomplete.')
}

export function prepareIssuePhotos(input) {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > 3) fail('Attach up to three photos per update.')
  const photos = input.map(photo => {
    const data = photo?.data
    if (typeof data !== 'string' || data.length > Math.ceil(ISSUE_PHOTO_BYTES / 3) * 4 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) fail('The photo could not be read. Choose it again.')
    const decoded = Buffer.from(data, 'base64')
    if (decoded.toString('base64') !== data) fail('The photo could not be read. Choose it again.')
    const bytes = sanitizeIssueJpeg(decoded)
    const id = createHash('sha256').update(bytes).digest('hex')
    return { metadata: { id, contentType: 'image/jpeg', bytes: bytes.length }, bytes }
  })
  if (new Set(photos.map(photo => photo.metadata.id)).size !== photos.length) fail('The same photo was attached more than once.')
  return photos
}
