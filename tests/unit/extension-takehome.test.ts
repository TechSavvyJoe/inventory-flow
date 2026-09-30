// @vitest-environment jsdom
// @ts-nocheck -- dependency-free ESM; synthetic fixtures only.
import { describe, expect, it, vi } from 'vitest'
import { renderTakeHome, takeHomeModel } from '../../extension/sidepanel/lib/takehome.mjs'
import { normalizeTakeHomeDocument, publicListingLinks, shareTakeHomeHtml, standaloneTakeHomeHtml } from '../../extension/sidepanel/lib/takehome-export.mjs'
import { toPanelVehicle } from '../../extension/sidepanel/lib/model.mjs'

const meta = { reportDate: '2026-08-30', completedAt: '2026-08-30T10:00:00-04:00', publicFreshness: 'current', dealerMailFreshness: 'current' }
const record = {
  vin: 'TESTDATAHWELL0001', stockNumber: 'DEMO-H01', year: 2024, make: 'Ford', model: 'F-150', trim: 'Lariat', vehicleName: '2024 Ford F-150 Lariat',
  listedPrice: 51800, msrp: 68420, mileage: 12450, daysListed: 43, bodyStyle: 'SuperCrew', drivetrain: '4WD', engine: '3.5L EcoBoost V6', transmission: '10-Speed Automatic', fuelType: 'Gasoline', mpgCity: 18, mpgHighway: 24,
  exteriorColor: 'Antimatter Blue Metallic', interiorColor: 'Black', certified: true, dealerComments: 'Synthetic description.', features: 'BlueCruise | Heated Front Seats',
  homeStore: 'Howell', publicStore: 'Howell', sourceReportedLocation: 'Howell', listingUrl: 'https://www.bobmaxeyfordhowell.com/used-Howell-2024-Ford-F150-TESTDATAHWELL0001',
  imageUrls: ['https://www.bobmaxeyfordhowell.com/photos/1.jpg', 'http://insecure.example/2.jpg'],
  websiteStatus: 'Listed', publicListingState: 'Listed publicly', dealerOn: { inStock: true, inTransit: false, inProduction: false },
  hold: { state: 'primary', label: 'Held · Demo Salesperson', backupCount: 0, canViewEvidence: true, primarySalesperson: 'Demo Salesperson', reason: 'Customer appointment' },
  movement: { transferId: 'transfer-1', state: 'in_transit', currentLocation: 'Fowlerville', locationConfidence: 'verified', currentCustodian: 'Demo Driver', newRequestBlocked: true },
  autoCheckReport: { score: 91, ownerCount: 1, estimatedInServiceDate: '2024-03-14', checks: [] },
}

describe('take-home sheet model', () => {
  it('carries only published, customer-facing facts', () => {
    const vehicle = toPanelVehicle(record, { meta, transfers: [], vehicles: [record] })
    const model = takeHomeModel(vehicle, vehicle.photos)
    expect(model).toMatchObject({ store: 'Howell', storeName: 'Bob Maxey Ford of Howell', storeSite: 'bobmaxeyfordhowell.com', name: '2024 Ford F-150 Lariat', stockNumber: 'DEMO-H01', price: 51800, msrp: 68420, savings: 16620, mileage: 12450 })
    expect(model.brand.src).toBe('../brands/bob-maxey-ford.png')
    expect(model.certified.name).toBe('Ford Blue Certified')
    expect(model.photos).toEqual(['https://www.bobmaxeyfordhowell.com/photos/1.jpg'])
    expect(model.specs.map(([label]) => label)).toEqual(['Body', 'Drivetrain', 'Engine', 'Transmission', 'Fuel', 'Fuel economy', 'Exterior', 'Interior'])
    expect(model.highlights).toContain('BlueCruise')
    expect(model.history).toBe('AutoCheck score 91 · 1 owner reported')
    expect(model.description).toBe('Synthetic description.')
    const serialized = JSON.stringify(model)
    // Operational facts, custody, and the internal warranty estimate must never leave the panel.
    for (const forbidden of ['Demo Salesperson', 'Customer appointment', 'Fowlerville', 'Demo Driver', 'transfer-1', 'hold', 'inService', '2024-03-14', 'Bumper-to-bumper', 'expiresOn', 'monthsRemaining', 'OASIS', 'RequestBlocked']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('names the Lincoln store certification for Lincoln-store vehicles', () => {
    const lincoln = { ...record, homeStore: 'Lincoln', publicStore: 'Lincoln', make: 'Chevrolet', model: 'Equinox', vehicleName: '2022 Chevrolet Equinox' }
    const model = takeHomeModel(toPanelVehicle(lincoln, { meta, transfers: [], vehicles: [lincoln] }), [])
    expect(model.certified.name).toBe('Lincoln Certified Pre-Owned')
    expect(model.brand.src).toBe('../brands/lincoln.png')
    expect(model.photos).toEqual([])
  })

  it('normalizes legacy and multi-vehicle handoffs while deduplicating VINs', () => {
    const first = takeHomeModel(toPanelVehicle(record, { meta, transfers: [], vehicles: [record] }), [])
    const secondRecord = { ...record, vin:'TESTDATAHWELL0002', stockNumber:'DEMO-H02', listingUrl:'https://www.bobmaxeyfordhowell.com/used-Synthetic-2' }
    const second = takeHomeModel(toPanelVehicle(secondRecord, { meta, transfers: [], vehicles: [secondRecord] }), [])
    expect(normalizeTakeHomeDocument(first).models).toEqual([first])
    const payloadDocument = normalizeTakeHomeDocument({ version:2, listLabel:'Jamie choices', models:[first, second, first] })
    expect(payloadDocument.listLabel).toBe('Jamie choices')
    expect(payloadDocument.models.map((model) => model.vin)).toEqual([first.vin, second.vin])
    expect(publicListingLinks(payloadDocument.models)).toEqual([first.listingUrl, second.listingUrl])
    const stage = document.createElement('main')
    stage.replaceChildren(...payloadDocument.models.map((model) => renderTakeHome(model)))
    expect(stage.querySelectorAll('article.th')).toHaveLength(2)
    expect([...stage.querySelectorAll('.th-listing-link')].map((link) => link.getAttribute('href'))).toEqual([first.listingUrl, second.listingUrl])
  })

  it('escapes standalone HTML and strips unsafe destinations', () => {
    const root = document.createElement('div')
    root.innerHTML = '<a href="javascript:alert(1)">Unsafe</a><p>&lt;customer&gt;</p>'
    const html = standaloneTakeHomeHtml(root, '<script>alert(1)</script>', '.th{color:#102238}')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;customer&gt;')
  })

  it('does not copy or download when native share is cancelled', async () => {
    const writeText = vi.fn()
    const environment = { navigator:{ share:vi.fn().mockRejectedValue({ name:'AbortError' }), canShare:vi.fn(() => true), clipboard:{ writeText } } }
    await expect(shareTakeHomeHtml({ html:'<html></html>', title:'Choices', links:['https://example.com'], environment })).resolves.toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies public listing links when native file sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const environment = { navigator:{ clipboard:{ writeText } } }
    await expect(shareTakeHomeHtml({ html:'<html></html>', title:'Choices', links:['https://example.com/one','https://example.com/two'], environment })).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://example.com/one\nhttps://example.com/two')
  })
})
