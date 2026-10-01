import { encodeListingQr } from '../vendor/qr-encoder.mjs'

// Public listing URLs only. Encoding is local and never calls a QR service.
const cache = new Map()
export function getListingQr(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) return null
  let url
  try {
    url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
  } catch { return null }
  const target = url.href
  if (cache.has(target)) return cache.get(target)
  try {
    const encoded = encodeListingQr(target)
    const rectangles = encoded.modules.flatMap((row, y) => row.flatMap((black, x) => black ? [`<rect x="${x}" y="${y}" width="1" height="1"/>`] : []))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${encoded.size} ${encoded.size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><g fill="black">${rectangles.join('')}</g></svg>`
    const result = { ...encoded, dataUrl:`data:image/svg+xml,${encodeURIComponent(svg)}` }
    if (cache.size >= 100) cache.delete(cache.keys().next().value)
    cache.set(target, result)
    return result
  } catch { return null }
}
