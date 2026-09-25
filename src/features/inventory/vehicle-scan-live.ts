type Reading = { text: string; barcode: boolean }
type Reader = (canvas: HTMLCanvasElement, progress: (message: string) => void, signal: AbortSignal) => Promise<Reading>

/** Read a steady tag in the guide while the separate barcode reader stays live. */
export function scanStockVideo(video: HTMLVideoElement, read: Reader, found: (reading: Reading) => boolean, signal: AbortSignal): () => void {
  let stopped = false
  let timer: number | undefined
  let deadline: number | undefined
  let attempt: AbortController | undefined
  let previous: Uint8ClampedArray | undefined
  const sample = document.createElement('canvas')
  sample.width = 32; sample.height = 18

  function stop() {
    stopped = true
    window.clearTimeout(timer); window.clearTimeout(deadline)
    attempt?.abort()
    signal.removeEventListener('abort', stop)
  }
  function schedule(delay: number) { if (!stopped) timer = window.setTimeout(() => { void tick() }, delay) }
  async function tick() {
    if (stopped) return
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) { schedule(600); return }
    try {
      const bounds = video.getBoundingClientRect()
      const scale = bounds.width && bounds.height ? Math.max(bounds.width / video.videoWidth, bounds.height / video.videoHeight) : 1
      const visibleWidth = bounds.width ? bounds.width / scale : video.videoWidth
      const visibleHeight = bounds.height ? bounds.height / scale : video.videoHeight
      const sw = visibleWidth * 0.84, sh = visibleHeight * 0.55
      const sx = (video.videoWidth - sw) / 2, sy = (video.videoHeight - sh) / 2
      const context = sample.getContext('2d', { willReadFrequently: true })
      if (!context) { stop(); return }
      context.drawImage(video, sx, sy, sw, sh, 0, 0, sample.width, sample.height)
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data
      let difference = 0
      if (previous) for (let index = 0; index < pixels.length; index += 4) {
        difference += Math.abs(pixels[index] - previous[index]) + Math.abs(pixels[index + 1] - previous[index + 1]) + Math.abs(pixels[index + 2] - previous[index + 2])
      }
      const steady = previous && difference / (sample.width * sample.height * 3) < 12
      previous = new Uint8ClampedArray(pixels)
      if (!steady) { schedule(600); return }

      const frame = document.createElement('canvas')
      frame.width = Math.min(1440, Math.round(sw)); frame.height = Math.max(1, Math.round(frame.width * sh / sw))
      const frameContext = frame.getContext('2d')
      if (!frameContext) { stop(); return }
      frameContext.drawImage(video, sx, sy, sw, sh, 0, 0, frame.width, frame.height)
      attempt = new AbortController()
      const currentAttempt = attempt
      // Keep a cold OCR load bounded; the fast barcode reader continues throughout.
      deadline = window.setTimeout(() => currentAttempt.abort(), 15000)
      const result = await read(frame, () => {}, currentAttempt.signal)
      if (!stopped && !currentAttempt.signal.aborted && result.text && found(result)) { stop(); return }
    } catch {
      // A frame without a readable stock tag is normal. Keep the viewfinder open.
    } finally {
      window.clearTimeout(deadline)
      attempt = undefined
    }
    schedule(1500)
  }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  else schedule(600)
  return stop
}
