import { useEffect, useRef, useState } from 'react'
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
  const title = kind === 'comments' ? 'Comments' : 'Alerts'
  return <section className="inventory-captured-messages" aria-label={title}>
    <h3>{title}</h3>
    <p>Review or update {kind} in DealerMail.</p>
    {messages.length ? messages.map((message, index) => <article key={index}>
      <p>{message.text || 'No message text available.'}</p>
      {message.author ? <small>{message.author}</small> : null}
    </article>) : <p>No {kind} are available.</p>}
  </section>
}

export function DealerMailHandoff({ vehicle }: { vehicle: InventoryVehicle }) {
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

  return <section className="inventory-dealermail-handoff inventory-workspace-dealermail-rail" aria-label="DealerMail vehicle tools">
    <header><h3>Continue in DealerMail</h3><p>Review or update the live hold.</p></header>
    <dl className="inventory-dealermail-handoff__identity">
      <div><dt>Stock</dt><dd>{vehicle.stockNumber || 'Not supplied'}</dd></div>
      <div><dt>Verify full VIN</dt><dd>{vehicle.vin}</dd></div>
    </dl>
    <button type="button" className="inventory-dealermail-handoff__launch" onClick={launch} disabled={!url}>
      <ExternalLink size={17} aria-hidden="true" /> Open in DealerMail (copies stock)
    </button>
    <p>Paste the stock number into DealerMail and verify the VIN before updating the record.</p>
    {vehicle.dealerMail.dataState !== 'current' ? <p role="note">Confirm the current hold before acting.</p> : null}
    {feedback ? <div className="inventory-dealermail-handoff__feedback" role="status">{feedback} {url ? <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open DealerMail inventory</a> : null}</div> : null}
  </section>
}
