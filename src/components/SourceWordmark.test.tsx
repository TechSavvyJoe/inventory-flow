import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SourceWordmark } from './SourceWordmark'

describe('SourceWordmark', () => {
  it('shows the explicit provider mark beside its readable source label and keeps the label if loading fails', () => {
    render(<SourceWordmark brand="carfax" label="CARFAX service history" />)
    expect(screen.getByText('CARFAX service history')).toBeVisible()
    const mark = screen.getByRole('presentation', { hidden: true })
    expect(mark).toHaveAttribute('src', '/resource-brands/carfax.svg')

    fireEvent.error(mark)
    expect(screen.queryByRole('presentation', { hidden: true })).not.toBeInTheDocument()
    expect(screen.getByText('CARFAX service history')).toBeVisible()
  })

  it('keeps an explicit OEM source label without guessing a provider logo', () => {
    render(<SourceWordmark brand={null} label="OEM service records" />)
    expect(screen.getByText('OEM service records')).toBeVisible()
    expect(screen.queryByRole('presentation', { hidden: true })).not.toBeInTheDocument()
  })
})
