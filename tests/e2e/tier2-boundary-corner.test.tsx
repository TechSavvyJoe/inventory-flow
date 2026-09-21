import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { premiumVehicle, showPremiumVehicle } from '../unit/premium-test-helpers'

afterEach(cleanup)
describe('Premium record boundary and source-truth cases', () => {
  it('renders sparse records without inventing source documents or completion', () => {
    showPremiumVehicle(premiumVehicle({ autoCheckReport: null, windowSticker: null, factoryEquipment: null, fordOasis: null, warrantyCheck: null, serviceReadiness: undefined }))
    fireEvent.click(screen.getByRole('tab', { name: 'Records' }))
    expect(screen.getByRole('tabpanel', { name: 'Records' })).toHaveTextContent('No vehicle records are available')
    expect(screen.queryByText('Ready for delivery')).not.toBeInTheDocument()
  })
  it('shows stale evidence as requiring review instead of availability', () => {
    const vehicle = premiumVehicle()
    showPremiumVehicle({ ...vehicle, publicListing: { ...vehicle.publicListing, dataState: 'stale' }, dealerMail: { ...vehicle.dealerMail, dataState: 'stale', hasActiveHold: false }, holdEvidence: [] })
    expect(screen.getByRole('dialog')).toHaveTextContent('Listing unverified')
    expect(screen.getByRole('dialog')).toHaveTextContent('Hold status unverified')
    expect(screen.queryByText(/^Available$/)).not.toBeInTheDocument()
  })
  it('renders private hold notes as text rather than executable markup', () => {
    const note = '<script>globalThis.inventoryInjection=true</script>'
    showPremiumVehicle(premiumVehicle({ holdEvidence: [{ id: 'note', position: 'primary', customerOrReason: note }] }), { initialTab: 'hold' })
    expect(screen.getByRole('tabpanel', { name: 'Holds & moves' })).toHaveTextContent(note)
    expect(document.querySelector('script')).toBeNull()
  })
  it('does not show private evidence denied by the vehicle projection', () => {
    const vehicle = premiumVehicle()
    showPremiumVehicle({ ...vehicle, dealerMail: { ...vehicle.dealerMail, canViewEvidence: false, canManageHold: false }, holdEvidence: [], dealerMailEvidence: undefined }, { initialTab: 'hold' })
    expect(screen.queryByText('Reserved for delivery')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open DealerMail/i })).not.toBeInTheDocument()
  })
  it('keeps independent manager outcome evidence separate from inventory listing', () => {
    showPremiumVehicle(premiumVehicle({ managerDisposition: { soldLabel: 'Sold pending', deliveryLabel: 'Delivery not confirmed' } as never }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Sold pending')
    expect(screen.getByRole('dialog')).toHaveTextContent('Delivery not confirmed')
    expect(screen.getByRole('dialog')).toHaveTextContent('Independent of listing, hold, CDK, and location')
  })
  it('preserves original document currency qualification', () => {
    const vehicle = premiumVehicle()
    showPremiumVehicle({ ...vehicle, windowSticker: { ...vehicle.windowSticker!, pricingCurrency: 'CAD', basePrice: 70000, originalMarket: 'Canada' } }, { initialTab: 'data' })
    expect(screen.getByRole('tabpanel', { name: 'Records' })).toHaveTextContent('CA')
  })
  it('handles no photos and a long model without removing navigation', () => {
    showPremiumVehicle(premiumVehicle({ imageUrl: null, imageUrls: [], photoCount: 0, model: 'Synthetic long model '.repeat(12) }))
    expect(screen.getByRole('button', { name: 'Back to inventory' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Records' })).toBeInTheDocument()
  })
})
