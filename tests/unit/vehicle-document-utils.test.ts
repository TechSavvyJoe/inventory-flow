import { describe, expect, it } from 'vitest'
import {
  autoCheckResultTone,
  dealerMailInteractiveVehicleUrl,
  fordInvoiceUrl,
  fordOasisUrl,
  fordServiceHistoryUrl,
  officialVehicleDocumentUrl,
  vautoFactoryEquipmentUrl,
} from '../../src/features/inventory/vehicle-document-utils'

describe('dealerMailInteractiveVehicleUrl', () => {
  it('opens the full interactive four-store screen and rejects blank stock', () => {
    expect(dealerMailInteractiveVehicleUrl(' W5863Q ')).toBe(
      'https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp?selectedStore=26,25,27,95',
    )
    expect(dealerMailInteractiveVehicleUrl('A/B 123')).toBe(
      'https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp?selectedStore=26,25,27,95',
    )
    expect(dealerMailInteractiveVehicleUrl('   ')).toBeNull()
    expect(dealerMailInteractiveVehicleUrl('W5863Q')).not.toContain('byItem=')
    expect(dealerMailInteractiveVehicleUrl('W5863Q')).not.toContain('USED_hold_edit')
  })
})

describe('vautoFactoryEquipmentUrl', () => {
  it('accepts only the read-only CAI informational equipment PDF or image route', () => {
    const valid = 'https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg'
    expect(vautoFactoryEquipmentUrl(valid)).toBe(valid)
    expect(vautoFactoryEquipmentUrl(valid.replace('.jpg', '.pdf'))).toBe(valid.replace('.jpg', '.pdf'))
    expect(vautoFactoryEquipmentUrl(valid.replace('assets.cai-media-management.com', 'evil.example'))).toBeNull()
    expect(vautoFactoryEquipmentUrl(`${valid}?next=https://evil.example`)).toBeNull()
    expect(vautoFactoryEquipmentUrl(valid.replace('.jpg', '.png'))).toBeNull()
  })
})

describe('external Ford document URLs', () => {
  it('keeps synthetic fixture identifiers away from live OEM sign-in and supports real VINs', () => {
    for (const url of [fordInvoiceUrl, fordOasisUrl, fordServiceHistoryUrl]) {
      expect(url('TESTDATASYN000001')).toBeNull()
      expect(url(' testdatahwell0001 ')).toBeNull()
    }
    expect(fordOasisUrl('1FTFW1E84RKF12345')).toBe(
      'https://www.fordtechservice.dealerconnection.com/oasis/Index?vin=1FTFW1E84RKF12345',
    )
    expect(fordInvoiceUrl('1FTFW1E84RKF12345')).toContain('https://fordvisions.dealerconnection.com/vinv/GetInvoice.aspx?v=1FTFW1E84RKF12345')
    expect(fordServiceHistoryUrl('1FTFW1E84RKF12345')).toContain('https://www.fordtechservice.dealerconnection.com/VehicleService/Index?VIN=1FTFW1E84RKF12345')
    expect(fordOasisUrl('NOT-A-VIN')).toBeNull()
  })
})

describe('officialVehicleDocumentUrl', () => {
  const listing = 'https://www.bobmaxeyfordhowell.com/used-Howell-test-TESTDATASYN000001'

  it('accepts only exact official AutoCheck routes on the vehicle website', () => {
    const valid = 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token'
    expect(officialVehicleDocumentUrl(valid, 'autocheck', listing)).toBe(valid)
    expect(officialVehicleDocumentUrl('https://evil.example/autocheck.aspx?sv=x&ac=y', 'autocheck', listing)).toBeNull()
    expect(officialVehicleDocumentUrl(`${valid}&redirect=https://evil.example`, 'autocheck', listing)).toBeNull()
    expect(officialVehicleDocumentUrl(valid.replace('fordhowell', 'ford'), 'autocheck', listing)).toBeNull()
  })

  it('accepts the two official sticker query forms, including Fowlerville dealerCode', () => {
    const standard = 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U'
    const fowlerville = 'https://www.bobmaxeyfordinfowlerville.com/api/vhcliaa/inventory/23328/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U&dealerCode='
    expect(officialVehicleDocumentUrl(standard, 'window-sticker', listing)).toBe(standard)
    expect(officialVehicleDocumentUrl(fowlerville, 'window-sticker')).toBe(fowlerville)
    expect(officialVehicleDocumentUrl(`${standard}&next=https://evil.example`, 'window-sticker', listing)).toBeNull()
  })
})

describe('autoCheckResultTone', () => {
  it('distinguishes explicit clean results from review and unknown results', () => {
    expect(autoCheckResultTone('No Issue')).toBe('clear')
    expect(autoCheckResultTone('No open recalls')).toBe('clear')
    expect(autoCheckResultTone('No accidents or damage reported')).toBe('clear')
    expect(autoCheckResultTone('No title brands reported.')).toBe('clear')
    expect(autoCheckResultTone('Accident or damage reported')).toBe('review')
    expect(autoCheckResultTone('No CPO Info Available')).toBe('review')
    expect(autoCheckResultTone('')).toBe('unknown')
  })
})
