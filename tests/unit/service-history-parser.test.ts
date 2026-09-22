import { describe, expect, it } from 'vitest'
import {
  parseServiceHistoryDetails,
  parseServiceHistoryIndex,
  repairOrderFingerprint,
} from '../../scripts/lib/service-history-parser.mjs'

const vin = '2FMPK4J95PBA07480'
const order = {
  repairOrderNumber: '0000000000317147',
  dealerCode: '07317',
  openDate: '08/14/2026',
  closeDate: '09/11/2026',
  odometer: 121110,
}

describe('Ford PTS retail service-history parser', () => {
  it('binds the index to the requested VIN and sorts the newest repair order first', () => {
    const html = `<h2>Retail Service Repair History</h2><p>VIN: ${vin}</p><table>
      <tr><th>Details</th><th>Dealer Code</th><th>Repair Order Number</th><th>Repair Order Open Date</th><th>Repair Order Close Date</th><th>Odometer</th></tr>
      <tr><td>Details</td><td>07317</td><td>0000000000300000</td><td>07/30/2026</td><td>07/30/2026</td><td>119486</td></tr>
      <tr><td>Details</td><td>07317</td><td>0000000000317147</td><td>08/14/2026</td><td>09/11/2026</td><td>121110</td></tr>
    </table>`
    expect(parseServiceHistoryIndex(html, vin)).toEqual({ state: 'ok', repairOrders: [
      order,
      expect.objectContaining({ repairOrderNumber: '0000000000300000' }),
    ] })
    expect(parseServiceHistoryIndex(html, '1FMCU9G66PUA12345').state).toBe('vin_mismatch')
  })

  it('accepts Ford PTS empty history only when the exact no-data signature is present', () => {
    expect(parseServiceHistoryIndex('<h2>Retail Service Repair History</h2><div>No data found.</div>', vin)).toEqual({
      state: 'ok',
      repairOrders: [],
    })
    expect(parseServiceHistoryIndex('<h2>Retail Service Repair History</h2>', vin).state).toBe('vin_mismatch')
    expect(parseServiceHistoryIndex('<h2>Retail Service Repair History</h2><div>No data found.</div>1FMCU9G66PUA12345', vin).state).toBe('vin_mismatch')
  })

  it('extracts inspection evidence, parts, labor, and a concise deterministic summary', () => {
    const html = `<div>Repair Order: <b>${order.repairOrderNumber}</b></div>
      <div>Repair Order Open Date: ${order.openDate} &nbsp; Repair Order Close Date: ${order.closeDate}</div>
      <div>Odometer: ${order.odometer}</div>
      <table><tr><th>Part Description</th><th>Job Number</th><th>Repair Pay Type</th><th>Quantity</th><th>Ford Part</th><th>Prefix</th><th>Base</th><th>Suffix</th></tr>
        <tr><td>BLADE ASY - WIPER</td><td>1</td><td>I</td><td>1</td><td>Y</td><td>FT4Z</td><td>17528</td><td>BA</td></tr>
        <tr><td>MOTORCRAFT SAE 5W-30 API GF-7A</td><td>1</td><td>I</td><td>6</td><td>Y</td><td>XO</td><td>5W30</td><td>BSP</td></tr>
        <tr><td>KIT - ELEMENT &amp; GASKET - OIL FILTER</td><td>1</td><td>I</td><td>1</td><td>Y</td><td>BE8Z</td><td>6731</td><td>AB</td></tr>
      </table>
      <table><tr><th>Labor Operation Code</th><th>Labor Operation Code Description</th></tr>
        <tr><td>UCC</td><td>Brake measurements. Tire measurements. IDS self test. Used car inspections.</td></tr>
        <tr><td>CPOUCI</td><td>UCI car inspection with Certified Blue Oval inspection</td></tr>
      </table>`
    const parsed = parseServiceHistoryDetails(html, order)
    expect(parsed.state).toBe('ok')
    expect(parsed.repairOrder).toMatchObject({
      ...order,
      detailComplete: true,
      inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' },
      services: expect.arrayContaining(['Certified Blue Oval inspection', 'Oil and filter service', 'Wiper blades', 'Diagnostic self-test']),
    })
    expect(parsed.repairOrder!.parts[0]).toMatchObject({ description: 'BLADE ASY - WIPER', quantity: 1, partNumber: 'FT4Z-17528-BA' })
    expect(parsed.repairOrder!.summary).toContain('Certified Blue Oval inspection')
    expect(JSON.stringify(parsed)).not.toMatch(/customer|owner/i)
  })

  it('uses the immutable repair-order fingerprint for incremental detail reuse', () => {
    expect(repairOrderFingerprint(order)).toBe('0000000000317147|08/14/2026|09/11/2026|121110')
    expect(repairOrderFingerprint({ ...order, closeDate: '09/12/2026' })).not.toBe(repairOrderFingerprint(order))
  })

  it('drops customer-labelled service text before deriving inspection and summary facts', () => {
    const html = `<div>Repair Order: <b>${order.repairOrderNumber}</b></div>
      <div>Repair Order Open Date: ${order.openDate} Repair Order Close Date: ${order.closeDate}</div>
      <table><tr><th>Labor Operation Code</th><th>Labor Operation Code Description</th></tr>
        <tr><td>UCC</td><td>Customer: Jane Doe requested a used car inspection</td></tr>
        <tr><td>MPI</td><td>Multi-point inspection completed</td></tr>
      </table>`
    const parsed = parseServiceHistoryDetails(html, order)
    expect(parsed.state).toBe('ok')
    expect(parsed.repairOrder!.laborOperations).toEqual([{ code: 'MPI', description: 'Multi-point inspection completed' }])
    expect(parsed.repairOrder!.summary).toBe('Multi-point inspection.')
    expect(JSON.stringify(parsed)).not.toMatch(/jane|doe|customer:/i)
  })
})
