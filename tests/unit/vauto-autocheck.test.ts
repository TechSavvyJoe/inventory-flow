// @ts-nocheck -- Node ESM capture utilities intentionally have no declaration files.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it, vi } from 'vitest'
import { captureVautoAutoCheck, parseVautoAutoCheckHtml, VAUTO_AUTOCHECK_SERVICE_SOURCE } from '../../scripts/capture-vauto-autocheck.mjs'
import { mergeVautoAutoCheck } from '../../scripts/merge-vauto-autocheck.mjs'
import { validateVinDocumentEnrichment } from '../../server/importer.mjs'
import { fetchInTab } from '../../scripts/lib/cdp.mjs'
vi.mock('../../scripts/lib/cdp.mjs', () => ({ fetchInTab: vi.fn(), closeOwnedTab: vi.fn(), sleep: vi.fn() }))

const vin = '1FMCU9GN8RUA43672'
const capturedAt = '2026-09-21T20:45:00.000Z'
function reportHtml(rows, extra = '') { return `<html><body><div>VIN ${vin}</div>${extra}<table><thead><tr><th>Event Date</th><th>Source</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></body></html>` }
function report(provider, label, date = '2026-09-20') { return { vin, provider, sourceLabel: label, capturedAt, dataState: 'current', historyStatus: 'reported', entries: [{ date, services: ['Vehicle Inspected'] }] } }
function captured(history) { return { vin, result: 'OK', startedAt: capturedAt, autoCheckReport: { validatedVin: vin, dataState: 'current', accessMethod: 'vauto', sourceLabel: VAUTO_AUTOCHECK_SERVICE_SOURCE, capturedAt }, ...(history ? { serviceHistory: history } : {}) } }

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

  it('extracts exact-VIN dated mechanical events while excluding other source columns and mixed narratives', () => {
    const html = reportHtml(`
      <tr><td>09/20/2026</td><td>Owner Jane Example, 123 Example Street</td><td>Vehicle Serviced or Inspected<br>Oil and filter changed; Tires rotated</td></tr>
      <tr><td>2026-09-19</td><td>Private source address</td><td>Transmission serviced</td></tr>
      <tr><td>09/20/2026</td><td>Private source address</td><td>Vehicle Serviced or Inspected<br>Oil and filter changed; Tires rotated</td></tr>
      <tr><td>09/18/2026</td><td>Unrelated</td><td>Customer Jane Example requested repairs; Vehicle Inspected</td></tr>`)
    const result = parseVautoAutoCheckHtml(html, vin, { capturedAt })
    expect(result.serviceHistory).toEqual({ reports: [{ vin, provider: 'autocheck', sourceLabel: VAUTO_AUTOCHECK_SERVICE_SOURCE, capturedAt, dataState: 'current', historyStatus: 'reported', entries: [
      { date: '2026-09-20', services: ['Vehicle Serviced or Inspected', 'Oil and filter changed', 'Tires rotated'] },
      { date: '2026-09-19', services: ['Transmission serviced'] },
    ] }] })
    expect(result.recentInspection).toEqual(parseVautoAutoCheckHtml(html, vin).recentInspection)
    expect(JSON.stringify(result.serviceHistory)).not.toMatch(/Jane|Example Street|Private|source address/)
    expect(result.serviceHistory.reports[0].entries[0]).not.toHaveProperty('odometer')
    expect(parseVautoAutoCheckHtml(html, '5LMCJ1DA6RUL15774', { capturedAt })).toBeNull()
  })
  it.each([
    [reportHtml('<tr><td>Unknown</td><td>Private source</td><td>Vehicle Serviced or Inspected</td></tr>'), 'undated service'],
    [reportHtml('<tr><td>09/20/2026</td><td>Private source</td><td>Customer Jane Example requested repairs; vehicle collected at 123 Example Street.</td></tr>'), 'dated private narrative'],
    [reportHtml('<tr><td>09/20/2026</td><td>Vehicle Serviced or Inspected</td><td>Owner Jane Example requested inspection.</td></tr>'), 'wrong source column'],
    [reportHtml('', '<div>12 service records reported</div>'), 'aggregate count'],
    [reportHtml('<tr><td>02/30/2026</td><td>Private source</td><td>Vehicle Inspected</td></tr>'), 'invalid calendar date'],
    [reportHtml('<tr><td>13/32/2026</td><td>Private source</td><td>Vehicle Inspected</td></tr>'), 'invalid month and day'],
  ])('omits serviceHistory when the table has no recognized dated mechanical event (%s; %s)', (html) => {
    expect(parseVautoAutoCheckHtml(html, vin, { capturedAt })).not.toHaveProperty('serviceHistory')
  })
  it('requires the capture timestamp and keeps the new channel outside autoCheckReport during capture', async () => {
    const html = reportHtml('<tr><td>09/20/2026</td><td>Ignored source</td><td>Vehicle Inspected</td></tr>')
    expect(parseVautoAutoCheckHtml(html, vin)).not.toHaveProperty('serviceHistory')
    expect(parseVautoAutoCheckHtml(html, vin, { capturedAt: 'not-a-timestamp' })).not.toHaveProperty('serviceHistory')
    vi.mocked(fetchInTab).mockResolvedValueOnce({ status: 200, contentType: 'text/html', text: html })
    const result = await captureVautoAutoCheck({ page: { evalJs: async () => [] }, headers: {} }, vin)
    expect(result.result).toBe('OK')
    expect(result.serviceHistory.reports[0]).toMatchObject({ vin, capturedAt: result.startedAt, provider: 'autocheck' })
    expect(result.autoCheckReport).not.toHaveProperty('serviceHistory')
    expect(result.autoCheckReport.recentInspection).toEqual({ date: '2026-09-20', types: ['Vehicle Inspected'] })
  })
  it('merges the normalized AutoCheck report while preserving independent providers and regenerating optional counts', () => {
    const history = { reports: [report('autocheck', VAUTO_AUTOCHECK_SERVICE_SOURCE)] }
    const result = mergeVautoAutoCheck({
      enrichment: { schemaVersion: 'inventory-flow-vin-document-enrichment-v1', recordsByVin: { [vin]: { vin, serviceHistory: { reports: [report('oem', 'Synthetic OEM'), report('carfax', 'CARFAX'), report('autocheck', 'Independent AutoCheck'), report('autocheck', VAUTO_AUTOCHECK_SERVICE_SOURCE, '2026-09-18')] } } } },
      captures: { schema: 'vauto-autocheck-capture-v1', records: [captured(history)] }, vehicles: { [vin]: { vin } },
    })
    expect(result.enrichment.recordsByVin[vin].serviceHistory.reports.map(item => item.sourceLabel)).toEqual(['Synthetic OEM', 'CARFAX', 'Independent AutoCheck', VAUTO_AUTOCHECK_SERVICE_SOURCE])
    expect(result.enrichment.recordsByVin[vin].serviceHistory.reports.at(-1).entries[0].date).toBe('2026-09-20')
    expect(result.metadata).toEqual({ serviceHistoryCount: 1 })
    expect(validateVinDocumentEnrichment(result.enrichment).metadata.serviceHistoryCount).toBe(1)
    const empty = mergeVautoAutoCheck({ enrichment: { schemaVersion: 'inventory-flow-vin-document-enrichment-v1', recordsByVin: {} }, captures: { schema: 'vauto-autocheck-capture-v1', records: [captured()] }, vehicles: { [vin]: { vin } } })
    expect(empty.enrichment.recordsByVin[vin]).not.toHaveProperty('serviceHistory')
    expect(empty.metadata).not.toHaveProperty('serviceHistoryCount')
    expect(validateVinDocumentEnrichment(empty.enrichment).metadata).not.toHaveProperty('serviceHistoryCount')
  })
  it.each([
    history => { history.reports[0].vin = '5LMCJ1DA6RUL15774' },
    history => { history.reports[0].capturedAt = '2026-09-20T20:45:00.000Z' },
    history => { history.reports[0].entries[0].services = ['Customer Jane Example approved repairs.'] },
    history => { history.reports[0].entries[0].services = ['Jane Example requested work.'] },
    history => { history.reports[0].entries[0].services = [] },
  ])('does not merge service history whose VIN, timestamp, or safe descriptors fail validation', mutate => {
    const history = { reports: [report('autocheck', VAUTO_AUTOCHECK_SERVICE_SOURCE)] }
    mutate(history)
    const result = mergeVautoAutoCheck({ enrichment: { schemaVersion: 'inventory-flow-vin-document-enrichment-v1', recordsByVin: {} }, captures: { schema: 'vauto-autocheck-capture-v1', records: [captured(history)] }, vehicles: { [vin]: { vin } } })
    expect(result.enrichment.recordsByVin[vin].autoCheckReport).toMatchObject({ validatedVin: vin, dataState: 'current' })
    expect(result.enrichment.recordsByVin[vin]).not.toHaveProperty('serviceHistory')
  })
  it('removes obsolete or website-superseded fallback history while preserving other providers and counts', () => {
    const other = '5LMCJ1DA6RUL15774'
    const result = mergeVautoAutoCheck({
      enrichment: { schemaVersion: 'inventory-flow-vin-document-enrichment-v1', recordsByVin: {
        [vin]: { vin, serviceHistory: { reports: [report('oem', 'Synthetic OEM'), report('autocheck', VAUTO_AUTOCHECK_SERVICE_SOURCE)] } },
        [other]: { vin: other, serviceHistory: { reports: [{ ...report('autocheck', VAUTO_AUTOCHECK_SERVICE_SOURCE), vin: other }] } },
      } },
      captures: { schema: 'vauto-autocheck-capture-v1', records: [] },
      vehicles: { [vin]: { vin, autoCheckReport: { url: `https://www.autocheck.com/report/${vin}` } } },
    })
    expect(result.enrichment.recordsByVin[vin].serviceHistory.reports).toEqual([report('oem', 'Synthetic OEM')])
    expect(result.enrichment.recordsByVin[other]).toBeUndefined()
    expect(result.stats.serviceHistoryRemoved).toBe(2)
    expect(result.metadata).toEqual({ serviceHistoryCount: 1 })
    expect(validateVinDocumentEnrichment(result.enrichment).metadata.serviceHistoryCount).toBe(1)
  })
  it('marks an unrefreshed service fallback stale while retaining independent provider facts', () => {
    const result = mergeVautoAutoCheck({ enrichment: { schemaVersion: 'inventory-flow-vin-document-enrichment-v1', recordsByVin: { [vin]: { vin, serviceHistory: { reports: [report('oem', 'Synthetic OEM'), report('autocheck', VAUTO_AUTOCHECK_SERVICE_SOURCE)] } } } }, captures: { schema: 'vauto-autocheck-capture-v1', records: [] }, vehicles: { [vin]: { vin } } })
    expect(result.enrichment.recordsByVin[vin].serviceHistory.reports).toEqual([report('oem', 'Synthetic OEM'), { ...report('autocheck', VAUTO_AUTOCHECK_SERVICE_SOURCE), dataState: 'stale_unverified' }])
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
