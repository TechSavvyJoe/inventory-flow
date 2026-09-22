import { describe, expect, it } from 'vitest'
import {
  DEALERMAIL_INTERACTIVE_INVENTORY_URL,
  availableWindowStickerUrl,
  dealerMailInteractiveVehicleUrl,
  fordInvoiceUrl,
  fordOasisUrl,
  savedFordInvoiceUrl,
} from './vehicle-document-utils'

describe('interactive DealerMail and Ford document destinations', () => {
  it('uses DealerMail full inventory chrome instead of inert result fragments', () => {
    expect(dealerMailInteractiveVehicleUrl('T0538U')).toBe(DEALERMAIL_INTERACTIVE_INVENTORY_URL)
    expect(dealerMailInteractiveVehicleUrl(' H-13578P ')).toBe(DEALERMAIL_INTERACTIVE_INVENTORY_URL)
    expect(dealerMailInteractiveVehicleUrl('')).toBeNull()

    const destination = dealerMailInteractiveVehicleUrl('T0538U') ?? ''
    expect(destination).toContain('selectedStore=26,25,27,95')
    expect(destination).not.toContain('byItem=')
    expect(destination).not.toContain('USED_hold_edit')
  })

  it('builds exact-VIN read-only Invoice and OASIS destinations', () => {
    const invoice = fordInvoiceUrl('testdatasyn000010')
    const oasis = fordOasisUrl('testdatasyn000010')

    expect(invoice).toContain('fordvisions.dealerconnection.com/vinv/GetInvoice.aspx')
    expect(invoice).toContain('v=TESTDATASYN000010')
    expect(savedFordInvoiceUrl('testdatasyn000010')).toBe('/api/vehicles/TESTDATASYN000010/invoice')
    expect(oasis).toBe(
      'https://www.fordtechservice.dealerconnection.com/oasis/Index?vin=TESTDATASYN000010',
    )
  })

  it('rejects missing or invalid VINs', () => {
    expect(fordInvoiceUrl('')).toBeNull()
    expect(savedFordInvoiceUrl('NOT-A-VIN')).toBeNull()
    expect(fordOasisUrl('NOT-A-VIN')).toBeNull()
  })

  it('does not advertise an incomplete Ford placeholder PDF as an available sticker', () => {
    const url = 'https://www.bobmaxeyfordinfowlerville.com/api/vhcliaa/inventory/23328/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U'
    expect(availableWindowStickerUrl({ dataState: 'current', url })).toBe(url)
    expect(availableWindowStickerUrl({ dataState: 'incomplete', url })).toBeNull()
    expect(availableWindowStickerUrl({ dataState: 'unavailable', url })).toBeNull()
  })
})
