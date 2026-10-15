import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PredictiveSearchInput } from './PredictiveSearchInput'

const candidates = [
  { id: '1', label: 'Synthetic Escape', detail: '#SYN-1', value: 'SYN-1', searchValues: ['Synthetic Escape', 'SYN-1', 'TESTDATAHWELL0001'] },
  { id: '2', label: 'Synthetic Bronco', detail: '#SYN-2', value: 'SYN-2', searchValues: ['Synthetic Bronco', 'SYN-2', 'TESTDATAHWELL0002'] },
]

function Harness() {
  const [value, setValue] = useState('Synthetic')
  return (
    <PredictiveSearchInput
      className="service-search"
      value={value}
      onChange={setValue}
      candidates={candidates}
      ariaLabel="Search service vehicles"
      clearLabel="Clear service search"
      placeholder="Search stock, VIN, model"
    />
  )
}

describe('PredictiveSearchInput', () => {
  it('shares Inventory keyboard behavior: arrows, Enter keeps query, Escape closes, clear is named', () => {
    render(<Harness />)

    const input = screen.getByRole('combobox', { name: 'Search service vehicles' })
    fireEvent.focus(input)
    expect(screen.getByRole('option', { name: /Suggestion:\s*Synthetic Escape/i })).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('SYN-1')

    fireEvent.change(input, { target: { value: 'Synthetic' } })
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('Synthetic')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear service search' }))
    expect(input).toHaveValue('')
  })
})
