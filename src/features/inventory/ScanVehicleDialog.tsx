import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ImagePlus, Keyboard, ScanLine, X } from 'lucide-react'
import { useContainedFocus } from '../../lib/useContainedFocus'
import { matchScannedVehicles } from './vehicle-scan-match'
import { vehicleDisplayName } from './inventory-utils'
import { scanStockVideo } from './vehicle-scan-live'
import type { InventoryVehicle } from './types'
import './ScanVehicleDialog.css'

interface Props {
  vehicles: InventoryVehicle[]
  onFind: (vehicle: InventoryVehicle) => void
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}
type Crop = { x: number; y: number; width: number; height: number }
const whole: Crop = { x: 0, y: 0, width: 1, height: 1 }

export function ScanVehicleDialog({ vehicles, onFind, onClose, returnFocusRef }: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const controls = useRef<{ stop: () => void } | null>(null)
  const operation = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const currentVehicles = useRef(vehicles)
  const find = useRef(onFind)
  currentVehicles.current = vehicles
  find.current = onFind
  const [text, setText] = useState('')
  const [status, setStatus] = useState('Starting camera…')
  const [camera, setCamera] = useState(true)
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null)
  const [crop, setCrop] = useState<Crop>(whole)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const matches = useMemo(() => matchScannedVehicles(text, vehicles), [text, vehicles])
  useContainedFocus({ active: true, contain: true, containerRef: dialog, initialFocusRef: closeButton, returnFocusRef, onEscape: close })

  function close() { cancel(); onClose() }
  function stopCamera() {
    controls.current?.stop(); controls.current = null
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null
  }
  function cancel() {
    generation.current += 1
    operation.current?.abort(); operation.current = null
    stopCamera()
  }
  useEffect(() => { void startCamera(); return () => cancel() }, [])
  useEffect(() => {
    const hide = () => { if (document.hidden) { cancel(); setCamera(false); setBusy(false); setStatus('Camera paused. Scan again or enter the number.'); } }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])
  useEffect(() => {
    if (photo && preview.current) {
      preview.current.width = photo.width; preview.current.height = photo.height
      preview.current.getContext('2d')?.drawImage(photo, 0, 0)
    }
  }, [photo])

  function recognized(value: string, barcode: boolean) {
    const found = matchScannedVehicles(value, currentVehicles.current)
    if (barcode && found.length === 1 && !found[0].needsReview) {
      cancel(); find.current(found[0].vehicle); return
    }
    setText(value)
    setManual(found.length === 0)
    setStatus(found.length ? 'Check the stock and vehicle below, then show it in inventory.' : value ? 'No exact vehicle found. Check the reading or crop closer to the tag.' : 'No text found. Crop closer, try another photo, or enter the number.')
  }
  async function startCamera() {
    cancel(); const token = generation.current
    setPhoto(null); setText(''); setManual(false); setBusy(true); setCamera(true)
    setStatus('Starting camera…')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is unavailable here. Use a photo or enter the number.')
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } } })
      if (token !== generation.current) { media.getTracks().forEach(track => track.stop()); return }
      stream.current = media
      const { scanVideo, createTagReader } = await import('./vehicle-scan-engine')
      if (token !== generation.current || !video.current) return
      const scanner = await scanVideo(video.current, media, value => {
        if (token !== generation.current || !matchScannedVehicles(value, currentVehicles.current).length) return
        cancel(); setCamera(false); setBusy(false); recognized(value, true)
      })
      if (token !== generation.current) { scanner.stop(); return }
      controls.current = scanner
      const controller = new AbortController(); operation.current = controller
      const reader = createTagReader(controller.signal)
      scanStockVideo(video.current, reader.readTag, result => {
        if (token !== generation.current || !matchScannedVehicles(result.text, currentVehicles.current).length) return false
        cancel(); setCamera(false); setBusy(false); recognized(result.text, result.barcode)
        return true
      }, controller.signal, message => { if (token === generation.current) setStatus(message) }, reader.stop)
      setStatus('Point at a VIN barcode or stock tag. Hold steady to read automatically.')
    } catch (error) {
      if (token !== generation.current) return
      stopCamera(); setCamera(false); setManual(true)
      setStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Camera permission was not granted. Choose a photo or enter the number.' : 'Camera could not start. Choose a photo or enter the number.')
    } finally { if (token === generation.current) setBusy(false) }
  }
  function captured(canvas: HTMLCanvasElement) {
    cancel(); setBusy(false); setCamera(false); setManual(false); setPhoto(canvas); setCrop(whole); setText('')
    void readPhoto(canvas, whole)
  }
  function capture() {
    const source = video.current
    if (!source?.videoWidth) { setStatus('The camera is still starting. Try again in a moment.'); return }
    const canvas = document.createElement('canvas')
    canvas.width = source.videoWidth; canvas.height = source.videoHeight
    canvas.getContext('2d')!.drawImage(source, 0, 0)
    captured(canvas)
  }
  async function upload(file?: File) {
    if (!file) return
    cancel(); const token = generation.current
    setCamera(false); setBusy(true); setStatus('Opening photo…')
    try {
      const { photoCanvas } = await import('./vehicle-scan-engine')
      const canvas = await photoCanvas(file)
      if (token === generation.current) captured(canvas)
    } catch { if (token === generation.current) { setBusy(false); setStatus('This photo could not be opened. Try a JPEG or PNG under 25 MB, or type the number.'); } }
  }
  async function readPhoto(source = photo, selection = crop) {
    if (!source) return
    cancel(); const token = generation.current
    const controller = new AbortController(); operation.current = controller
    const timeout = window.setTimeout(() => { if (generation.current === token) { cancel(); setBusy(false); setStatus('Reading took too long. Try a closer crop or enter the number.'); } }, 105000)
    setBusy(true); setStatus('Reading photo…')
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(source.width * selection.width)); canvas.height = Math.max(1, Math.round(source.height * selection.height))
    canvas.getContext('2d')!.drawImage(source, source.width * selection.x, source.height * selection.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    try {
      const { readTag } = await import('./vehicle-scan-engine')
      const result = await readTag(canvas, message => { if (token === generation.current) setStatus(message) }, controller.signal)
      if (token === generation.current) recognized(result.text, result.barcode)
    } catch { if (token === generation.current) { setManual(true); setStatus('The tag could not be read. Adjust the crop or enter the number.') } }
    finally { clearTimeout(timeout); if (token === generation.current) setBusy(false) }
  }
  return createPortal(<div className="vehicle-scan-overlay">
    <div className="vehicle-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="vehicle-scan-title" ref={dialog} tabIndex={-1}>
      <header><h2 id="vehicle-scan-title">Scan vehicle</h2><button type="button" ref={closeButton} onClick={close} aria-label="Close vehicle scanner"><X aria-hidden="true" /></button></header>
      <div className="vehicle-scan-body">
        {camera ? <div className="vehicle-scan-camera"><video ref={video} playsInline muted aria-label="Vehicle scanner camera" /><span className="vehicle-scan-guide" aria-hidden="true" /></div> : null}
        <p className="vehicle-scan-status" role="status">{status}</p>
        {matches.length && !manual ? null : <div className="vehicle-scan-actions">
          {!camera ? <button type="button" className="vehicle-scan-primary" onClick={() => void startCamera()} disabled={busy}><ScanLine aria-hidden="true" />Scan again</button> : <button type="button" onClick={capture} disabled={busy}><Camera aria-hidden="true" />Capture</button>}
          <label className="vehicle-scan-file"><ImagePlus aria-hidden="true" />Photo<input type="file" accept="image/*" aria-label="Choose or take a tag photo" disabled={busy} onChange={event => { void upload(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></label>
          <button type="button" onClick={() => { cancel(); setCamera(false); setBusy(false); setPhoto(null); setManual(true); setStatus('Enter a VIN or stock number.'); window.requestAnimationFrame(() => input.current?.focus()); }}><Keyboard aria-hidden="true" />Enter number</button>
        </div>}
        {photo ? <details className="vehicle-scan-photo"><summary>Adjust photo crop</summary>
          <div className="vehicle-scan-crop" onPointerDown={event => {
            if (busy) return
            const bounds = event.currentTarget.getBoundingClientRect()
            drag.current = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }
            event.currentTarget.setPointerCapture(event.pointerId)
          }} onPointerMove={event => {
            if (!drag.current) return
            const bounds = event.currentTarget.getBoundingClientRect()
            const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)); const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
            setCrop({ x: Math.min(x, drag.current.x), y: Math.min(y, drag.current.y), width: Math.max(0.01, Math.abs(x - drag.current.x)), height: Math.max(0.01, Math.abs(y - drag.current.y)) })
          }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
            <canvas ref={preview} aria-label="Tag photo preview. Drag to crop, or read the whole photo." />
            <span aria-hidden="true" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} />
          </div>
          <div className="vehicle-scan-actions"><button type="button" className="vehicle-scan-primary" onClick={() => void readPhoto()} disabled={busy}><ScanLine aria-hidden="true" />Read photo</button><button type="button" onClick={() => setCrop(whole)} disabled={busy}>Use whole photo</button></div>
        </details> : null}
        {busy && !camera ? <button type="button" onClick={() => { cancel(); setBusy(false); setCamera(false); setManual(true); setStatus('Stopped. Enter the number or try again.'); }}>Cancel reading</button> : null}
        {manual ? <label className="vehicle-scan-input">VIN or stock number<textarea rows={3} ref={input} value={text} autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={event => { cancel(); setCamera(false); setBusy(false); setText(event.currentTarget.value); setStatus('Choose the matching vehicle below.'); }} placeholder="VIN or stock number" /></label> : null}
        {matches.length ? <ul className="vehicle-scan-matches">{matches.map(match => <li key={match.vehicle.id}>
          <strong>{vehicleDisplayName(match.vehicle)}</strong><span>Stock {match.vehicle.stockNumber} · {match.vehicle.location.homeStore.name}</span><span>VIN {match.vehicle.vin}</span>
          {match.needsReview ? <p>Possible reading — compare the stock number with the tag.</p> : null}
          <button type="button" className="vehicle-scan-primary" onClick={() => { cancel(); onFind(match.vehicle); }}>Show {match.vehicle.stockNumber} in inventory</button>
        </li>)}</ul> : text.trim() ? <p>No matching vehicle in the loaded inventory. Check the number or try another photo.</p> : null}
        {matches.length && !manual ? <div className="vehicle-scan-actions">
          <button type="button" onClick={() => void startCamera()}><ScanLine aria-hidden="true" />Scan again</button>
          <button type="button" onClick={() => { setManual(true); window.requestAnimationFrame(() => input.current?.focus()); }}><Keyboard aria-hidden="true" />Edit reading</button>
        </div> : null}
        <p className="vehicle-scan-note">Camera images stay on this device.</p>
      </div>
    </div>
  </div>, document.body)
}
