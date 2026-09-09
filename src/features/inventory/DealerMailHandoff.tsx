import { useEffect, useRef, useState, type RefObject } from 'react'
import { ExternalLink } from 'lucide-react'
import { copyExactText } from '../../components/CopyableValue'
import { dealerMailInteractiveVehicleUrl } from './vehicle-document-utils'
import type { InventoryVehicle } from './types'
import './DealerMailHandoff.css'

export function CapturedDealerMailMessages({ vehicle, kind }: { vehicle: InventoryVehicle; kind: 'comments' | 'alerts' }) {
  if (!vehicle.dealerMail.canViewEvidence) return null
  const messages = vehicle.dealerMailEvidence?.[kind]?.length
    ? vehicle.dealerMailEvidence[kind]
    : vehicle.holdEvidence?.flatMap(record => record[kind] ?? []) ?? []
  const title = kind === 'comments' ? 'Saved comments' : 'Saved alerts'
  const stale = vehicle.dealerMail.dataState !== 'current' || (vehicle.dealerMailEvidence && vehicle.dealerMailEvidence.dataState !== 'current')
  return <section className="inventory-captured-messages" aria-label={title}>
    <h3>{title}</h3>
    <p>{stale ? 'Last verified information — current state is unverified.' : 'Read-only information from the latest captured record.'} Add or change {kind} only in the verified live DealerMail record.</p>
    {messages.length ? messages.map((message, index) => <article key={index}>
      <p>{message.text || 'Text was not supplied.'}</p>
      <small>{[message.author, message.timestamp, 'metadataRaw' in message ? message.metadataRaw : null, 'spiffRaw' in message && message.spiffRaw ? `Spiff: ${message.spiffRaw}` : null].filter(Boolean).join(' · ')}</small>
    </article>) : <p>No {kind} were captured for this vehicle. This does not confirm there are none in DealerMail now.</p>}
  </section>
}

export function DealerMailHandoff({ vehicle, panelRef }: {
  vehicle: InventoryVehicle
  panelRef: RefObject<HTMLElement | null>
}) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const identity = `${vehicle.id}|${vehicle.stockNumber}|${vehicle.vin}`
  const currentIdentity = useRef(identity)
  currentIdentity.current = identity
  useEffect(() => { setFeedback(null) }, [identity])
  const url = dealerMailInteractiveVehicleUrl(vehicle.stockNumber)
  if (!vehicle.dealerMail.canManageHold) return null

  function launch() {
    if (!url) {
      setFeedback('No usable stock number was supplied. Open the live inventory and verify this vehicle by its full VIN.')
      return
    }
    // Start clipboard work while this page still owns the user's click/focus.
    const copy = copyExactText(vehicle.stockNumber)
    let navigationFailed = false
    try {
      // noopener deliberately returns null even when the tab opens successfully.
      // A null handle cannot distinguish success from a popup block.
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      navigationFailed = true
    }
    const launchIdentity = identity
    const navigation = navigationFailed
      ? 'The browser could not request a new tab.'
      : 'DealerMail tab requested.'
    setFeedback(`${navigation} Copying stock…`)
    void copy.then(copied => {
      if (currentIdentity.current !== launchIdentity) return
      setFeedback(`${navigation} ${copied ? `Stock ${vehicle.stockNumber} copied.` : `Stock could not be copied. Select stock ${vehicle.stockNumber} above and copy it manually.`} No DealerMail record was changed. If no tab appeared:`)
    }).catch(() => {
      if (currentIdentity.current !== launchIdentity) return
      setFeedback(`${navigation} Copy failed. Select stock ${vehicle.stockNumber} above and copy it manually. No DealerMail record was changed. If no tab appeared:`)
    })
  }

  return <section className="inventory-dealermail-handoff inventory-workspace-dealermail-rail" aria-label="DealerMail vehicle tools" ref={panelRef} tabIndex={-1}>
    <header><h3>Continue in DealerMail</h3><p>Live holds, comments, and alerts are managed in DealerMail.</p></header>
    <dl className="inventory-dealermail-handoff__identity">
      <div><dt>Stock</dt><dd>{vehicle.stockNumber || 'Not supplied'}</dd></div>
      <div><dt>Verify full VIN</dt><dd>{vehicle.vin}</dd></div>
    </dl>
    <button type="button" className="inventory-dealermail-handoff__launch" onClick={launch} disabled={!url}>
      <ExternalLink size={17} aria-hidden="true" /> Open DealerMail &amp; copy stock
    </button>
    <p>In DealerMail, paste the stock into <strong>LAST8 / STOCK</strong>, click <strong>Search</strong>, and verify the VIN.</p>
    <p className="inventory-dealermail-handoff__note">DealerMail opens its inventory search; the vehicle is not selected automatically.</p>
    {vehicle.dealerMail.dataState !== 'current' ? <p role="note">Hold status is not confirmed. Verify the live DealerMail record before acting.</p> : null}
    {feedback ? <div className="inventory-dealermail-handoff__feedback" role="status">{feedback} {url ? <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open DealerMail inventory</a> : null}</div> : null}
  </section>
}
