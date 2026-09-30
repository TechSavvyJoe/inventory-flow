// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScanVehicleDialog } from './ScanVehicleDialog'
import type { InventoryVehicle } from './types'

const engine = vi.hoisted(() => ({ scanVideo: vi.fn(), readTag: vi.fn(), photoCanvas: vi.fn() }))
const live = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./vehicle-scan-engine', () => engine)
vi.mock('./vehicle-scan-live', () => ({ scanStockVideo: live.start }))

const vehicle: InventoryVehicle = {
  id: 'synthetic-one', vin: 'TESTDATASCAN00001', stockNumber: 'DEMO-H01', year: 2024,
  make: 'Ford', model: 'Synthetic truck', price: 32000, mileage: 12000,
  publicListing: { dataState: 'current', isListed: true },
  dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
  dealerMail: { dataState: 'current', hasActiveHold: false, position: null },
  location: { homeStore: { id: 'howell', name: 'Howell' } },
}
const other: InventoryVehicle = { ...vehicle, id: 'synthetic-two', vin: 'TESTDATASCAN00002', location: { homeStore: { id: 'fowlerville', name: 'Fowlerville' } } }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function setup(vehicles = [vehicle]) {
  const onFind = vi.fn()
  const onClose = vi.fn(() => view.unmount())
  const view = render(<ScanVehicleDialog vehicles={vehicles} onFind={onFind} onClose={onClose} returnFocusRef={{ current: null }} />)
  return { ...view, onFind, onClose }
}
let getUserMedia: ReturnType<typeof vi.fn>
let stopTrack: ReturnType<typeof vi.fn>
let stopScanner: ReturnType<typeof vi.fn>
let media: MediaStream
let barcode: (value: string) => void
let stockReading: (value: { text: string; barcode: boolean }) => boolean
let liveSignal: AbortSignal
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
beforeEach(() => {
  vi.clearAllMocks()
  stopTrack = vi.fn(); stopScanner = vi.fn()
  media = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
  getUserMedia = vi.fn().mockResolvedValue(media)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  engine.scanVideo.mockImplementation(async (_video, _media, callback) => { barcode = callback; return { stop: stopScanner } })
  live.start.mockImplementation((_video, _reader, callback, signal) => { stockReading = callback; liveSignal = signal; return vi.fn() })
  engine.readTag.mockReset().mockResolvedValue({ text: '', barcode: false })
  engine.photoCanvas.mockImplementation(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400
    return canvas
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers()
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('vehicle scanner local lookup and cancellation', () => {
  it('starts the camera once on opening and keeps manual entry out of the initial view', async () => {
    const view = setup()
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ audio: false, video: expect.objectContaining({ facingMode: { ideal: 'environment' } }) }))
    expect(screen.queryByRole('textbox', { name: 'VIN or stock number' })).not.toBeInTheDocument()
    await waitFor(() => expect(engine.scanVideo).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('Vehicle scanner camera')).toBeInTheDocument()
    view.rerender(<ScanVehicleDialog vehicles={[vehicle]} onFind={view.onFind} onClose={view.onClose} returnFocusRef={{ current: null }} />)
    expect(getUserMedia).toHaveBeenCalledOnce()
  })

  it('requires a deliberate Find action after choosing manual entry', async () => {
    const { onFind } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Enter number' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'VIN or stock number' }), { target: { value: 'DEMO-H01' } })
    expect(onFind).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show DEMO-H01 in inventory' }))
    expect(onFind).toHaveBeenCalledExactlyOnceWith(vehicle)
    await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce())
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(engine.scanVideo).not.toHaveBeenCalled()
  })

  it('cancels a pending camera when manual entry is selected and stops its late stream', async () => {
    const pending = deferred<MediaStream>()
    getUserMedia.mockReturnValue(pending.promise)
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Enter number' }))
    expect(screen.getByRole('textbox', { name: 'VIN or stock number' })).toBeEnabled()
    await act(async () => { pending.resolve(media); await pending.promise })
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(engine.scanVideo).not.toHaveBeenCalled()
  })

  it('stops a live camera and decoder before switching to manual entry', async () => {
    setup()
    await waitFor(() => expect(engine.scanVideo).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Enter number' }))
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(stopScanner).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Vehicle scanner camera')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'VIN or stock number' })).toBeEnabled()
  })

  it('keeps manual and photo fallback usable after camera permission denial', async () => {
    getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    const { onFind } = setup()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Camera permission was not granted'))
    expect(screen.getByLabelText('Choose or take a tag photo')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'VIN or stock number' }), { target: { value: vehicle.stockNumber } })
    fireEvent.click(screen.getByRole('button', { name: 'Show DEMO-H01 in inventory' }))
    expect(onFind).toHaveBeenCalledExactlyOnceWith(vehicle)
    expect(engine.scanVideo).not.toHaveBeenCalled()
  })

  it('stops a camera stream which arrives after the dialog closes', async () => {
    const pending = deferred<MediaStream>()
    getUserMedia.mockReturnValue(pending.promise)
    const { onFind, onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle scanner' }))
    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(media); await pending.promise })
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(engine.scanVideo).not.toHaveBeenCalled()
    expect(onFind).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores OCR progress and a matching barcode result delivered after cancel', async () => {
    const pending = deferred<{ text: string; barcode: boolean }>()
    let progress!: (message: string) => void
    let signal!: AbortSignal
    engine.readTag.mockImplementation((_canvas, callback, abortSignal) => { progress = callback; signal = abortSignal; return pending.promise })
    const { onFind } = setup()
    await waitFor(() => expect(engine.scanVideo).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('Choose or take a tag photo'), { target: { files: [new File(['synthetic'], 'tag.png', { type: 'image/png' })] } })
    await waitFor(() => expect(engine.readTag).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reading' }))
    expect(signal.aborted).toBe(true)
    await act(async () => { progress('Late OCR progress'); pending.resolve({ text: vehicle.vin, barcode: true }); await pending.promise })
    expect(onFind).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Stopped. Enter the number or try again.')
    fireEvent.click(screen.getByRole('button', { name: 'Enter number' }))
    expect(screen.getByRole('textbox', { name: 'VIN or stock number' })).toHaveValue('')
  })

  it('reads an uploaded tag immediately and requires confirmation of a stock text match', async () => {
    engine.readTag.mockResolvedValue({ text: vehicle.stockNumber, barcode: false })
    const { onFind } = setup()
    await waitFor(() => expect(engine.scanVideo).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('Choose or take a tag photo'), { target: { files: [new File(['synthetic'], 'tag.png', { type: 'image/png' })] } })
    await waitFor(() => expect(engine.readTag).toHaveBeenCalledOnce())
    expect(await screen.findByRole('button', { name: 'Show DEMO-H01 in inventory' })).toBeEnabled()
    expect(onFind).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'VIN or stock number' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit reading' }))
    expect(screen.getByRole('textbox', { name: 'VIN or stock number' })).toHaveValue(vehicle.stockNumber)
    fireEvent.click(screen.getByRole('button', { name: 'Show DEMO-H01 in inventory' }))
    expect(onFind).toHaveBeenCalledExactlyOnceWith(vehicle)
  })

  it('preserves OCR line boundaries while correcting a stock reading', async () => {
    engine.readTag.mockResolvedValue({ text: 'STOCK\nDEMO-H09\n2024 FORD', barcode: false })
    const { onFind } = setup()
    await waitFor(() => expect(engine.scanVideo).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('Choose or take a tag photo'), { target: { files: [new File(['synthetic'], 'tag.png', { type: 'image/png' })] } })
    const reading = await screen.findByRole('textbox', { name: 'VIN or stock number' })
    expect(reading).toHaveValue('STOCK\nDEMO-H09\n2024 FORD')
    fireEvent.change(reading, { target: { value: 'STOCK\nDEMO-H01\n2024 FORD' } })
    expect(onFind).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show DEMO-H01 in inventory' }))
    expect(onFind).toHaveBeenCalledExactlyOnceWith(vehicle)
  })

  it('reads a captured photo immediately without a second Read photo action', async () => {
    engine.readTag.mockResolvedValue({ text: vehicle.stockNumber, barcode: false })
    const { onFind } = setup()
    await waitFor(() => expect(engine.scanVideo).toHaveBeenCalledOnce())
    const video = screen.getByLabelText('Vehicle scanner camera')
    Object.defineProperties(video, { videoWidth: { value: 800 }, videoHeight: { value: 400 } })
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    await waitFor(() => expect(engine.readTag).toHaveBeenCalledOnce())
    expect(await screen.findByRole('button', { name: 'Show DEMO-H01 in inventory' })).toBeEnabled()
    expect(onFind).not.toHaveBeenCalled()
    expect(screen.getByText('Adjust photo crop').closest('details')).not.toHaveAttribute('open')
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it('automatically reads a live stock tag and stops the camera for confirmation', async () => {
    const { onFind } = setup()
    await waitFor(() => expect(live.start).toHaveBeenCalledOnce())
    let accepted: boolean | undefined
    act(() => { accepted = stockReading({ text: vehicle.stockNumber, barcode: false }) })
    expect(accepted).toBe(true)
    expect(onFind).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Show DEMO-H01 in inventory' })).toBeEnabled()
    expect(screen.queryByLabelText('Vehicle scanner camera')).not.toBeInTheDocument()
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(stopScanner).toHaveBeenCalledOnce()
    expect(liveSignal.aborted).toBe(true)
  })

  it('keeps scanning an unrecognized live frame without switching into manual entry', async () => {
    const { onFind } = setup()
    await waitFor(() => expect(live.start).toHaveBeenCalledOnce())
    expect(stockReading({ text: 'SYNTHETIC-NO-MATCH', barcode: false })).toBe(false)
    expect(screen.getByLabelText('Vehicle scanner camera')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'VIN or stock number' })).not.toBeInTheDocument()
    expect(stopTrack).not.toHaveBeenCalled()
    expect(onFind).not.toHaveBeenCalled()
  })

  it('ignores unrelated live barcodes and keeps both readers available for the next vehicle', async () => {
    const { onFind } = setup()
    await waitFor(() => expect(live.start).toHaveBeenCalledOnce())
    act(() => {
      barcode('https://example.invalid/synthetic-unrelated-qr')
      barcode('TESTDATAUNKNOWN01')
    })
    expect(stopTrack).not.toHaveBeenCalled()
    expect(stopScanner).not.toHaveBeenCalled()
    expect(liveSignal.aborted).toBe(false)
    expect(screen.getByLabelText('Vehicle scanner camera')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'VIN or stock number' })).not.toBeInTheDocument()
    expect(onFind).not.toHaveBeenCalled()
    act(() => barcode(vehicle.vin))
    expect(onFind).toHaveBeenCalledExactlyOnceWith(vehicle)
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(stopScanner).toHaveBeenCalledOnce()
    expect(liveSignal.aborted).toBe(true)
  })

  it('keeps an unmatched photo reading editable instead of silently discarding it', async () => {
    engine.readTag.mockResolvedValue({ text: 'TESTDATAUNKNOWN01', barcode: true })
    const { onFind } = setup()
    await waitFor(() => expect(engine.scanVideo).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('Choose or take a tag photo'), { target: { files: [new File(['synthetic'], 'tag.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('textbox', { name: 'VIN or stock number' })).toHaveValue('TESTDATAUNKNOWN01')
    expect(screen.getByRole('status')).toHaveTextContent('No exact vehicle found')
    expect(onFind).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'VIN or stock number' }), { target: { value: vehicle.stockNumber } })
    fireEvent.click(screen.getByRole('button', { name: 'Show DEMO-H01 in inventory' }))
    expect(onFind).toHaveBeenCalledExactlyOnceWith(vehicle)
  })

  it('rejects a live OCR callback delivered after a unique barcode has already found the vehicle', async () => {
    const { onFind } = setup([vehicle, { ...other, stockNumber: 'DEMO-F02' }])
    await waitFor(() => expect(live.start).toHaveBeenCalledOnce())
    act(() => barcode(vehicle.vin))
    expect(liveSignal.aborted).toBe(true)
    let accepted: boolean | undefined
    act(() => { accepted = stockReading({ text: 'DEMO-F02', barcode: false }) })
    expect(accepted).toBe(false)
    expect(onFind).toHaveBeenCalledExactlyOnceWith(vehicle)
    expect(screen.queryByRole('button', { name: 'Show DEMO-F02 in inventory' })).not.toBeInTheDocument()
  })

  it('rejects a matching live OCR callback delivered after the dialog closes', async () => {
    const { onFind } = setup()
    await waitFor(() => expect(live.start).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle scanner' }))
    expect(liveSignal.aborted).toBe(true)
    expect(stockReading({ text: vehicle.stockNumber, barcode: false })).toBe(false)
    expect(onFind).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('checks a live stock reading against the latest authorized inventory', async () => {
    const retained = { ...other, stockNumber: 'DEMO-F02' }
    const view = setup([vehicle, retained])
    await waitFor(() => expect(live.start).toHaveBeenCalledOnce())
    view.rerender(<ScanVehicleDialog vehicles={[retained]} onFind={view.onFind} onClose={view.onClose} returnFocusRef={{ current: null }} />)
    expect(stockReading({ text: vehicle.stockNumber, barcode: false })).toBe(false)
    expect(view.onFind).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Show DEMO-H01 in inventory' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Vehicle scanner camera')).toBeInTheDocument()
  })

  it('ignores a barcode for a vehicle removed from the authorized inventory while scanning', async () => {
    const retained = { ...other, stockNumber: 'DEMO-F02' }
    const view = setup([vehicle, retained])
    await waitFor(() => expect(live.start).toHaveBeenCalledOnce())
    view.rerender(<ScanVehicleDialog vehicles={[retained]} onFind={view.onFind} onClose={view.onClose} returnFocusRef={{ current: null }} />)
    act(() => barcode(vehicle.vin))
    expect(view.onFind).not.toHaveBeenCalled()
    expect(stopTrack).not.toHaveBeenCalled()
    expect(stopScanner).not.toHaveBeenCalled()
    expect(liveSignal.aborted).toBe(false)
    act(() => barcode(retained.vin))
    expect(view.onFind).toHaveBeenCalledExactlyOnceWith(retained)
  })

  it('selects an exact unique barcode and stops scanner resources', async () => {
    const { onFind } = setup()
    await waitFor(() => expect(engine.scanVideo).toHaveBeenCalledOnce())
    act(() => barcode(vehicle.vin))
    expect(onFind).toHaveBeenCalledExactlyOnceWith(vehicle)
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(stopScanner).toHaveBeenCalledOnce()
  })

  it('requires a choice when a stock barcode matches two authorized stores', async () => {
    const { onFind } = setup([vehicle, other])
    await waitFor(() => expect(engine.scanVideo).toHaveBeenCalledOnce())
    act(() => barcode(vehicle.stockNumber))
    expect(onFind).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'Show DEMO-H01 in inventory' })).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('Check the stock and vehicle below')
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(stopScanner).toHaveBeenCalledOnce()
    fireEvent.click(screen.getAllByRole('button', { name: 'Show DEMO-H01 in inventory' })[1])
    expect(onFind).toHaveBeenCalledExactlyOnceWith(other)
  })
})
