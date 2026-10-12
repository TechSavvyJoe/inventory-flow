// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTagReader, readTag } from './vehicle-scan-engine'

const { decodeFromCanvas } = vi.hoisted(() => ({ decodeFromCanvas: vi.fn() }))
vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: class { decodeFromCanvas = decodeFromCanvas } }))

interface Packet {
  workerId: string
  jobId: string
  action: string
  payload: Record<string, unknown>
}
class OwnedWorker {
  static instances: OwnedWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  messages: Packet[] = []
  terminate = vi.fn()
  postMessage = vi.fn((packet: Packet) => { this.messages.push(packet) })
  constructor(readonly url: string) { OwnedWorker.instances.push(this) }
  reply(status: string, data: unknown = {}, packet = this.messages.at(-1)!) {
    this.onmessage?.({ data: { ...packet, status, data } } as MessageEvent)
  }
}
const controllers: AbortController[] = []

beforeEach(() => {
  OwnedWorker.instances = []
  decodeFromCanvas.mockReset().mockImplementation(() => { throw new Error('Synthetic image has no barcode') })
  vi.stubGlobal('Worker', OwnedWorker)
})
afterEach(() => { for (const controller of controllers.splice(0)) controller.abort(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function start(read = readTag) {
  const controller = new AbortController()
  controllers.push(controller)
  const progress = vi.fn()
  const bytes = new Uint8Array([137, 80, 78, 71])
  const arrayBuffer = vi.fn(async () => bytes.buffer)
  const canvas = { toBlob: vi.fn((callback: BlobCallback) => callback({ arrayBuffer } as unknown as Blob)) } as unknown as HTMLCanvasElement
  const promise = read(canvas, progress, controller.signal)
  // Observe rejections immediately, including aborts during initialization.
  const outcome = promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
  await vi.dynamicImportSettled()
  return { controller, progress, canvas, arrayBuffer, outcome, worker: OwnedWorker.instances.at(-1)! }
}

async function finishJob(worker: OwnedWorker, expectedAction: string) {
  expect(worker.messages.at(-1)?.action).toBe(expectedAction)
  worker.reply('resolve')
  // Each protocol step is an awaited job. Canvas encoding adds two promises.
  for (let index = 0; index < 6; index++) await Promise.resolve()
}

async function initialize(worker: OwnedWorker) {
  for (const action of ['load', 'loadLanguage', 'initialize', 'setParameters']) await finishJob(worker, action)
}

describe('owned local OCR worker lifecycle', () => {
  it('uses a barcode result without constructing an OCR worker', async () => {
    decodeFromCanvas.mockReturnValue({ getText: () => 'TESTDATAHWELL0001' })
    const scan = await start()
    expect(await scan.outcome).toEqual({ value: { text: 'TESTDATAHWELL0001', barcode: true }, error: undefined })
    expect(OwnedWorker.instances).toHaveLength(0)
    expect(scan.canvas.toBlob).not.toHaveBeenCalled()
  })

  it('does not construct a worker for an already aborted scan', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(readTag({} as HTMLCanvasElement, vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(OwnedWorker.instances).toHaveLength(0)
  })

  it.each(['load', 'loadLanguage', 'initialize', 'setParameters', 'recognize'])('terminates and rejects cancellation during %s', async action => {
    const scan = await start()
    for (const stage of ['load', 'loadLanguage', 'initialize', 'setParameters']) {
      if (stage === action) break
      await finishJob(scan.worker, stage)
    }
    expect(scan.worker.messages.at(-1)?.action).toBe(action)
    scan.controller.abort()
    expect((await scan.outcome).error).toMatchObject({ name: 'AbortError' })
    expect(scan.worker.terminate).toHaveBeenCalledTimes(1)
    expect(scan.worker.onmessage).toBeNull()
    expect(scan.worker.onerror).toBeNull()
  })

  it.each(['load', 'loadLanguage', 'initialize'])('rejects a %s asset/initialization failure and terminates immediately', async action => {
    const scan = await start()
    for (const stage of ['load', 'loadLanguage']) {
      if (stage === action) break
      await finishJob(scan.worker, stage)
    }
    scan.worker.reply('reject', 'Synthetic asset response 404')
    expect((await scan.outcome).error.message).toContain('could not load')
    expect(scan.worker.terminate).toHaveBeenCalledTimes(1)
    const count = scan.worker.messages.length
    scan.worker.reply('resolve')
    expect(scan.worker.messages).toHaveLength(count)
  })

  it('terminates on a worker script error or unreadable message', async () => {
    for (const errorKind of ['script', 'message']) {
      const scan = await start()
      if (errorKind === 'script') scan.worker.onerror?.(new ErrorEvent('error', { message: 'Synthetic script failure', cancelable: true }))
      else scan.worker.onmessageerror?.(new MessageEvent('messageerror'))
      expect((await scan.outcome).error).toBeInstanceOf(Error)
      expect(scan.worker.terminate).toHaveBeenCalledTimes(1)
    }
  })

  it('times out initialization that never answers, terminating its owned worker', async () => {
    vi.useFakeTimers()
    const scan = await start()
    await vi.advanceTimersByTimeAsync(90_000)
    expect((await scan.outcome).error.message).toContain('took too long')
    expect(scan.worker.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores queued progress and completion after cancellation', async () => {
    const scan = await start()
    const queuedCallback = scan.worker.onmessage!
    const packet = scan.worker.messages[0]
    scan.controller.abort()
    await scan.outcome
    const previous = scan.progress.mock.calls.length
    queuedCallback({ data: { ...packet, status: 'progress', data: { status: 'recognizing text', progress: 1 } } } as MessageEvent)
    queuedCallback({ data: { ...packet, status: 'resolve', data: { text: 'STALE-RESULT' } } } as MessageEvent)
    expect(scan.progress).toHaveBeenCalledTimes(previous)
    expect(scan.worker.messages).toHaveLength(1)
    expect(scan.worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('runs the pinned protocol using local assets and canvas bytes, then terminates on success', async () => {
    const scan = await start()
    expect(scan.worker.url).toBe('/scanner-assets/worker.min.js')
    await initialize(scan.worker)
    expect(scan.worker.messages.map(packet => packet.action)).toEqual(['load', 'loadLanguage', 'initialize', 'setParameters', 'recognize'])
    const assetPath = new URL('/scanner-assets/', location.origin).href
    expect(scan.worker.messages[0].payload).toEqual({ options: { lstmOnly: true, corePath: assetPath, logging: false } })
    expect(scan.worker.messages[1].payload).toEqual({ langs: 'eng', options: { langPath: assetPath, cachePath: 'inventory-flow-tesseract-7.0.0-eng-1.0.0-best-int', cacheMethod: 'write', gzip: true, lstmOnly: true } })
    expect(scan.worker.messages[2].payload).toEqual({ langs: 'eng', oem: 1, config: {} })
    expect(scan.worker.messages[3].payload).toMatchObject({ params: { tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' } })
    expect(scan.worker.messages[4].payload).toEqual({ image: new Uint8Array([137, 80, 78, 71]), options: {}, output: { text: true } })
    expect(scan.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    scan.worker.reply('progress', { status: 'recognizing text', progress: 0.75 })
    expect(scan.progress).toHaveBeenLastCalledWith('Reading tag… 75%')
    scan.worker.reply('resolve', { text: '  STOCK H24681P\n' })
    expect(await scan.outcome).toEqual({ value: { text: 'STOCK H24681P', barcode: false }, error: undefined })
    expect(scan.worker.terminate).toHaveBeenCalledTimes(1)
    scan.controller.abort()
    expect(scan.worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('initializes once for sequential live frames and rejects a queued prior-frame event', async () => {
    const owner = new AbortController(); controllers.push(owner)
    const reader = createTagReader(owner.signal)
    const first = await start(reader.readTag)
    await initialize(first.worker)
    const firstPacket = first.worker.messages.at(-1)!
    const queued = first.worker.onmessage!
    first.worker.reply('resolve', { text: 'SYNTHETIC-NO-MATCH' })
    await first.outcome
    expect(first.worker.terminate).not.toHaveBeenCalled()
    const second = await start(reader.readTag)
    expect(OwnedWorker.instances).toHaveLength(1)
    expect(first.worker.messages.map(packet => packet.action)).toEqual(['load', 'loadLanguage', 'initialize', 'setParameters', 'recognize', 'recognize'])
    const reports = second.progress.mock.calls.length
    queued({ data: { ...firstPacket, status: 'progress', data: { status: 'recognizing text', progress: 1 } } } as MessageEvent)
    queued({ data: { ...firstPacket, status: 'resolve', data: { text: 'STALE-RESULT' } } } as MessageEvent)
    expect(second.progress).toHaveBeenCalledTimes(reports)
    first.worker.reply('resolve', { text: 'STOCK DEMO-H01' })
    expect((await second.outcome).value).toEqual({ text: 'STOCK DEMO-H01', barcode: false })
    owner.abort()
    expect(first.worker.terminate).toHaveBeenCalledTimes(1)
    reader.stop()
    expect(first.worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('releases an idle worker and lazily initializes again without keeping image jobs', async () => {
    vi.useFakeTimers()
    const owner = new AbortController(); controllers.push(owner)
    const reader = createTagReader(owner.signal)
    const first = await start(reader.readTag)
    await initialize(first.worker)
    first.worker.reply('resolve', { text: '' }); await first.outcome
    const queuedError = first.worker.onerror!
    const queuedMessageError = first.worker.onmessageerror!
    await vi.advanceTimersByTimeAsync(29_999)
    expect(first.worker.terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(first.worker.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    const second = await start(reader.readTag)
    expect(OwnedWorker.instances).toHaveLength(2)
    expect(second.worker.messages.at(-1)?.action).toBe('load')
    queuedError(new ErrorEvent('error', { cancelable: true }))
    queuedMessageError(new MessageEvent('messageerror'))
    expect(second.worker.terminate).not.toHaveBeenCalled()
    await initialize(second.worker)
    second.worker.reply('resolve', { text: 'STOCK DEMO-H01' })
    expect((await second.outcome).value?.text).toBe('STOCK DEMO-H01')
    owner.abort()
    expect(second.worker.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a session to one active OCR operation', async () => {
    const owner = new AbortController(); controllers.push(owner)
    const reader = createTagReader(owner.signal)
    const first = await start(reader.readTag)
    const overlap = await start(reader.readTag)
    expect((await overlap.outcome).error.message).toContain('already in progress')
    expect(OwnedWorker.instances).toHaveLength(1)
    expect(first.worker.messages).toHaveLength(1)
    owner.abort()
    expect((await first.outcome).error).toMatchObject({ name: 'AbortError' })
    expect(first.worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('terminates if image encoding fails or the result contains no text field', async () => {
    const failedImage = await start()
    vi.mocked(failedImage.canvas.toBlob).mockImplementation(callback => callback(null))
    await initialize(failedImage.worker)
    expect((await failedImage.outcome).error.message).toContain('photo could not be read')
    expect(failedImage.worker.terminate).toHaveBeenCalledTimes(1)
    expect(failedImage.worker.messages.some(packet => packet.action === 'recognize')).toBe(false)

    const invalidResult = await start()
    await initialize(invalidResult.worker)
    invalidResult.worker.reply('resolve', { notText: true })
    expect((await invalidResult.outcome).error.message).toContain('unreadable result')
    expect(invalidResult.worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('does not send a photo when cancellation precedes a late canvas callback', async () => {
    const scan = await start()
    let callback: BlobCallback | undefined
    vi.mocked(scan.canvas.toBlob).mockImplementation(value => { callback = value })
    await initialize(scan.worker)
    scan.controller.abort()
    expect((await scan.outcome).error).toMatchObject({ name: 'AbortError' })
    callback?.({ arrayBuffer: scan.arrayBuffer } as unknown as Blob)
    for (let index = 0; index < 6; index++) await Promise.resolve()
    expect(scan.arrayBuffer).not.toHaveBeenCalled()
    expect(scan.worker.messages.some(packet => packet.action === 'recognize')).toBe(false)
    expect(scan.worker.terminate).toHaveBeenCalledTimes(1)
  })
})
