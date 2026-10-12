import type { IScannerControls } from '@zxing/browser'

export async function scanVideo(video: HTMLVideoElement, stream: MediaStream, found: (text: string) => void): Promise<IScannerControls> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39, BarcodeFormat.CODE_128, BarcodeFormat.PDF_417, BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]]])
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 350 })
  return reader.decodeFromStream(stream, video, result => { if (result) found(result.getText()) })
}

export async function photoCanvas(file: File): Promise<HTMLCanvasElement> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a photo smaller than 25 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally { bitmap.close() }
}

export async function readTag(canvas: HTMLCanvasElement, progress: (label: string) => void, signal: AbortSignal): Promise<{ text: string; barcode: boolean }> {
  const reader = createTagReader(signal)
  try { return await reader.readTag(canvas, progress, signal) }
  finally { reader.stop() }
}

interface OcrJob {
  action: string
  jobId: string
  resolve: (data: unknown) => void
  reject: (error: unknown) => void
}

// This key describes only the pinned model bytes, never a photo or identifier.
// Change it whenever the engine or packaged traineddata changes.
const MODEL_CACHE = 'inventory-flow-tesseract-7.0.0-eng-1.0.0-best-int'

/**
 * Lazy, session-owned protocol adapter pinned to tesseract.js 7.0.0.
 * Owning the Worker before initialization makes every load stage cancelable.
 * Sequential camera frames share initialization; no worker outlives its owner
 * or 30 seconds without a reading. Package upgrades require browser OCR QA.
 */
export function createTagReader(lifetime: AbortSignal) {
  let worker: Worker | undefined
  const workerId = crypto.randomUUID()
  let pending: OcrJob | null = null
  let nextJob = 0
  let stopped = false
  let stopReason: unknown
  let initialized = false
  let active = false
  let report: ((label: string) => void) | undefined
  let rejectReading: ((error: unknown) => void) | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let idle: ReturnType<typeof setTimeout> | undefined

  function releaseWorker() {
    if (!worker) return
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
    worker.terminate(); worker = undefined; initialized = false
  }
  function stop(error: unknown = new DOMException('Scan ended.', 'AbortError')) {
    if (stopped) return
    stopped = true
    stopReason = error
    clearTimeout(deadline); clearTimeout(idle)
    lifetime.removeEventListener('abort', cancelOwner)
    releaseWorker()
    const job = pending; pending = null
    job?.reject(error)
    rejectReading?.(error)
    report = undefined
  }
  function cancelOwner() { stop(lifetime.reason ?? new DOMException('Scan canceled.', 'AbortError')) }
  function assertActive(signal: AbortSignal) {
    if (stopped) throw stopReason
    lifetime.throwIfAborted(); signal.throwIfAborted()
  }
  function request(action: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    assertActive(signal)
    return new Promise((resolve, reject) => {
      const jobId = `scan-${++nextJob}`
      pending = { action, jobId, resolve, reject }
      try { worker!.postMessage({ workerId, jobId, action, payload }) }
      catch (error) { stop(error) }
    })
  }
  function startWorker() {
    const owned = new Worker('/scanner-assets/worker.min.js')
    worker = owned
    owned.onmessage = event => {
      if (stopped || worker !== owned) return
      const message = event.data
      if (!message || message.workerId !== workerId || message.jobId !== pending?.jobId || message.action !== pending?.action) return
      if (message.status === 'resolve') {
        const job = pending!; pending = null
        job.resolve(message.data)
      } else if (message.status === 'reject') {
        stop(new Error(message.action === 'recognize'
          ? 'The text reader could not read this photo. Try another photo or enter a stock number or VIN.'
          : 'The text reader could not load. Try again or enter a stock number or VIN.'))
      } else if (message.status === 'progress' && message.data?.status === 'recognizing text' && Number.isFinite(message.data.progress)) {
        try { report?.(`Reading tag… ${Math.round(Math.min(1, Math.max(0, message.data.progress)) * 100)}%`) }
        catch (error) { stop(error) }
      }
    }
    owned.onerror = event => {
      if (stopped || worker !== owned) return
      event.preventDefault()
      stop(new Error('The text reader could not start. Try again or enter a stock number or VIN.'))
    }
    owned.onmessageerror = () => {
      if (!stopped && worker === owned) stop(new Error('The text reader returned an unreadable result. Try another photo.'))
    }
  }
  async function recognize(canvas: HTMLCanvasElement, progress: (label: string) => void, signal: AbortSignal): Promise<string> {
    assertActive(signal)
    if (active) throw new Error('A tag reading is already in progress.')
    active = true; report = progress
    clearTimeout(idle)
    const canceled = new Promise<never>((_resolve, reject) => { rejectReading = reject })
    const cancel = () => stop(signal.reason ?? new DOMException('Scan canceled.', 'AbortError'))
    signal.addEventListener('abort', cancel, { once: true })
    deadline = setTimeout(() => stop(new Error('Text recognition took too long. Try another photo or enter a stock number or VIN.')), 90_000)
    try {
      return await Promise.race([canceled, (async () => {
        if (!worker) startWorker()
        if (!initialized) {
          progress('Loading text reader…')
          const assetPath = new URL('/scanner-assets/', location.origin).href
          await request('load', { options: { lstmOnly: true, corePath: assetPath, logging: false } }, signal)
          await request('loadLanguage', { langs: 'eng', options: { langPath: assetPath, cachePath: MODEL_CACHE, cacheMethod: 'write', gzip: true, lstmOnly: true } }, signal)
          await request('initialize', { langs: 'eng', oem: 1, config: {} }, signal)
          await request('setParameters', { params: { tessedit_pageseg_mode: '11', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789- ', preserve_interword_spaces: '1' } }, signal)
          initialized = true
        }
        assertActive(signal)
        progress('Reading tag…')
        assertActive(signal)
        // Canvas bytes stay in this worker's memory. The image loader never
        // receives a URL, and traineddata caching never stores these pixels.
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(value => value ? resolve(value) : reject(new Error('This photo could not be read. Try another photo.')), 'image/png')
        })
        assertActive(signal)
        const image = new Uint8Array(await blob.arrayBuffer())
        assertActive(signal)
        const data = await request('recognize', { image, options: {}, output: { text: true } }, signal)
        assertActive(signal)
        if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string') throw new Error('The text reader returned an unreadable result. Try another photo.')
        return data.text.trim()
      })()])
    } catch (error) { stop(error); throw error }
    finally {
      clearTimeout(deadline)
      signal.removeEventListener('abort', cancel)
      active = false; report = undefined; rejectReading = undefined
      if (!stopped) idle = setTimeout(releaseWorker, 30_000)
    }
  }
  async function read(canvas: HTMLCanvasElement, progress: (label: string) => void, signal: AbortSignal) {
    assertActive(signal)
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    assertActive(signal)
    try {
      const result = new BrowserMultiFormatReader().decodeFromCanvas(canvas)
      return { text: result.getText(), barcode: true }
    } catch { /* A tag without a barcode goes through local text recognition. */ }
    return { text: await recognize(canvas, progress, signal), barcode: false }
  }
  lifetime.addEventListener('abort', cancelOwner, { once: true })
  if (lifetime.aborted) cancelOwner()
  return { readTag: read, stop }
}
