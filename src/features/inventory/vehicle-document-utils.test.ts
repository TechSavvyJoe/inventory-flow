import { describe, expect, it } from 'vitest'
import {
  DEALERMAIL_INTERACTIVE_INVENTORY_URL,
  dealerMailInteractiveVehicleUrl,
  fordInvoiceUrl,
  fordOasisUrl,
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
    const invoice = fordInvoiceUrl('2lmpj8j91lbl11561')
    const oasis = fordOasisUrl('2lmpj8j91lbl11561')

    expect(invoice).toContain('fordvisions.dealerconnection.com/vinv/GetInvoice.aspx')
    expect(invoice).toContain('v=2LMPJ8J91LBL11561')
    expect(oasis).toBe(
      'https://www.fordtechservice.dealerconnection.com/oasis/Index?vin=2LMPJ8J91LBL11561',
    )
  })

  it('rejects missing or invalid VINs', () => {
    expect(fordInvoiceUrl('')).toBeNull()
    expect(fordOasisUrl('NOT-A-VIN')).toBeNull()
  })
})
