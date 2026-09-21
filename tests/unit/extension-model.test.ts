// @vitest-environment node
// @ts-nocheck -- dependency-free ESM view model; synthetic fixtures only.
import { describe, expect, it } from 'vitest'
import { buildPanelData, canRequestVehicle, certifiedProgram, copyFields, dealSheetText, holdLabel, mergeDetail, requestBlockedReason, resolveLocation, toPanelVehicle, vehicleMoveAction } from '../../extension/sidepanel/lib/model.mjs'

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
  it('keeps unconfirmed existing inventory waiting without inventing manager service completion dates', () => {
    expect(toPanelVehicle(base(), data(base())).serviceReadiness).toMatchObject({ status: 'needs_service', completedAt: null, readinessBasis: 'unconfirmed' })
    const serviced = base({ serviceReadiness: { status: 'serviced', completedAt: '2026-09-14', store: 'Howell', canManage: true } })
    expect(toPanelVehicle(serviced, data(serviced)).serviceReadiness).toMatchObject({ status: 'serviced', completedAt: '2026-09-14', store: 'Howell', canManage: true })
    const legacy = base({ serviceReadiness: { status: 'unknown' } })
    expect(toPanelVehicle(legacy, data(legacy)).serviceReadiness.status).toBe('needs_service')
  })

  it('keeps the primary photo when the gallery is empty and deduplicates the full gallery', () => {
    const primary = 'https://www.bobmaxeyfordhowell.com/a.jpg'
    const next = 'https://www.bobmaxeyfordhowell.com/b.jpg'
    const record = base({ imageUrl: primary, imageUrls: [] })
    expect(toPanelVehicle(record, data(record)).photos).toEqual([primary])
    expect(toPanelVehicle({ ...record, imageUrls: [primary, next] }, data(record)).photos).toEqual([primary, next])
  })

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

  it('resolves sales requests and manager direct moves by vehicle ownership', () => {
    const away = toPanelVehicle(base({ homeStore: 'Fowlerville' }), data(base({ homeStore: 'Fowlerville' })))
    const home = toPanelVehicle(base(), data(base()))
    const sales = { role: 'sales', store: 'Howell', canCreateTransfer: true }
    expect(canRequestVehicle(away, sales)).toBe(true)
    expect(vehicleMoveAction(away, sales)).toBe('request')
    expect(canRequestVehicle(home, sales)).toBe(false)
    expect(requestBlockedReason(home, sales)).toMatch(/store manager/i)
    expect(vehicleMoveAction(home, { ...sales, role: 'manager' })).toBe('direct')
    expect(vehicleMoveAction(away, { ...sales, role: 'manager' })).toBe('request')
    expect(vehicleMoveAction(home, { ...sales, role: 'group_manager' })).toBe('direct')
    expect(vehicleMoveAction(away, { ...sales, role: 'group_manager' })).toBe('direct')
    expect(canRequestVehicle(away, { ...sales, role: 'porter' })).toBe(false)
    expect(canRequestVehicle(away, null)).toBe(false)
    const moving = { ...away, movement: { transferId: 'transfer-2' } }
    expect(requestBlockedReason(moving, sales)).toMatch(/already in progress/)
    const reroutableRecord = base({ movement: { transferId: 'direct-2', state: 'at_requesting_store', currentLocation: 'Ford Detroit', locationConfidence: 'verified', newRequestBlocked: true, canDirectReroute: true } })
    const reroutable = toPanelVehicle(reroutableRecord, data(reroutableRecord))
    expect(reroutable.movement).toMatchObject({ transferId: 'direct-2', canDirectReroute: true })
    expect(vehicleMoveAction(reroutable, { ...sales, role: 'group_manager' })).toBe('direct')
    expect(vehicleMoveAction(reroutable, { ...sales, role: 'manager' })).toBe('direct')
    expect(vehicleMoveAction(reroutable, sales)).toBe(false)
    expect(vehicleMoveAction(reroutable, { ...sales, role: 'manager', store: 'Lincoln' })).toBe(false)
    expect(requestBlockedReason(reroutable, { ...sales, role: 'group_manager' })).toBeNull()
    // A withheld move (no transfer link) is still an open move the server would reject a request for.
    const withheldRecord = base({ homeStore: 'Fowlerville', publicStore: 'Fowlerville', sourceReportedLocation: 'Fowlerville', movement: { state: 'in_transit', label: 'in transit', currentLocation: 'Howell', locationConfidence: 'verified' } })
    const withheld = toPanelVehicle(withheldRecord, data(withheldRecord))
    expect(withheld.movement).toMatchObject({ withheld: true, transferId: null })
    expect(canRequestVehicle(withheld, sales)).toBe(false)
    expect(requestBlockedReason(withheld, sales)).toMatch(/already in progress/)
  })

  it('keeps a completed home receipt as location evidence but not as an open move', () => {
    // After a round trip the server keeps publishing state 'returned_home' as
    // the location authority and allows the vehicle to be requested again.
    const record = base({ homeStore: 'Fowlerville', publicStore: 'Fowlerville', sourceReportedLocation: 'Fowlerville', movement: { state: 'returned_home', label: 'returned home', currentLocation: 'Fowlerville', locationConfidence: 'verified', lastConfirmedAt: '2026-08-30T12:00:00Z' } })
    const vehicle = toPanelVehicle(record, data(record))
    expect(vehicle.location).toMatchObject({ label: 'Fowlerville', provenance: 'app-confirmed', confirmedAt: '2026-08-30T12:00:00Z' })
    expect(vehicle.movement).toBeNull()
    expect(canRequestVehicle(vehicle, { role: 'sales', store: 'Howell', canCreateTransfer: true })).toBe(true)
    // A new request on that vehicle arrives merged with the receipt's state;
    // the link outranks the physical state, so it is an open move again.
    const reopened = base({ homeStore: 'Fowlerville', movement: { transferId: 'transfer-9', requestStatus: 'requested', state: 'returned_home', currentLocation: 'Fowlerville', locationConfidence: 'verified' } })
    const open = toPanelVehicle(reopened, data(reopened, { transfers: [{ id: 'transfer-9', vin: reopened.vin, requestStatus: 'requested', movementStatus: 'at_home', currentLocation: 'Fowlerville' }] }))
    expect(open.movement).toMatchObject({ transferId: 'transfer-9', withheld: false })
    expect(canRequestVehicle(open, { role: 'sales', store: 'Howell', canCreateTransfer: true })).toBe(false)
    // The requester may not see the receipt row; its own open request is joined from the transfers list instead.
    const joinedOnly = toPanelVehicle(record, data(record, { transfers: [{ id: 'transfer-9', vin: record.vin, requestStatus: 'requested', movementStatus: 'at_home' }] }))
    expect(joinedOnly.movement).toMatchObject({ transferId: 'transfer-9' })
    // A location conflict is custody evidence to check, not an open move.
    const conflict = base({ movement: { state: 'location_exception', label: 'Location needs checking', currentLocation: 'Unknown', locationConfidence: 'conflicting' } })
    const checked = toPanelVehicle(conflict, data(conflict))
    expect(checked.location).toMatchObject({ label: 'Location needs checking', conflict: true })
    expect(checked.movement).toBeNull()
  })

  it('prefers the server\'s own new-request decision and falls back to the open-move rule only when it is absent', () => {
    const sales = { role: 'sales', store: 'Howell', canCreateTransfer: true }
    // A trip canceled after departure: stale 'picked_up' custody, no link,
    // no blocking row. service-core publishes newRequestBlocked: false.
    const canceledRecord = base({ homeStore: 'Fowlerville', publicStore: 'Fowlerville', sourceReportedLocation: 'Fowlerville', movement: { state: 'picked_up', label: 'picked up', currentLocation: 'In transit', destination: 'Howell', locationConfidence: 'verified', lastConfirmedAt: '2026-08-30T11:20:00Z', newRequestBlocked: false } })
    const canceled = toPanelVehicle(canceledRecord, data(canceledRecord))
    // The Movement tile and pill keep their precedence: still custody, still withheld.
    expect(canceled.movement).toMatchObject({ state: 'picked_up', withheld: true, transferId: null })
    expect(canceled.location).toMatchObject({ label: 'In transit', provenance: 'app-confirmed' })
    expect(canceled.moveRequestBlocked).toBe(false)
    expect(canRequestVehicle(canceled, sales)).toBe(true)
    expect(requestBlockedReason(canceled, sales)).toBeNull()
    // Role and home-store rules still apply on top of the server's answer.
    expect(canRequestVehicle(canceled, { ...sales, store: 'Fowlerville' })).toBe(false)
    expect(canRequestVehicle(canceled, { ...sales, role: 'porter' })).toBe(false)
    // A withheld open move the server also blocks.
    const withheldRecord = base({ homeStore: 'Fowlerville', movement: { state: 'in_transit', label: 'in transit', currentLocation: 'Howell', locationConfidence: 'verified', newRequestBlocked: true } })
    const withheld = toPanelVehicle(withheldRecord, data(withheldRecord))
    expect(withheld.moveRequestBlocked).toBe(true)
    expect(canRequestVehicle(withheld, sales)).toBe(false)
    expect(requestBlockedReason(withheld, sales)).toMatch(/already in progress/)
    // A completed receipt blocked by a request from a store this user cannot
    // see: no pill (nothing is moving that this user may know about), yet
    // the server's word wins and the reason names no store or request.
    const receiptRecord = base({ homeStore: 'Fowlerville', movement: { state: 'returned_home', label: 'returned home', currentLocation: 'Fowlerville', locationConfidence: 'verified', newRequestBlocked: true } })
    const receipt = toPanelVehicle(receiptRecord, data(receiptRecord))
    expect(receipt.movement).toBeNull()
    expect(receipt.moveRequestBlocked).toBe(true)
    expect(canRequestVehicle(receipt, sales)).toBe(false)
    expect(requestBlockedReason(receipt, sales)).toBe('This vehicle already has an open move request.')
    expect(requestBlockedReason(receipt, sales)).not.toMatch(/Lincoln|Howell|Fowlerville|transfer-/)
    // A source-only vehicle blocked the same way.
    const sourceRecord = base({ homeStore: 'Fowlerville', movement: { state: 'source_reported', label: 'Source-reported location', currentLocation: 'Fowlerville', locationConfidence: 'reported', newRequestBlocked: true } })
    expect(canRequestVehicle(toPanelVehicle(sourceRecord, data(sourceRecord)), sales)).toBe(false)
    // Absent (older server, advanced mode): null, and the open-move rule decides.
    for (const movement of [
      { state: 'picked_up', label: 'picked up', currentLocation: 'In transit', locationConfidence: 'verified' },
      { state: 'returned_home', label: 'returned home', currentLocation: 'Fowlerville', locationConfidence: 'verified' },
      { state: 'source_reported', label: 'Source-reported location', currentLocation: 'Fowlerville', locationConfidence: 'reported' },
    ]) {
      const record = base({ homeStore: 'Fowlerville', movement })
      const vehicle = toPanelVehicle(record, data(record))
      expect(vehicle.moveRequestBlocked).toBeNull()
      expect(canRequestVehicle(vehicle, sales)).toBe(!vehicle.movement)
      expect(requestBlockedReason(vehicle, sales)).toBe(vehicle.movement ? 'A move is already in progress.' : null)
    }
    // The per-vehicle record replaces the bootstrap movement wholesale, carrying the bit with it.
    const merged = toPanelVehicle(mergeDetail(base({ homeStore: 'Fowlerville' }), { ...canceledRecord, privateEvidence: { comments: [], alerts: [] } }), data(canceledRecord))
    expect(merged.moveRequestBlocked).toBe(false)
    expect(canRequestVehicle(merged, sales)).toBe(true)
  })

  it('drops unofficial document and photo urls and splits features', () => {
    const record = base({ features: 'Heated Seats | Heated Seats, Tow Package', imageUrls: ['https://www.bobmaxeyfordhowell.com/inventoryphotos/1.jpg', 'http://insecure.example/x.jpg'], listingUrl: 'https://evil.example/used-x', autoCheckReport: { url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=a', score: 91 }, windowSticker: { url: 'https://www.bobmaxeyfordhowell.com/somewhere-else', totalMsrp: 68420 } })
    const vehicle = toPanelVehicle(record, data(record))
    expect(vehicle.features).toEqual(['Heated Seats', 'Tow Package'])
    expect(vehicle.photos).toEqual(['https://www.bobmaxeyfordhowell.com/inventoryphotos/1.jpg'])
    expect(vehicle.listing.url).toBeNull()
    // Captured facts survive rejection of an incomplete or cross-host source URL.
    expect(vehicle.documents.autoCheck).toMatchObject({ url: null, score: 91 })
    expect(vehicle.documents.windowSticker.url).toBeNull()
  })

  it('summarizes the release for the footer', () => {
    const summary = buildPanelData(data(base({ hold: { state: 'primary', label: 'Held', backupCount: 0 } }), { meta: { heldVinCount: 1 }, access: { user: 'Demo', role: 'sales', store: 'Howell' } }))
    expect(summary.meta).toMatchObject({ reportDate: '2026-08-30', publicFreshness: 'current', dealerMailFreshness: 'current', heldVinCount: 1 })
    expect(summary.access.store).toBe('Howell')
    expect(summary.vehicles).toHaveLength(1)
  })
})

describe('deal desk v2 projections', () => {
  it('names the store certification, not a make program', () => {
    expect(certifiedProgram('Howell')).toMatchObject({ name: 'Ford Blue Certified', brand: 'ford' })
    expect(certifiedProgram('Lincoln')).toMatchObject({ name: 'Lincoln Certified Pre-Owned', brand: 'lincoln' })
    const chevyAtLincoln = base({ make: 'Chevrolet', homeStore: 'Lincoln', certified: true })
    expect(toPanelVehicle(chevyAtLincoln, data(chevyAtLincoln)).certifiedProgram.name).toBe('Lincoln Certified Pre-Owned')
    expect(toPanelVehicle(base(), data(base())).certifiedProgram).toBeNull()
  })

  it('exposes copyable pricing with the sticker winning over the vAuto label', () => {
    const record = base({ msrp: 68420, mileage: 12450, exteriorColor: 'Blue', modelCode: 'W1E', engine: '3.5L V6',
      windowSticker: { basePrice: 63420, totalOptions: 3005, destinationCharge: 1995, totalMsrp: 68420, pricingCurrency: 'USD', options: ['Twin Panel Moonroof'], warranty: ['3 yr / 36,000 mi'] },
      factoryEquipment: { basePrice: 60000, totalOptions: 1, destinationCharge: 1, totalMsrp: 60002, packages: [{ name: 'Sport', price: 3005, features: [] }] } })
    const vehicle = toPanelVehicle(record, data(record), { now: Date.UTC(2026, 8, 12) })
    const fields = Object.fromEntries(copyFields(vehicle).map((field) => [field.key, field]))
    expect(fields.base).toMatchObject({ value: 63420, from: 'sticker', kind: 'money' })
    expect(fields.destination).toMatchObject({ value: 1995, from: 'sticker' })
    expect(fields.options).toMatchObject({ value: 3005 })
    expect(fields.mileage).toMatchObject({ value: 12450, kind: 'mileage' })
    expect(fields.modelCode.value).toBe('W1E')
    expect(vehicle.savings).toBe(68420 - 51800)
    expect(vehicle.documents.windowSticker.warranty).toEqual(['3 yr / 36,000 mi'])
    expect(vehicle.documents.factoryEquipment.packages[0]).toMatchObject({ name: 'Sport', price: 3005 })
    expect(vehicle.equipment.byCategory.find((group) => group.category === 'comfort').items[0].label).toBe('Twin Panel Moonroof')
    const sheet = dealSheetText(vehicle, (field) => String(field.value))
    expect(sheet).toContain('Base MSRP: 63420')
    expect(sheet).toContain('DealerMail: No current DealerMail hold found')
    expect(sheet).not.toContain('Salesperson')
  })

  it('attaches the warranty outlook and Ford dealer-tool links only for Ford and Lincoln', () => {
    const ford = base({ autoCheckReport: { estimatedInServiceDate: '2024-03-14', checks: [{ label: 'Accident check', status: 'No accidents reported' }] } })
    const vehicle = toPanelVehicle(ford, data(ford), { now: Date.UTC(2026, 8, 12) })
    expect(vehicle.links.oasis).toContain('oasis/Index?vin=TESTDATAHWELL0001')
    expect(vehicle.links.invoice).toContain('GetInvoice.aspx?v=TESTDATAHWELL0001')
    expect(vehicle.warranty.inService.date).toBe('2024-03-14')
    expect(vehicle.warranty.coverages[0]).toMatchObject({ key: 'basic', status: 'partial' })
    expect(vehicle.documents.autoCheck.checks[0].tone).toBe('clear')
    const chevy = base({ make: 'Chevrolet' })
    expect(toPanelVehicle(chevy, data(chevy)).links).toEqual({ oasis: null, invoice: null })
  })
})
