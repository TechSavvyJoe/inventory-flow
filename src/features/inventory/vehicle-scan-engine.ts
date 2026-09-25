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
  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  signal.throwIfAborted()
  try {
    const result = new BrowserMultiFormatReader().decodeFromCanvas(canvas)
    return { text: result.getText(), barcode: true }
  } catch { /* A tag without a barcode goes through local text recognition. */ }
  progress('Loading text reader…')
  signal.throwIfAborted()
  return { text: await recognizeTagText(canvas, progress, signal), barcode: false }
}

interface OcrJob {
  action: string
  jobId: string
  resolve: (data: unknown) => void
  reject: (error: unknown) => void
}

/**
 * Protocol adapter pinned to tesseract.js 7.0.0 (createWorker/worker-script).
 * Own the actual Worker before initialization starts: its createWorker helper
 * does not expose a worker to cancel until initialization has completed.
 * Package upgrades must preserve this protocol and pass real-browser OCR QA.
 */
function recognizeTagText(canvas: HTMLCanvasElement, progress: (label: string) => void, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const workerId = crypto.randomUUID()
    const assetPath = new URL('/scanner-assets/', location.origin).href
    const worker = new Worker('/scanner-assets/worker.min.js')
    let pending: OcrJob | null = null
    let nextJob = 0
    let stopped = false
    let stopReason: unknown
    const deadline = setTimeout(() => stop(new Error('Text recognition took too long. Try another photo or enter a stock number or VIN.')), 90_000)

    function stop(error?: unknown, text = '') {
      if (stopped) return
      stopped = true
      stopReason = error
      clearTimeout(deadline)
      signal.removeEventListener('abort', cancel)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      const job = pending
      pending = null
      if (error !== undefined) { job?.reject(error); reject(error) }
      else resolve(text)
    }
    function cancel() { stop(signal.reason ?? new DOMException('Scan canceled.', 'AbortError')) }
    function assertActive() {
      if (stopped) throw stopReason ?? new DOMException('Scan ended.', 'AbortError')
      signal.throwIfAborted()
    }
    function request(action: string, payload: Record<string, unknown>): Promise<unknown> {
      assertActive()
      return new Promise((jobResolve, jobReject) => {
        const jobId = `scan-${++nextJob}`
        pending = { action, jobId, resolve: jobResolve, reject: jobReject }
        try { worker.postMessage({ workerId, jobId, action, payload }) }
        catch (error) { stop(error) }
      })
    }
    worker.onmessage = event => {
      if (stopped) return
      const message = event.data
      if (!message || message.workerId !== workerId || message.jobId !== pending?.jobId || message.action !== pending?.action) return
      if (message.status === 'resolve') {
        const job = pending!
        pending = null
        job.resolve(message.data)
      } else if (message.status === 'reject') {
        stop(new Error(message.action === 'recognize'
          ? 'The text reader could not read this photo. Try another photo or enter a stock number or VIN.'
          : 'The text reader could not load. Try again or enter a stock number or VIN.'))
      } else if (message.status === 'progress' && message.data?.status === 'recognizing text' && Number.isFinite(message.data.progress)) {
        try { progress(`Reading tag… ${Math.round(Math.min(1, Math.max(0, message.data.progress)) * 100)}%`) }
        catch (error) { stop(error) }
      }
    }
    worker.onerror = event => {
      event.preventDefault()
      stop(new Error('The text reader could not start. Try again or enter a stock number or VIN.'))
    }
    worker.onmessageerror = () => stop(new Error('The text reader returned an unreadable result. Try another photo.'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { cancel(); return }

    void (async () => {
      await request('load', { options: { lstmOnly: true, corePath: assetPath, logging: false } })
      await request('loadLanguage', { langs: 'eng', options: { langPath: assetPath, cacheMethod: 'none', gzip: true, lstmOnly: true } })
      await request('initialize', { langs: 'eng', oem: 1, config: {} })
      await request('setParameters', { params: { tessedit_pageseg_mode: '11', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789- ', preserve_interword_spaces: '1' } })
      // Canvas pixels become local PNG bytes. Never pass a URL to the OCR
      // worker (which would allow its image loader to fetch another origin).
      const blob = await new Promise<Blob>((blobResolve, blobReject) => {
        canvas.toBlob(value => value ? blobResolve(value) : blobReject(new Error('This photo could not be read. Try another photo.')), 'image/png')
      })
      assertActive()
      const image = new Uint8Array(await blob.arrayBuffer())
      assertActive()
      const data = await request('recognize', { image, options: {}, output: { text: true } })
      if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string') throw new Error('The text reader returned an unreadable result. Try another photo.')
      stop(undefined, data.text.trim())
    })().catch(error => stop(error))
  })
}
