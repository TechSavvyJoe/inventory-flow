// @vitest-environment node
// @ts-nocheck -- dependency-free ESM view model; synthetic fixtures only.
import { describe, expect, it } from 'vitest'
import { buildPanelData, canRequestVehicle, holdLabel, mergeDetail, requestBlockedReason, resolveLocation, toPanelVehicle } from '../../extension/sidepanel/lib/model.mjs'

const meta = (overrides = {}) => ({ reportDate: '2026-08-30', completedAt: '2026-08-30T10:00:00-04:00', publicFreshness: 'current', dealerMailFreshness: 'current', ...overrides })
const base = (overrides = {}) => ({
  vin: 'TESTDATAHWELL0001', stockNumber: 'DEMO-H01', year: 2024, make: 'Ford', model: 'F-150', trim: 'Lariat', vehicleName: '2024 Ford F-150 Lariat',
  listedPrice: 51800, homeStore: 'Howell', publicStore: 'Howell', sourceReportedLocation: 'Howell', homeStoreConfirmed: true,
  websiteStatus: 'Not provided', publicListingState: 'Listed publicly', dealerOn: { inStock: true, inTransit: false, inProduction: false },
  hold: { state: 'none_observed', label: 'No hold observed', backupCount: 0, canViewEvidence: true },
  movement: { state: 'source_reported', label: 'Source-reported location', currentLocation: 'Howell', locationConfidence: 'reported' },
  ...overrides,
})
const data = (record, extra = {}) => ({ meta: meta(extra.meta), stores: [], transfers: extra.transfers ?? [], attention: [], vehicles: [record], access: extra.access })

describe('deal desk view model', () => {
  it('keeps hold, listing, movement and location as separate facts', () => {
    const vehicle = toPanelVehicle(base(), data(base()))
    expect(vehicle.hold.hasActiveHold).toBe(false)
    expect(vehicle.hold.label).toBe('No current DealerMail hold found')
    expect(vehicle.hold.tone).toBe('clear')
    expect(vehicle.listing.isListed).toBe(true)
    expect(vehicle.movement).toBeNull()
    expect(vehicle.location).toMatchObject({ label: 'Howell', provenance: 'source-reported' })
  })

  it('does not call a hold verified when the DealerMail snapshot is not current', () => {
    const record = base({ hold: { state: 'primary', label: 'Held', backupCount: 0 } })
    const vehicle = toPanelVehicle(record, data(record, { meta: { dealerMailFreshness: 'stale_unverified' } }))
    expect(vehicle.hold.hasActiveHold).toBeNull()
    expect(vehicle.hold.tone).toBe('unverified')
    expect(vehicle.hold.label).toBe('Hold status not verified')
    expect(holdLabel({ dataState: 'current', hasActiveHold: true, conciseState: null, position: 'backup' })).toBe('DealerMail backup hold')
  })

  it('shows hold evidence only when the server allowed it for this role', () => {
    const held = base({ hold: { state: 'primary', label: 'Held · Demo Salesperson', backupCount: 1, canViewEvidence: true, primarySalesperson: 'Demo Salesperson', expectedDate: '2026-08-31' }, privateEvidence: { primary: { salesperson: 'Demo Salesperson', customerOrReason: 'Appointment' }, backups: [{ salesperson: 'Backup Person' }], comments: [], alerts: [] } })
    const visible = toPanelVehicle(held, data(held))
    expect(visible.hold.evidence.map((item) => item.salesperson)).toEqual(['Demo Salesperson', 'Backup Person'])
    const redacted = { ...held, hold: { ...held.hold, canViewEvidence: false, primarySalesperson: undefined }, privateEvidence: undefined }
    const hidden = toPanelVehicle(redacted, data(redacted))
    expect(hidden.hold.evidence).toEqual([])
    expect(hidden.hold.tone).toBe('held')
  })

  it('only reports an app-confirmed location when the app actually holds custody', () => {
    // A bare source report with a currentLocation is still just a report.
    expect(resolveLocation(base({ movement: { currentLocation: 'Fowlerville', locationConfidence: 'reported' } }))).toMatchObject({ label: 'Howell', provenance: 'source-reported' })
    // With a transfer id, the app's own ledger is the authority.
    const moving = base({ movement: { transferId: 'transfer-1', state: 'in_transit', currentLocation: 'Fowlerville', locationConfidence: 'verified', lastConfirmedAt: '2026-08-30T12:00:00Z', currentCustodian: 'Demo Driver', nextAction: 'Mark arrived', dueAt: '2026-08-31T12:00:00Z' } })
    const vehicle = toPanelVehicle(moving, data(moving, { transfers: [{ id: 'transfer-1', vin: moving.vin, movementStatus: 'in_transit', requestStatus: 'approved', currentLocation: 'Fowlerville', destination: 'Fowlerville' }] }))
    expect(vehicle.location).toMatchObject({ label: 'Fowlerville', provenance: 'app-confirmed', custodian: 'Demo Driver' })
    expect(vehicle.movement).toMatchObject({ transferId: 'transfer-1', nextAction: 'Mark arrived', destination: 'Fowlerville' })
  })

  it('treats a ledger-backed location as app custody even when the transfer is withheld', () => {
    // service-core publishes state/location/confidence without the transfer
    // link so other stores can find a group vehicle; that is still custody.
    const withheld = base({ homeStore: 'Fowlerville', publicStore: 'Fowlerville', sourceReportedLocation: 'Fowlerville', movement: { state: 'in_transit', label: 'in transit', currentLocation: 'Howell', locationConfidence: 'verified', lastConfirmedAt: '2026-08-30T12:00:00Z' } })
    const vehicle = toPanelVehicle(withheld, data(withheld))
    expect(vehicle.location).toMatchObject({ label: 'Howell', provenance: 'app-confirmed', confidence: 'verified' })
    expect(vehicle.movement).toMatchObject({ transferId: null, withheld: true, state: 'in_transit' })
    expect(vehicle.movement.nextAction).toBeNull()
    // A conflicting location is surfaced as such, never as a store.
    const conflicting = base({ movement: { state: 'location_exception', label: 'Location needs checking', currentLocation: 'Unknown', locationConfidence: 'conflicting' } })
    expect(resolveLocation(conflicting)).toMatchObject({ label: 'Location needs checking', conflict: true, store: null })
  })

  it('merges the per-vehicle record so permitted roles see comments, alerts and CDK', () => {
    const summary = base({ hold: { state: 'primary', label: 'Held', backupCount: 1, canViewEvidence: true, primarySalesperson: 'Demo Salesperson' } })
    const before = toPanelVehicle(summary, data(summary))
    expect(before.hold.detailLoaded).toBe(false)
    expect(before.hold.comments).toEqual([])
    const detail = { ...summary, privateEvidence: { primary: { salesperson: 'Demo Salesperson', customerOrReason: 'Appointment' }, backups: [{ salesperson: 'Backup Person' }], comments: [{ author: 'Demo Manager', text: 'Customer confirmed', timestamp: '2026-08-30T12:00:00Z' }], alerts: [{ author: 'Demo Manager', text: 'Do not move' }], cdk: { status: 'DEMO' } } }
    const after = toPanelVehicle(mergeDetail(summary, detail), data(summary))
    expect(after.hold.detailLoaded).toBe(true)
    expect(after.hold.evidence.map((item) => item.salesperson)).toEqual(['Demo Salesperson', 'Backup Person'])
    expect(after.hold.comments).toEqual([{ author: 'Demo Manager', text: 'Customer confirmed', timestamp: '2026-08-30T12:00:00Z' }])
    expect(after.hold.alerts[0].text).toBe('Do not move')
    expect(after.hold.cdkStatus).toBe('DEMO')
    // A detail for a different VIN never merges.
    expect(mergeDetail(summary, { ...detail, vin: 'OTHER' })).toBe(summary)
    // And a redacted role gets nothing even if evidence is somehow present.
    const redacted = { ...detail, hold: { ...detail.hold, canViewEvidence: false } }
    expect(toPanelVehicle(redacted, data(redacted)).hold.comments).toEqual([])
  })

  it('carries manager-log freshness and sticker currency through', () => {
    const record = base({ managerDisposition: { soldLabel: 'Sold — manager log', deliveryLabel: 'Delivered — manager log', deliveryDate: '2026-08-30', sourceStore: 'Howell', confidence: 'high', dataState: 'stale_unverified' }, windowSticker: { url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker', totalMsrp: 54000, pricingCurrency: 'CAD', originalMarket: 'Canada' } })
    const stale = toPanelVehicle(record, data(record, { meta: { managerDispositionFreshness: 'stale_unverified' } }))
    expect(stale.managerLog.dataState).toBe('stale')
    expect(toPanelVehicle(record, data(record, { meta: { managerDispositionFreshness: 'current' } })).managerLog.dataState).toBe('current')
    expect(stale.documents.windowSticker).toMatchObject({ totalMsrp: 54000, pricingCurrency: 'CAD', originalMarket: 'Canada' })
  })

  it('applies the app\'s own rule for who may request a vehicle', () => {
    const away = toPanelVehicle(base({ homeStore: 'Fowlerville' }), data(base({ homeStore: 'Fowlerville' })))
    const home = toPanelVehicle(base(), data(base()))
    const sales = { role: 'sales', store: 'Howell', canCreateTransfer: true }
    expect(canRequestVehicle(away, sales)).toBe(true)
    expect(canRequestVehicle(home, sales)).toBe(false)
    expect(requestBlockedReason(home, sales)).toMatch(/Already at Howell/)
    expect(canRequestVehicle(away, { ...sales, role: 'porter' })).toBe(false)
    expect(canRequestVehicle(away, null)).toBe(false)
    const moving = { ...away, movement: { transferId: 'transfer-2' } }
    expect(requestBlockedReason(moving, sales)).toMatch(/already in progress/)
  })

  it('drops unofficial document and photo urls and splits features', () => {
    const record = base({ features: 'Heated Seats | Heated Seats, Tow Package', imageUrls: ['https://www.bobmaxeyfordhowell.com/inventoryphotos/1.jpg', 'http://insecure.example/x.jpg'], listingUrl: 'https://evil.example/used-x', autoCheckReport: { url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=a', score: 91 }, windowSticker: { url: 'https://www.bobmaxeyfordhowell.com/somewhere-else', totalMsrp: 68420 } })
    const vehicle = toPanelVehicle(record, data(record))
    expect(vehicle.features).toEqual(['Heated Seats', 'Tow Package'])
    expect(vehicle.photos).toEqual(['https://www.bobmaxeyfordhowell.com/inventoryphotos/1.jpg'])
    expect(vehicle.listing.url).toBeNull()
    expect(vehicle.documents.autoCheck).toMatchObject({ url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=a', score: 91 })
    expect(vehicle.documents.windowSticker.url).toBeNull()
  })

  it('summarizes the release for the footer', () => {
    const summary = buildPanelData(data(base({ hold: { state: 'primary', label: 'Held', backupCount: 0 } }), { meta: { heldVinCount: 1 }, access: { user: 'Demo', role: 'sales', store: 'Howell' } }))
    expect(summary.meta).toMatchObject({ reportDate: '2026-08-30', publicFreshness: 'current', dealerMailFreshness: 'current', heldVinCount: 1 })
    expect(summary.access.store).toBe('Howell')
    expect(summary.vehicles).toHaveLength(1)
  })
})
