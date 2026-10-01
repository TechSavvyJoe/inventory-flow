import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VehicleQuickFacts } from './VehicleQuickFacts'

afterEach(cleanup)
describe('vehicle quick facts', () => {
  it('retains complete configuration values with accessible field context', () => {
    render(<VehicleQuickFacts vehicle={{ engine:'3.5L EcoBoost V6', drivetrain:'4WD', exteriorColor:'Antimatter Blue', interiorColor:'Black', transmission:'10-Speed Automatic', fuelType:'Gasoline' }} />)
    const facts = screen.getByRole('group', { name:'Vehicle quick facts' })
    expect(facts).toHaveTextContent('3.5L EcoBoost V6 · 4WD')
    expect(screen.getByLabelText('Exterior / interior: Antimatter Blue / Black')).toBeVisible()
    expect(screen.getByLabelText('Transmission / fuel: 10-Speed Automatic · Gasoline')).toBeVisible()
  })

  it('omits invalid fuel-economy sentinels without dropping a valid partial value', () => {
    const { rerender } = render(<VehicleQuickFacts vehicle={{ mpgCity:0, mpgHighway:-1 }} />)
    expect(screen.queryByRole('group', { name:'Vehicle quick facts' })).not.toBeInTheDocument()
    rerender(<VehicleQuickFacts vehicle={{ mpgCity:0, mpgHighway:24 }} />)
    expect(screen.getByRole('group', { name:'Vehicle quick facts' })).toHaveTextContent('24 hwy MPG')
    expect(screen.queryByText(/0 city/)).not.toBeInTheDocument()
  })
})
