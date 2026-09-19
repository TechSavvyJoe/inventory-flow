import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    fireEvent.click(await screen.findByRole('button', { name: 'Add employee' }))
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
})
