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

  it('identifies AutoCheck as the non-Ford readiness source', () => {
    render(<ServiceStatusLink vin="TESTDATAHWELL0001" detailed service={{
      status: 'serviced', readinessEvidence: { source: 'autocheck', inspectionDate: '2026-09-10', types: ['Vehicle Inspected'] },
    } as ServiceReadiness} />)
    expect(screen.getByRole('link')).toHaveTextContent('Ready · AutoCheck inspected 09/10/2026')
    expect(screen.getByRole('link')).toHaveAttribute('title', expect.stringContaining('AutoCheck'))
  })

  it('shows Ford service start and ready dates as the Ford and Lincoln readiness source', () => {
    render(<ServiceStatusLink vin="TESTDATAHWELL0001" detailed service={{
      status: 'serviced', readinessEvidence: {
        source: 'ford_service_history', inspectionDate: '2026-09-11', inServiceDate: '2026-08-14', readyDate: '2026-09-11', types: ['Certified Blue Oval inspection'],
      },
    } as ServiceReadiness} />)
    expect(screen.getByRole('link')).toHaveTextContent('Ready · Ford service 08/14/2026 · ready 09/11/2026')
    expect(screen.getByRole('link')).toHaveAttribute('title', expect.stringContaining('Ford service-history'))
  })
})
