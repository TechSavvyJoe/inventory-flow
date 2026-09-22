// @ts-nocheck -- Node ESM capture utilities intentionally have no declaration files.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseVautoAutoCheckHtml } from '../../scripts/capture-vauto-autocheck.mjs'
import { mergeVautoAutoCheck } from '../../scripts/merge-vauto-autocheck.mjs'

const vin = '1FMCU9GN8RUA43672'

describe('vAuto AutoCheck fallback', () => {
  it('parses bounded facts only after exact-VIN validation', () => {
    const html = `<!doctype html><html><body>
      <div>VIN ${vin}</div><div>Report run: 09/21/2026 8:45 PM</div>
      <div class="mainScore">91</div><div class="low-score">86</div><div class="high-score">94</div>
      <div class="owner"><span>Vehicle Usage</span> Personal</div><div class="owner-header">Owner 1</div>
      <div class="decode-box-row">Class: SUV</div><div class="decode-box-row">Country of Assembly: USA</div>
      <div class="decode-box-row">Estimated In Service: 05/20/2024</div>
      <div class="decode-box-row">Last Reported Odometer: 28,580 (08/25/2026)</div>
      <section id="at-glance"><article class="card"><b class="large-title">Accident / damage</b><span class="card-footer-text-adjustment">No accidents reported</span><small class="subtitle">No damage events found</small></article></section>
      <table><thead><tr><th>Event Date</th><th>Details</th></tr></thead><tbody><tr><td>08/25/2026</td><td>Vehicle Serviced or Inspected</td></tr></tbody></table>
    </body></html>`
    expect(parseVautoAutoCheckHtml(html, vin)).toMatchObject({
      score: 91,
      scoreRangeLow: 86,
      scoreRangeHigh: 94,
      usage: 'Personal',
      ownerCount: 1,
      lastReportedOdometer: 28580,
      lastReportedOdometerDate: '2026-08-25',
      vehicleClass: 'SUV',
      assemblyCountry: 'USA',
      estimatedInServiceDate: '2024-05-20',
      recentInspection: { date: '2026-08-25', types: ['Vehicle Serviced or Inspected'] },
      checks: [{ label: 'Accident / damage', status: 'No accidents reported', detail: 'No damage events found' }],
    })
    expect(parseVautoAutoCheckHtml(html, '5LMCJ1DA6RUL15774')).toBeNull()
  })

  it('keeps the dealership website first and removes obsolete vAuto fallback data', () => {
    const captured = {
      validatedVin: vin,
      dataState: 'current',
      accessMethod: 'vauto',
      sourceLabel: 'Experian AutoCheck report captured through vAuto for this VIN',
      capturedAt: '2026-09-21T20:45:00.000Z',
      score: 91,
    }
    const base = {
      schemaVersion: 'inventory-flow-vin-document-enrichment-v1',
      recordsByVin: {
        [vin]: { vin, autoCheckReport: captured },
        '5LMCJ1DA6RUL15774': { vin: '5LMCJ1DA6RUL15774', autoCheckReport: { ...captured, validatedVin: '5LMCJ1DA6RUL15774' } },
      },
    }
    const result = mergeVautoAutoCheck({
      enrichment: structuredClone(base),
      captures: { schema: 'vauto-autocheck-capture-v1', records: [{ vin, result: 'OK', autoCheckReport: captured }] },
      vehicles: {
        [vin]: { vin, autoCheckReport: { url: `https://www.autocheck.com/report/${vin}` } },
      },
    })
    expect(result.enrichment.recordsByVin[vin]).toBeUndefined()
    expect(result.enrichment.recordsByVin['5LMCJ1DA6RUL15774']).toBeUndefined()
    expect(result.stats).toMatchObject({ websiteFirst: 1, fallbackRemoved: 2 })
  })

  it('attaches a current fallback and marks an unrefreshed one stale', () => {
    const other = '5LMCJ1DA6RUL15774'
    const report = (validatedVin: string) => ({ validatedVin, dataState: 'current', accessMethod: 'vauto', sourceLabel: 'Experian AutoCheck report captured through vAuto for this VIN', capturedAt: '2026-09-21T20:45:00.000Z' })
    const result = mergeVautoAutoCheck({
      enrichment: { schemaVersion: 'inventory-flow-vin-document-enrichment-v1', recordsByVin: { [other]: { vin: other, autoCheckReport: report(other) } } },
      captures: { schema: 'vauto-autocheck-capture-v1', records: [{ vin, result: 'OK', autoCheckReport: report(vin) }] },
      vehicles: { [vin]: { vin }, [other]: { vin } },
    })
    expect(result.enrichment.recordsByVin[vin].autoCheckReport.dataState).toBe('current')
    expect(result.enrichment.recordsByVin[other].autoCheckReport.dataState).toBe('stale_unverified')
  })
})
