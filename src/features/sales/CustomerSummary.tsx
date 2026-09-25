import { useEffect, useMemo, useRef, useState } from 'react'
import { Clipboard, FileText, Printer } from 'lucide-react'
import { customerSummaryText, takeHomeModel } from './customer-summary'
import type { InventoryVehicle } from '../inventory/types'
import './CustomerSummary.css'

export function CustomerSummary({ vehicle, onRecords, onTakeHome }: { vehicle: InventoryVehicle; onRecords: () => void; onTakeHome: (button: HTMLButtonElement) => void }) {
  const text = useMemo(() => customerSummaryText(takeHomeModel(vehicle)), [vehicle])
  const [copyResult, setCopyResult] = useState<{ text: string; status: 'copied' | 'manual' } | null>(null)
  const [copyPending, setCopyPending] = useState(false)
  const pending = useRef(false)
  const currentText = useRef(text)
  const request = useRef(0)
  const mounted = useRef(true)
  if (currentText.current !== text) { currentText.current = text; request.current += 1 }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current += 1 }
  }, [])
  const copyStatus = copyResult?.text === text ? copyResult.status : 'idle'
  async function copy() {
    if (pending.current) return
    pending.current = true
    setCopyPending(true)
    const token = ++request.current
    const complete = (status: 'copied' | 'manual') => {
      if (mounted.current && request.current === token && currentText.current === text) setCopyResult({ text, status })
    }
    try { await navigator.clipboard.writeText(text); complete('copied') }
    catch { complete('manual') }
    finally { pending.current = false; if (mounted.current) setCopyPending(false) }
  }
  return <details className="customer-summary">
    <summary><span>Customer summary</span><small>Review vehicle facts, copy, or prepare a take-home page</small></summary>
    <div className="customer-summary__content">
      <p>Vehicle facts from the inventory snapshot for your conversation. Private holds, customer notes and internal movement details are excluded.</p>
      <label><span>Customer-facing vehicle information</span><textarea readOnly value={text} onFocus={event => event.currentTarget.select()} /></label>
      <div className="customer-summary__actions">
        <button type="button" onClick={() => void copy()} disabled={copyPending} aria-busy={copyPending}><Clipboard aria-hidden="true" size={16} />{copyStatus === 'copied' ? 'Copied customer summary' : 'Copy customer summary'}</button>
        <button type="button" onClick={event => onTakeHome(event.currentTarget)}><Printer aria-hidden="true" size={16} />Prepare take-home page</button>
        <button type="button" onClick={onRecords}><FileText aria-hidden="true" size={16} />Review supporting records</button>
      </div>
      <p role="status">{copyPending ? 'Copying the reviewed summary…' : copyStatus === 'copied' ? 'Copied. Review the facts before sharing with your customer.' : copyStatus === 'manual' ? 'Clipboard access was unavailable. Select the summary above and copy it manually.' : 'Copying prepares text only. Nothing is sent to a customer.'}</p>
    </div>
  </details>
}
