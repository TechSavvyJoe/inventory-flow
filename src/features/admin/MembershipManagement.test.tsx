import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MembershipManagement } from './MembershipManagement'

const api = vi.hoisted(() => ({ getMembershipDirectory: vi.fn(), saveMembershipAccess: vi.fn() }))
vi.mock('../../lib/api', () => api)

const directory = {
  revision: 4,
  currentUserId: 'group-manager',
  members: [
    { id: 'group-manager', email: 'manager@example.invalid', name: 'Group Manager', role: 'group_manager', homeStore: 'Howell', enabled: true },
    { id: 'legacy-driver', email: 'driver@example.invalid', name: 'Legacy Driver', role: 'driver', homeStore: 'Howell', enabled: true },
  ],
  audit: [],
} as const
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

describe('MembershipManagement role choices', () => {
  beforeEach(() => {
    api.getMembershipDirectory.mockReset().mockResolvedValue(directory)
    api.saveMembershipAccess.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })
  afterEach(() => {
    cleanup(); vi.restoreAllMocks()
    if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  it('offers only salesperson, store manager, and group manager for new employees', async () => {
    render(<MembershipManagement role="group_manager" store="Howell" onSaved={vi.fn()} />)
    const addEmployee = await screen.findByRole('button', { name: 'Add employee' })
    await waitFor(() => expect(addEmployee).toBeEnabled())
    fireEvent.click(addEmployee)
    const picker = screen.getByLabelText('Role')
    expect(within(picker).getAllByRole('option').map(option => option.textContent)).toEqual([
      'Salesperson', 'Store manager', 'Group manager',
    ])
  })

  it('shows an existing legacy role without allowing it to be newly selected', async () => {
    render(<MembershipManagement role="group_manager" store="Howell" onSaved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Legacy Driver' }))
    const picker = screen.getByLabelText('Role')
    await waitFor(() => expect(picker).toHaveValue('driver'))
    expect(within(picker).getByRole('option', { name: 'Driver · Legacy' })).toBeDisabled()
    expect(within(picker).getAllByRole('option')).toHaveLength(4)
  })

  it('returns keyboard focus to the actual Add or Edit opener when canceled', async () => {
    const user = userEvent.setup()
    render(<MembershipManagement role="group_manager" store="Howell" onSaved={vi.fn()} />)
    for (const name of ['Add employee', 'Edit Legacy Driver']) {
      const opener = await screen.findByRole('button', { name })
      await waitFor(() => expect(opener).toBeEnabled())
      opener.focus()
      await user.keyboard('{Enter}')
      expect(screen.getByRole('textbox', { name: 'Full name' })).toHaveFocus()
      screen.getByRole('button', { name: 'Cancel employee changes' }).focus()
      await user.keyboard('{Enter}')
      expect(screen.queryByRole('textbox', { name: 'Full name' })).not.toBeInTheDocument()
      expect(opener).toHaveFocus()
    }
  })

  it('returns focus to the employee heading if filtering removes the Edit opener', async () => {
    const user = userEvent.setup()
    render(<MembershipManagement role="group_manager" store="Howell" onSaved={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Edit Legacy Driver' }))
    await user.type(screen.getByRole('textbox', { name: 'Search employees' }), 'Group Manager')
    expect(screen.queryByRole('button', { name: 'Edit Legacy Driver' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel employee changes' }))
    expect(screen.getByRole('heading', { name: 'People & access' })).toHaveFocus()
  })

  it('returns focus after a successful save while announcing the result', async () => {
    api.saveMembershipAccess.mockResolvedValue({ saved: true, id: 'legacy-driver' })
    const user = userEvent.setup()
    render(<MembershipManagement role="group_manager" store="Howell" onSaved={vi.fn()} />)
    const opener = await screen.findByRole('button', { name: 'Edit Legacy Driver' })
    await user.click(opener)
    await user.type(screen.getByRole('textbox', { name: 'Reason for change' }), 'Synthetic access review')
    await user.click(screen.getByRole('button', { name: 'Save access' }))
    expect(await screen.findByRole('status')).toHaveTextContent("Legacy Driver's access was saved.")
    expect(opener).toHaveFocus()
  })

  it('retains employee changes when Cancel, Reload, or editing another employee is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MembershipManagement role="group_manager" store="Howell" onSaved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Legacy Driver' }))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Updated employee name' } })
    for (const name of ['Cancel employee changes', 'Reload', 'Edit Group Manager', 'Add employee']) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(screen.getByLabelText('Full name')).toHaveValue('Updated employee name')
    }
    expect(confirm).toHaveBeenCalledTimes(4)
    expect(api.getMembershipDirectory).toHaveBeenCalledOnce()
    expect(api.saveMembershipAccess).not.toHaveBeenCalled()
    const refresh = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(refresh)
    expect(refresh.defaultPrevented).toBe(true)
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel employee changes' }))
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
  })

  it('preserves self-edit constraints and submits the directory revision with the saved change', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    api.saveMembershipAccess.mockResolvedValue({ saved: true, id: 'group-manager' })
    function Form() {
      const navigate = useNavigate()
      return <MembershipManagement role="group_manager" store="Howell" onSaved={() => navigate('/saved')} />
    }
    render(<MemoryRouter initialEntries={['/edit']}><Routes><Route path="/edit" element={<Form />} /><Route path="/saved" element={<p>Access saved destination</p>} /></Routes></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Group Manager' }))
    expect(screen.getByLabelText('Role')).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Disabled' })).toBeDisabled()
    expect(screen.getByLabelText('Sign-in email')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Updated Group Manager' } })
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'Synthetic name correction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))
    expect(await screen.findByText('Access saved destination')).toBeInTheDocument()
    expect(api.saveMembershipAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-manager', expectedRevision: 4, role: 'group_manager', enabled: true, reason: 'Synthetic name correction' }), 'group_manager', 'Howell')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('clears the prior employee directory and rejects a late save after changing access context', async () => {
    let finish!: () => void
    api.saveMembershipAccess.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const saved = vi.fn()
    const page = render(<MembershipManagement role="group_manager" store="Howell" onSaved={saved} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Legacy Driver' }))
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'Synthetic employee correction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))
    expect(api.saveMembershipAccess).toHaveBeenCalledOnce()
    api.getMembershipDirectory.mockImplementation(() => new Promise(() => {}))
    page.rerender(<MembershipManagement role="group_manager" store="Lincoln" onSaved={saved} />)
    expect(screen.queryByText('Legacy Driver')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
    await act(async () => finish())
    expect(saved).not.toHaveBeenCalled()
    expect(screen.queryByText(/access was saved/)).not.toBeInTheDocument()
    expect(screen.getByText('Loading employees…')).toBeInTheDocument()
  })

  it('retains the employee draft and original revision after a failed save', async () => {
    api.saveMembershipAccess.mockRejectedValue(new Error('Directory changed; reload and review before saving.'))
    render(<MembershipManagement role="group_manager" store="Howell" onSaved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Legacy Driver' }))
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'Synthetic reason to keep' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Directory changed')
    expect(screen.getByLabelText('Reason for change')).toHaveValue('Synthetic reason to keep')
    expect(api.saveMembershipAccess).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }), 'group_manager', 'Howell')
  })
})
