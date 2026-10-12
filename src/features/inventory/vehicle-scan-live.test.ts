// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanStockVideo } from './vehicle-scan-live'

type Reading = { text: string; barcode: boolean }
const cleanups: Array<() => void> = []
let getImageData: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(32 * 18 * 4) }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData } as unknown as CanvasRenderingContext2D)
})
afterEach(() => { for (const stop of cleanups.splice(0)) stop(); vi.restoreAllMocks(); vi.useRealTimers() })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function setup(read = vi.fn<Parameters<typeof scanStockVideo>[1]>().mockResolvedValue({ text: '', barcode: false }), found = vi.fn((_reading: Reading) => false), readyState = 4) {
  const video = document.createElement('video')
  Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 }, readyState: { value: readyState, configurable: true } })
  const controller = new AbortController()
  const stop = scanStockVideo(video, read, found, controller.signal)
  cleanups.push(stop)
  return { video, read, found, controller, stop }
}

describe('automatic live stock-tag reading', () => {
  it('waits for usable video and two steady samples before reading a frame', async () => {
    const scan = setup(undefined, undefined, 1)
    await vi.advanceTimersByTimeAsync(1800)
    expect(scan.read).not.toHaveBeenCalled()
    expect(getImageData).not.toHaveBeenCalled()
    Object.defineProperty(scan.video, 'readyState', { value: 4 })
    await vi.advanceTimersByTimeAsync(600)
    expect(scan.read).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(scan.read).toHaveBeenCalledOnce()
    expect(scan.read.mock.calls[0][0]).toBeInstanceOf(HTMLCanvasElement)
  })

  it('does not read unstable frames', async () => {
    let frame = 0
    getImageData.mockImplementation(() => ({ data: new Uint8ClampedArray(32 * 18 * 4).fill(frame++ % 2 ? 255 : 0) }))
    const scan = setup()
    await vi.advanceTimersByTimeAsync(3000)
    expect(getImageData).toHaveBeenCalledTimes(5)
    expect(scan.read).not.toHaveBeenCalled()
  })

  it('does not overlap readings while the previous frame is still processing', async () => {
    const pending = deferred<Reading>()
    const scan = setup(vi.fn<Parameters<typeof scanStockVideo>[1]>().mockReturnValue(pending.promise))
    await vi.advanceTimersByTimeAsync(1200)
    expect(scan.read).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(6000)
    expect(scan.read).toHaveBeenCalledOnce()
    pending.resolve({ text: '', barcode: false })
    await vi.advanceTimersByTimeAsync(1500)
    expect(scan.read).toHaveBeenCalledTimes(2)
  })

  it('keeps scanning after an empty frame or a reading that is not an authorized match', async () => {
    const scan = setup(vi.fn<Parameters<typeof scanStockVideo>[1]>().mockResolvedValueOnce({ text: '', barcode: false }).mockResolvedValue({ text: 'SYNTHETIC-NO-MATCH', barcode: false }))
    await vi.advanceTimersByTimeAsync(1200)
    expect(scan.found).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(scan.found).toHaveBeenCalledExactlyOnceWith({ text: 'SYNTHETIC-NO-MATCH', barcode: false })
    await vi.advanceTimersByTimeAsync(1500)
    expect(scan.read).toHaveBeenCalledTimes(3)
  })

  it('stops scheduling after an accepted stock-tag reading', async () => {
    const reading = { text: 'DEMO-H01', barcode: false }
    const scan = setup(vi.fn<Parameters<typeof scanStockVideo>[1]>().mockResolvedValue(reading), vi.fn((_reading: Reading) => true))
    await vi.advanceTimersByTimeAsync(1200)
    expect(scan.found).toHaveBeenCalledExactlyOnceWith(reading)
    expect(scan.read.mock.calls[0][2].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(6000)
    expect(scan.read).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a pending frame and ignores its late matching response after cancellation', async () => {
    const pending = deferred<Reading>()
    const scan = setup(vi.fn<Parameters<typeof scanStockVideo>[1]>().mockReturnValue(pending.promise))
    await vi.advanceTimersByTimeAsync(1200)
    const signal = scan.read.mock.calls[0][2]
    scan.controller.abort()
    expect(signal.aborted).toBe(true)
    pending.resolve({ text: 'DEMO-H01', barcode: false })
    await vi.advanceTimersByTimeAsync(5000)
    expect(scan.found).not.toHaveBeenCalled()
    expect(scan.read).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows a cold reader to load longer than 15 seconds, then accepts its result', async () => {
    const pending = deferred<Reading>()
    const scan = setup(vi.fn<Parameters<typeof scanStockVideo>[1]>().mockReturnValue(pending.promise), vi.fn(() => true))
    await vi.advanceTimersByTimeAsync(1200)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(scan.read.mock.calls[0][2].aborted).toBe(false)
    pending.resolve({ text: 'DEMO-H01', barcode: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(scan.found).toHaveBeenCalledOnce()
    expect(scan.read).toHaveBeenCalledOnce()
  })

  it.each([false, true])('bounds stalled %s recognition and stops instead of restarting downloads', async recognizing => {
    const read = vi.fn<Parameters<typeof scanStockVideo>[1]>()
      .mockImplementation((_canvas, progress, signal) => new Promise((_resolve, reject) => {
        if (recognizing) progress('Reading tag…')
        signal.addEventListener('abort', () => reject(new DOMException('Synthetic frame timed out', 'AbortError')), { once: true })
      }))
    const scan = setup(read)
    await vi.advanceTimersByTimeAsync(1200)
    const signal = read.mock.calls[0][2]
    await vi.advanceTimersByTimeAsync((recognizing ? 15_000 : 90_000) - 1)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal.aborted).toBe(true)
    expect(scan.found).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(read).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports loading progress and a reader failure without surfacing worker internals', async () => {
    const video = document.createElement('video')
    Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 }, readyState: { value: 4 } })
    const progress = vi.fn()
    cleanups.push(scanStockVideo(video, async (_canvas, report) => {
      report('Loading text reader…')
      throw new Error('Synthetic private worker internals')
    }, vi.fn(), new AbortController().signal, progress))
    await vi.advanceTimersByTimeAsync(1200)
    expect(progress).toHaveBeenCalledWith('Loading text reader…')
    expect(progress).toHaveBeenLastCalledWith('Stock-tag reader paused. Scan a barcode, choose a photo, or enter the number.')
  })

  it('releases the owned reader exactly once on stop, including cancellation before any frame', () => {
    const release = vi.fn()
    const controller = new AbortController()
    const stop = scanStockVideo(document.createElement('video'), vi.fn(), vi.fn(), controller.signal, vi.fn(), release)
    controller.abort(); stop()
    expect(release).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start when already canceled', async () => {
    const video = document.createElement('video')
    const controller = new AbortController()
    controller.abort()
    const read = vi.fn()
    scanStockVideo(video, read, vi.fn(), controller.signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
