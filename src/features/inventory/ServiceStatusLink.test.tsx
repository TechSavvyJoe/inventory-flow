import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ServiceReadiness } from '../../types'
import { ServiceStatusLink } from './ServiceStatusLink'
afterEach(cleanup)

describe('service status shared across inventory and vehicle details', () => {
  it('shows missing service confirmation as waiting without creating a completion date', () => {
    render(<ServiceStatusLink vin="TESTDATAHWELL0001" detailed />)
    const link = screen.getByRole('link', { name: 'Waiting for service. Open service status for VIN TESTDATAHWELL0001' })
    expect(link).toHaveTextContent(/^Waiting for service$/)
    expect(link).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001')
    expect(link).toHaveAttribute('title', expect.stringContaining('service workflow'))
  })

  it.each([
    ['unknown', 'Waiting for service'], ['needs_service', 'Waiting for service'], ['in_service', 'In service'], ['serviced', 'Ready'],
  ] as const)('uses the visible three-state vocabulary for %s', (status, label) => {
    render(<ServiceStatusLink vin="TESTDATAHWELL0001" service={{ status } as ServiceReadiness} />)
    expect(screen.getByRole('link')).toHaveTextContent(label)
    expect(screen.getByRole('link')).not.toHaveTextContent(/unknown|review|checked/i)
  })

  it('shows an actual manager completion date when one exists', () => {
    render(<ServiceStatusLink vin="TESTDATAHWELL0001" detailed service={{ status: 'serviced', completedAt: '2026-08-30' } as ServiceReadiness} />)
    expect(screen.getByRole('link')).toHaveTextContent('Ready · 08/30/2026')
  })
})
