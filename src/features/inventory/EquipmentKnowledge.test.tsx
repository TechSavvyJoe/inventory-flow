import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { InventoryVehicle } from './types'
import { EquipmentKnowledge } from './EquipmentKnowledge'

afterEach(cleanup)
describe('vehicle equipment sales guide', () => {
  it('keeps manufacturer guidance separate from VIN equipment and exposes an applicable official guide', () => {
    const vehicle = { year:2024, make:'Lincoln', model:'Nautilus', features:['Revel Ultima 3D Audio System', 'Perfect Position Seats'] } as InventoryVehicle
    render(<EquipmentKnowledge vehicle={vehicle} />)
    const summary = screen.getByText('Sales guide · packages & feature differences')
    fireEvent.click(summary)
    expect(summary.closest('details')).toHaveAttribute('open')
    expect(screen.getByText(/these guides explain features and differences/)).toBeVisible()
    expect(screen.getByRole('link', { name:'2024 Nautilus features & available packages' })).toHaveAttribute('href', expect.stringContaining('lincoln-nautilus'))
    expect(screen.getByText('Revel audio demonstration')).toBeVisible()
    expect(screen.queryByText(/28 speakers/)).not.toBeInTheDocument()
  })

  it('does not create feature prompts from an incomplete equipment document', () => {
    const vehicle = { year:2024, make:'Lincoln', model:'Nautilus', features:[], windowSticker:{ dataState:'incomplete', options:['Revel Ultima 3D'] } } as unknown as InventoryVehicle
    render(<EquipmentKnowledge vehicle={vehicle} />)
    expect(screen.queryByText('Revel audio demonstration')).not.toBeInTheDocument()
  })
})
