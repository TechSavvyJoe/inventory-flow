import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, appendVehicleIssueEvent, createVehicleIssue, getVehicleIssue, getVehicleIssuePhoto } from '../../lib/api'
import { invalidateApiAccess } from '../../lib/apiSession'
import { VehicleWorkspace } from '../inventory/VehicleWorkspace'
import type { InventoryVehicle } from '../inventory/types'
import type { VehicleIssueDetail } from '../../types'
import { IssueDetail } from './IssueDetail'
import { IssueReportDialog } from './IssueReportDialog'
import { VehicleIssues } from './VehicleIssues'
import { IssuePhotoPicker, IssuePhotos, type DraftIssuePhoto } from './IssuePhotos'
import { prepareIssuePhoto } from './issue-photo'
import { canReportVehicleIssue, type VehicleIssueContext } from './issue-model'

vi.mock('../../lib/api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/api')>(), getVehicleIssue: vi.fn(), createVehicleIssue: vi.fn(), appendVehicleIssueEvent: vi.fn(), getVehicleIssuePhoto: vi.fn() }))
vi.mock('./issue-photo', () => ({ prepareIssuePhoto: vi.fn() }))

function issue(overrides: Partial<VehicleIssueDetail> = {}): VehicleIssueDetail {
  return { id: 'synthetic-issue', vin: 'TESTDATAHWELL0001', stockNumber: 'DEMO-H01', vehicleName: '2024 Ford F-150', homeStore: 'Howell', reportStore: 'Howell',
    category: 'cleaning', priority: 'normal', description: 'Synthetic mud on rear seats.', status: 'open', version: 1, assignee: null,
    reportedBy: 'Synthetic staff', reportedByUserId: 'staff-1', reportedAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:00:00Z',
    completedAt: null, completedBy: null, photoCount: 0, allowedActions: ['add_note', 'start_work', 'request_completion'], photos: [], events: [], ...overrides }
}
function vehicle(): InventoryVehicle {
  return { id: 'TESTDATAHWELL0001', vin: 'TESTDATAHWELL0001', stockNumber: 'DEMO-H01', year: 2024, make: 'Ford', model: 'F-150', canReportIssue: true,
    publicListing: { dataState: 'current', isListed: true }, dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false }, dealerMail: { dataState: 'current', hasActiveHold: false }, location: { homeStore: { id: 'howell', name: 'Howell' } } }
}
function context(): VehicleIssueContext { return { role: 'sales', homeStore: 'Howell', currentUser: 'Synthetic staff', enabled: true, issues: [], onChanged: vi.fn().mockResolvedValue(undefined) } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const photo = { id: 'photo-1', contentType: 'image/jpeg', bytes: 12, eventId: 'event-1', createdAt: '2026-09-01T12:00:00Z' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getVehicleIssue).mockResolvedValue(issue())
  vi.mocked(createVehicleIssue).mockResolvedValue(issue())
  vi.mocked(appendVehicleIssueEvent).mockResolvedValue(issue({ version: 2 }))
  vi.mocked(prepareIssuePhoto).mockResolvedValue({ data: 'c3ludGhldGlj' })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic-issue-photo') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe('vehicle issue workflow', () => {
  it('uses the server reporting permission and never treats a source-reported location as a confirmed location', () => {
    const unit = vehicle(); unit.canReportIssue = false
    expect(canReportVehicleIssue(unit, { ...context(), role: 'group_manager' })).toBe(false)
    delete unit.canReportIssue
    unit.location.homeStore = { id: 'lincoln', name: 'Lincoln' }
    unit.location.sourceReportedStore = { id: 'howell', name: 'Howell' }
    expect(canReportVehicleIssue(unit, context())).toBe(false)
    unit.location.appConfirmedStore = { id: 'howell', name: 'Howell' }
    expect(canReportVehicleIssue(unit, context())).toBe(true)
    expect(canReportVehicleIssue(unit, { ...context(), enabled: false })).toBe(false)
  })

  it('shows only staff actions; managers must supply a completion note', async () => {
    const user = userEvent.setup()
    const page = render(<IssueDetail issueId="synthetic-issue" role="sales" store="Howell" onSaved={vi.fn()} />)
    await screen.findByLabelText('Action')
    expect(screen.queryByRole('option', { name: 'Confirm completion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Assign' })).not.toBeInTheDocument()
    page.unmount()
    vi.mocked(getVehicleIssue).mockResolvedValue(issue({ status: 'awaiting_review', allowedActions: ['complete', 'add_note'] }))
    render(<IssueDetail issueId="synthetic-issue" role="manager" store="Howell" onSaved={vi.fn()} />)
    await user.selectOptions(await screen.findByLabelText('Action'), 'complete')
    expect(screen.getByRole('button', { name: 'Confirm completion' })).toBeDisabled()
    await user.type(screen.getByLabelText('Completion note'), 'Checked and cleaned the rear seats.')
    await user.click(screen.getByRole('button', { name: 'Confirm completion' }))
    await waitFor(() => expect(appendVehicleIssueEvent).toHaveBeenCalledWith('synthetic-issue', { type: 'complete', expectedVersion: 1, note: 'Checked and cleaned the rear seats.' }, 'manager', 'Howell'))
    expect(await screen.findByRole('status')).toHaveTextContent('Completion confirmed.')
  })

  it('retains a failed/conflicting draft and retries only after the latest version is reloaded', async () => {
    const user = userEvent.setup()
    vi.mocked(getVehicleIssue).mockResolvedValueOnce(issue()).mockResolvedValueOnce(issue({ version: 4, assignee: 'Synthetic technician' }))
    vi.mocked(appendVehicleIssueEvent).mockRejectedValueOnce(new ApiError('Version conflict', 409)).mockResolvedValueOnce(issue({ version: 5 }))
    render(<IssueDetail issueId="synthetic-issue" role="sales" store="Howell" onSaved={vi.fn()} />)
    await user.type(await screen.findByLabelText('Work update'), 'Rear seats cleaned; checking floor mats.')
    await user.click(screen.getByRole('button', { name: 'Add update' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This issue changed')
    expect(screen.getByLabelText('Work update')).toHaveValue('Rear seats cleaned; checking floor mats.')
    expect(screen.getByRole('button', { name: 'Add update' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Reload latest issue' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add update' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await waitFor(() => expect(appendVehicleIssueEvent).toHaveBeenLastCalledWith('synthetic-issue', expect.objectContaining({ expectedVersion: 4, note: 'Rear seats cleaned; checking floor mats.' }), 'sales', 'Howell'))
  })

  it('retains the last readable issue on a temporary reload failure and clears it on denied access', async () => {
    const user = userEvent.setup()
    vi.mocked(appendVehicleIssueEvent).mockRejectedValue(new ApiError('Version conflict', 409))
    vi.mocked(getVehicleIssue).mockResolvedValueOnce(issue()).mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new ApiError('Access denied', 403))
    render(<IssueDetail issueId="synthetic-issue" role="sales" store="Howell" onSaved={vi.fn()} />)
    await user.type(await screen.findByLabelText('Work update'), 'Draft update')
    await user.click(screen.getByRole('button', { name: 'Add update' }))
    await user.click(await screen.findByRole('button', { name: 'Reload latest issue' }))
    await screen.findByText('Offline')
    expect(screen.getByText('Synthetic mud on rear seats.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry issue' }))
    await screen.findByText('Access denied')
    expect(screen.queryByText('Synthetic mud on rear seats.')).not.toBeInTheDocument()
  })

  it('preserves a failed report and sends optional prepared photos without actor fields', async () => {
    const user = userEvent.setup()
    vi.mocked(createVehicleIssue).mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValueOnce(issue())
    const onSaved = vi.fn()
    render(<IssueReportDialog vehicle={vehicle()} context={context()} onSaved={onSaved} onClose={vi.fn()} returnFocusRef={{ current: null }} />)
    await user.selectOptions(screen.getByLabelText('Category'), 'damage')
    await user.type(screen.getByLabelText('What needs attention?'), 'Synthetic scratch on passenger door.')
    await user.upload(screen.getByLabelText(/Photos/), new File(['photo'], 'synthetic.jpg', { type: 'image/jpeg' }))
    await screen.findByAltText('Selected issue photo 1')
    await user.click(screen.getByRole('button', { name: 'Report issue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Network interrupted')
    expect(screen.getByLabelText('What needs attention?')).toHaveValue('Synthetic scratch on passenger door.')
    expect(screen.getByAltText('Selected issue photo 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Report issue' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(createVehicleIssue).toHaveBeenLastCalledWith('TESTDATAHWELL0001', { category: 'damage', priority: 'normal', description: 'Synthetic scratch on passenger door.', photos: [{ data: 'c3ludGhldGlj' }] }, 'sales', 'Howell')
  })

  it.each(['unmount', 'access change'])('does not reopen a view after a late create response following %s', async reason => {
    const user = userEvent.setup(), pending = deferred<VehicleIssueDetail>(), onSaved = vi.fn()
    vi.mocked(createVehicleIssue).mockReturnValueOnce(pending.promise)
    const page = render(<IssueReportDialog vehicle={vehicle()} context={context()} onSaved={onSaved} onClose={vi.fn()} returnFocusRef={{ current: null }} />)
    await user.type(screen.getByLabelText('What needs attention?'), 'Synthetic cleaning needed.')
    await user.click(screen.getByRole('button', { name: 'Report issue' }))
    if (reason === 'unmount') page.unmount(); else invalidateApiAccess()
    await act(async () => pending.resolve(issue()))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('keeps the issue workflow separate from service and protects a work draft when changing tabs', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} initialTab="issues" issueContext={{ ...context(), issues: [issue()] }} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Cleaning.*Synthetic mud/ }))
    await user.type(await screen.findByLabelText('Work update'), 'Draft remains here')
    await user.click(screen.getByRole('tab', { name: 'Records' }))
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Issues' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Work update')).toHaveValue('Draft remains here')
    expect(screen.queryByRole('button', { name: 'Mark Ready' })).not.toBeInTheDocument()
  })

  it('reports an unavailable deployment without claiming there are no issues', async () => {
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={vehicle().location.homeStore} initialTab="issues" issueContext={{ ...context(), enabled: false }} onClose={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('not available in this deployment')
    expect(screen.queryByText('No open issues recorded.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report issue' })).not.toBeInTheDocument()
  })

  it('restores the issue row after returning from detail and keeps disabled-deployment history read-only', async () => {
    const user = userEvent.setup()
    render(<VehicleIssues issues={[issue()]} context={{ ...context(), enabled: false }} canReport={false} onReport={vi.fn()} onSaved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Cleaning.*Synthetic mud/ }))
    await screen.findByText('Issue history is available. Reporting and updates are not enabled in this deployment.')
    expect(screen.queryByLabelText('Action')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to issue list' }))
    expect(screen.getByRole('button', { name: /Cleaning.*Synthetic mud/ })).toHaveFocus()
  })
})

describe('issue photos', () => {
  it('prepares a photo in StrictMode and cancels a late preparation after unmount', async () => {
    const user = userEvent.setup(), onChange = vi.fn(), onPreparing = vi.fn()
    const page = render(<StrictMode><IssuePhotoPicker photos={[]} onChange={onChange} onPreparing={onPreparing} /></StrictMode>)
    await user.upload(screen.getByLabelText(/Photos/), new File(['photo'], 'synthetic.jpg', { type: 'image/jpeg' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ data: 'c3ludGhldGlj', name: 'synthetic.jpg' }]))
    expect(onPreparing).toHaveBeenLastCalledWith(false)
    const pending = deferred<{ data: string }>()
    vi.mocked(prepareIssuePhoto).mockReturnValueOnce(pending.promise)
    await user.upload(screen.getByLabelText(/Photos/), new File(['photo2'], 'second.jpg', { type: 'image/jpeg' }))
    page.unmount(); onChange.mockClear()
    await act(async () => pending.resolve({ data: 'late' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('retains valid photos when one file fails preparation and allows removing one', async () => {
    const user = userEvent.setup()
    vi.mocked(prepareIssuePhoto).mockRejectedValueOnce(new Error('Unsupported image')).mockResolvedValueOnce({ data: 'prepared' })
    function Picker() { const [photos, setPhotos] = useState<DraftIssuePhoto[]>([]); return <IssuePhotoPicker photos={photos} onChange={setPhotos} onPreparing={vi.fn()} /> }
    render(<Picker />)
    await user.upload(screen.getByLabelText(/Photos/), [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })])
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported image')
    expect(screen.getByAltText('Selected issue photo 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(screen.queryByAltText('Selected issue photo 1')).not.toBeInTheDocument()
  })

  it('loads saved photos on demand, retries decode failure, and revokes their URLs', async () => {
    const user = userEvent.setup()
    vi.mocked(getVehicleIssuePhoto).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))
    const page = render(<IssuePhotos issueId="synthetic-issue" photos={[photo]} role="manager" store="Howell" />)
    expect(getVehicleIssuePhoto).not.toHaveBeenCalled()
    await user.click(screen.getByText('Photos (1)'))
    const image = await screen.findByAltText('Vehicle issue evidence')
    expect(getVehicleIssuePhoto).toHaveBeenCalledWith('synthetic-issue', 'photo-1', 'manager', 'Howell', expect.any(AbortSignal))
    fireEvent.error(image)
    expect(screen.getByRole('alert')).toHaveTextContent('could not be displayed')
    await user.click(screen.getByRole('button', { name: 'Retry photo' }))
    await screen.findByAltText('Vehicle issue evidence')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-issue-photo')
    page.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
