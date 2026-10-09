// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import type { ServiceReadinessDetail } from '../../src/types'

const vin = 'TESTDATAHWELL0001'
const initialService: ServiceReadinessDetail = { vin, status: 'needs_service', version: 0, serviceEnteredAt: null, completedAt: null, updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: 'Howell', canManage: true, notes: 'Synthetic inspection needed', history: [] }
const vehicle = { vin, stockNumber: 'DEMO-RECOVERY', vehicleName: 'Synthetic Ford Recovery', homeStore: 'Howell', publicStore: 'Howell', listedPrice: 25000, mileage: 10000, serviceReadiness: initialService, publicListing: 'listed', canReportIssue: true, dealerOn: {inStock: true, inTransit: false, inProduction: false}, movement: {state: 'source_reported', currentLocation: 'Howell', locationConfidence: 'reported'}, hold: {state: 'none_observed', backups: [], commentsCount: 0, alertsCount: 0} }
const issue = { id: 'synthetic-recovery-issue', vin, stockNumber: vehicle.stockNumber, vehicleName: vehicle.vehicleName, homeStore: 'Howell', reportStore: 'Howell', category: 'cleaning', priority: 'normal', description: 'Synthetic cleanup needed', status: 'open', version: 1, assignee: null, reportedBy: 'Synthetic manager', reportedByUserId: 'synthetic-manager', reportedAt: '2026-10-08T12:00:00Z', updatedAt: '2026-10-08T12:00:00Z', completedAt: null, completedBy: null, photoCount: 0, allowedActions: ['assign', 'add_note'], events: [], photos: [] }
function bootstrap(service = initialService, issues: typeof issue[] = []) {
  return {
    access: { user: 'Synthetic manager', userId: 'synthetic-manager', role: 'manager', store: 'Howell', canViewPrivateEvidence: true, canCreateTransfer: true },
    meta: { reportDate: '2026-10-08', completedAt: '2026-10-08T12:00:00Z', timezone: 'America/New_York', publicFreshness: 'current', dealerMailFreshness: 'current', publicCount: 1, crmCount: 0, heldVinCount: 0, publicChangeCounts: { newArrival: 0, removed: 0, priceChange: 0, mileageChange: 0, websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 0 }, holdChangeStatus: 'baseline', warnings: [] },
    stores: [], vehicles: [{ ...vehicle, serviceReadiness: service }], transfers: [], attention: [], publicChanges: [], vehicleIssues: issues, vehicleIssuesEnabled: true,
  }
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Workflow recovery with the real API client and data provider', () => {
  it('keeps a direct service save successful and retries only the failed bootstrap read', async () => {
    let failRefresh = false
    let service = initialService
    const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input)
      if (path.startsWith('/api/bootstrap')) return failRefresh ? Response.json({error: 'Synthetic read unavailable'}, {status: 503}) : Response.json(bootstrap(service))
      if (path === `/api/vehicles/${vin}/service`) {
        if (options?.method === 'POST') { service = { ...initialService, status: 'in_service', version: 1, serviceEnteredAt: '2026-10-08' }; failRefresh = true }
        return Response.json(service)
      }
      throw new Error(`Unexpected synthetic request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<MemoryRouter initialEntries={[`/service?vin=${vin}&action=in_service`]}><App/></MemoryRouter>)
    const editor = await screen.findByRole('complementary', {name: `Service for ${vehicle.vehicleName}`}, {timeout: 5000})
    fireEvent.click(await within(editor).findByRole('button', {name: 'Save service status'}))
    expect(await screen.findByText(`In service saved for ${vehicle.stockNumber}.`)).toBeInTheDocument()
    expect(await screen.findByText('Your changes were saved. Refresh is still needed.')).toBeInTheDocument()
    expect(within(editor).getByRole('region', {name: 'Recorded service status'})).toHaveTextContent('In service')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    failRefresh = false
    fireEvent.click(screen.getByRole('button', {name: 'Retry update'}))
    await waitFor(() => expect(screen.queryByText('Your changes were saved. Refresh is still needed.')).not.toBeInTheDocument())
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it('keeps a vehicle issue report successful and refreshes its list without posting the report twice', async () => {
    let failRefresh = false
    let issues: typeof issue[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input)
      if (path.startsWith('/api/bootstrap')) return failRefresh ? Response.json({error: 'Synthetic read unavailable'}, {status: 503}) : Response.json(bootstrap(initialService, issues))
      if (path === `/api/vehicles/${vin}/issues` && options?.method === 'POST') { issues = [issue]; failRefresh = true; return Response.json(issue) }
      if (path === `/api/vehicle-issues/${issue.id}`) return Response.json(issue)
      throw new Error(`Unexpected synthetic request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<MemoryRouter initialEntries={['/attention?category=issues']}><App/></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', {name: 'Report issue'}, {timeout: 5000}))
    fireEvent.click(await screen.findByRole('button', {name: new RegExp(vehicle.vehicleName)}))
    const report = screen.getByRole('dialog', {name: 'Report a vehicle issue'})
    fireEvent.change(within(report).getByLabelText('What needs attention?'), {target: {value: issue.description}})
    fireEvent.click(within(report).getByRole('button', {name: 'Report issue'}))
    expect(await screen.findByText(`Issue reported for stock ${vehicle.stockNumber}.`)).toBeInTheDocument()
    expect(await screen.findByText('Your changes were saved. Refresh is still needed.')).toBeInTheDocument()
    // Close the saved detail before reviewing the recovered issue list.
    fireEvent.click(await screen.findByRole('button', {name: 'Close vehicle issue'}))
    failRefresh = false
    fireEvent.click(screen.getByRole('button', {name: 'Retry update'}))
    await waitFor(() => expect(screen.queryByText('Your changes were saved. Refresh is still needed.')).not.toBeInTheDocument())
    expect(screen.getByRole('list', {name: 'Reported vehicle issues'})).toHaveTextContent(issue.description)
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })
})
