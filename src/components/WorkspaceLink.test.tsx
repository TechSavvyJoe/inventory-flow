import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { WorkspaceLink } from './WorkspaceLink'

function Destination() {
  const location = useLocation()
  return <p>{location.pathname}{location.search}</p>
}

describe('workspace navigation', () => {
  it('uses router navigation and carries the exact originating vehicle view', () => {
    render(<MemoryRouter initialEntries={['/inventory?vin=TESTDATAHWELL0001&tab=data']}><Routes>
      <Route path="/inventory" element={<WorkspaceLink to="/service?vin=TESTDATAHWELL0001" preserveOrigin>Service</WorkspaceLink>} />
      <Route path="/service" element={<Destination />} />
    </Routes></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Service' })
    expect(link).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001&returnTo=%2Finventory%3Fvin%3DTESTDATAHWELL0001%26tab%3Ddata')
    fireEvent.click(link)
    expect(screen.getByText('/service?vin=TESTDATAHWELL0001&returnTo=%2Finventory%3Fvin%3DTESTDATAHWELL0001%26tab%3Ddata')).toBeInTheDocument()
  })

  it('keeps a normal usable anchor in standalone previews', () => {
    render(<WorkspaceLink to="/service?vin=TESTDATAHWELL0001" preserveOrigin>Service</WorkspaceLink>)
    expect(screen.getByRole('link', { name: 'Service' })).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001')
  })
})
