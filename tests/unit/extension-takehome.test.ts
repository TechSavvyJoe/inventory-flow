// @vitest-environment jsdom
// @ts-nocheck -- dependency-free ESM; synthetic fixtures only.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, within } from '@testing-library/react'
import { renderTakeHome, takeHomeModel } from '../../extension/sidepanel/lib/takehome.mjs'
import { normalizeTakeHomeDocument, publicListingLinks, shareTakeHomePdf, downloadTakeHomePdf } from '../../extension/sidepanel/lib/takehome-export.mjs'
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
    expect(model).toMatchObject({ store: 'Howell', storeName: 'Bob Maxey Ford of Howell', storeSite: 'bobmaxeyfordhowell.com', name: '2024 Ford F-150 Lariat', stockNumber: 'DEMO-H01', price: 51800, mileage: 12450 })
    expect(model).not.toHaveProperty('factoryPrices')
    expect(model.brand.src).toBe('../brands/bob-maxey-ford.png')
    expect(model.certified.name).toBe('Ford Blue Certified')
    expect(model.photos).toEqual(['https://www.bobmaxeyfordhowell.com/photos/1.jpg'])
    expect(model.specs.map(([label]) => label)).toEqual(['Body', 'Drivetrain', 'Engine', 'Transmission', 'Fuel', 'Fuel economy', 'Exterior', 'Interior'])
    expect(model.highlights).toContain('BlueCruise')
    expect(model.history).toBe('AutoCheck score 91 · 1 owner reported')
    expect(model.description).toBe('Synthetic description.')
    expect(JSON.stringify(model)).not.toContain('68420')
    const serialized = JSON.stringify(model)
    // Operational facts, custody, and the internal warranty estimate must never leave the panel.
    for (const forbidden of ['Demo Salesperson', 'Customer appointment', 'Fowlerville', 'Demo Driver', 'transfer-1', 'hold', 'inService', '2024-03-14', 'Bumper-to-bumper', 'expiresOn', 'monthsRemaining', 'OASIS', 'RequestBlocked']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('carries captured adverse history detail into the customer sheet', () => {
    const adverse = {
      ...record,
      autoCheckReport: {
        dataState: 'current',
        score: 78,
        checks: [
          { label: 'Title', status: 'No issues found', detail: 'Salvage title reported' },
          { label: 'Insurance loss', status: '1 record reported', detail: 'Total loss reported' },
        ],
      },
    }
    const model = takeHomeModel(toPanelVehicle(adverse, { meta, transfers: [], vehicles: [adverse] }))
    expect(model.history).toBe('AutoCheck score 78 · Title: No issues found · Salvage title reported · Insurance loss: 1 record reported · Total loss reported')
    expect(renderTakeHome(model).textContent).toContain(model.history)
  })

  it('keeps every MSRP/reference-price field out of the customer sheet', () => {
    const panel = toPanelVehicle({...record,windowSticker:{dataState:'current',totalMsrp:62000,basePrice:50000,pricingCurrency:'CAD'}}, {meta,transfers:[],vehicles:[record]})
    const model = takeHomeModel(panel)
    expect(model).not.toHaveProperty('factoryPrices')
    const legacy = renderTakeHome({...model,factoryPrices:{original:{value:62000,source:'window-sticker',currency:'CAD'},base:{value:50000,source:'window-sticker',currency:'CAD'}},msrp:68420,savings:16620})
    expect(legacy.textContent).not.toContain('MSRP')
    expect(legacy.textContent).not.toContain('62,000')
    expect(legacy.textContent).not.toContain('68,420')
  })

  it('renders at most three distinct public photos in the customer sheet', () => {
    const panel = toPanelVehicle(record, {meta,transfers:[],vehicles:[record]})
    const photos = ['https://example.com/1.jpg','https://example.com/2.jpg','https://example.com/2.jpg','https://example.com/3.jpg','https://example.com/4.jpg']
    const sheet = renderTakeHome(takeHomeModel(panel, photos))
    expect([...sheet.querySelectorAll('.th-hero img')].map(image => image.getAttribute('src'))).toEqual(['https://example.com/1.jpg','https://example.com/2.jpg','https://example.com/3.jpg'])
  })

  it('promotes surviving photos and replaces failed images in the detailed printable document', () => {
    const panel = toPanelVehicle(record, {meta,transfers:[],vehicles:[record]})
    const model = { ...takeHomeModel(panel, ['https://example.com/hero.jpg','https://example.com/second.jpg','https://example.com/third.jpg']), brand:{ src:'https://example.com/logo.png', alt:'Synthetic dealership logo', wide:true } }
    const document = renderTakeHome(model), sheet = within(document)
    globalThis.document.body.append(document)
    const listing = sheet.getByRole('link', {name:/View vehicle listing/})
    listing.focus()
    fireEvent.error(sheet.getByRole('img', {name:model.name}))
    expect(listing).toHaveFocus()
    expect(sheet.getByRole('img', {name:model.name})).toHaveAttribute('src',model.photos[1])
    fireEvent.error(sheet.getByRole('img', {name:`${model.name} view 2`}))
    expect(sheet.queryByRole('img', {name:`${model.name} view 2`})).toBeNull()
    expect(sheet.getByRole('img', {name:model.name})).toHaveAttribute('src',model.photos[1])
    fireEvent.error(sheet.getByRole('img', {name:model.name}))
    expect(sheet.queryByRole('img', {name:model.name})).toBeNull()
    expect(sheet.getByText('Photos available at the store')).toBeTruthy()
    fireEvent.error(sheet.getByRole('img', {name:'Synthetic dealership logo'}))
    expect(sheet.queryByRole('img', {name:'Synthetic dealership logo'})).toBeNull()
    expect(sheet.getAllByText(model.storeName).length).toBeGreaterThan(1)
    const reopened = within(renderTakeHome(model))
    expect(reopened.getByRole('img', {name:model.name})).toHaveAttribute('src',model.photos[0])
    expect(reopened.getByRole('img', {name:'Synthetic dealership logo'})).toBeTruthy()
    document.remove()
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

  it('shares a PDF file with the correct MIME type and extension', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const environment = { navigator:{ share, canShare:vi.fn(() => true) } }
    await expect(shareTakeHomePdf({ pdf:new Blob(['%PDF-1.7'], { type:'application/pdf' }), title:'Choices', environment })).resolves.toBe('shared')
    const file = share.mock.calls[0][0].files[0]
    expect(file.name).toBe('choices.pdf')
    expect(file.type).toBe('application/pdf')
  })

  it('does not download when native share is cancelled', async () => {
    const createObjectURL = vi.fn()
    const environment = { navigator:{ share:vi.fn().mockRejectedValue({ name:'AbortError' }), canShare:vi.fn(() => true) }, URL:{ createObjectURL } }
    await expect(shareTakeHomePdf({ pdf:new Blob(['%PDF-1.7'], { type:'application/pdf' }), title:'Choices', environment })).resolves.toBe('cancelled')
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('downloads the PDF when native file sharing is unavailable', async () => {
    const click = vi.fn(), link = { click }, pdf = new Blob(['%PDF-1.7'], { type:'application/pdf' })
    const createObjectURL = vi.fn(() => 'blob:synthetic-pdf')
    const environment = { navigator:{}, URL:{ createObjectURL, revokeObjectURL:vi.fn() }, document:{ createElement:() => link } }
    await expect(shareTakeHomePdf({ pdf, title:'Choices', environment })).resolves.toBe('saved')
    expect(createObjectURL).toHaveBeenCalledWith(pdf)
    expect(link.download).toBe('choices.pdf')
    expect(click).toHaveBeenCalledOnce()
  })

  it('refuses HTML masquerading as a customer document', async () => {
    const html = new Blob(['<html>'], { type:'text/html' })
    await expect(shareTakeHomePdf({ pdf:html, title:'Choices' })).rejects.toThrow('PDF')
    expect(() => downloadTakeHomePdf(html, 'Choices')).toThrow('PDF')
  })
})
