import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapData } from '../../types'
import { AttentionPage } from './AttentionPage'

const mocks = vi.hoisted(() => ({
  useAppData: vi.fn(),
}))

vi.mock('../../app/AppDataContext', () => ({
  useAppData: mocks.useAppData,
}))

const data: BootstrapData = {
  meta: {
    reportDate: '2026-08-30',
    completedAt: '2026-08-30T13:00:00Z',
    timezone: 'America/New_York',
    publicFreshness: 'current',
    dealerMailFreshness: 'current',
    publicCount: 0,
    crmCount: 0,
    heldVinCount: 0,
    publicChangeBaselineDate: '2026-08-29',
    publicChangeCounts: {
      newArrival: 0,
      removed: 0,
      priceChange: 0,
      mileageChange: 0,
      websiteStatusChange: 0,
      stockCorrection: 0,
      storeTransfer: 0,
    },
    holdChangeStatus: 'baseline',
    warnings: [],
  },
  stores: [],
  vehicles: [],
  transfers: [],
  attention: [],
  publicChanges: [],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AttentionPage />
    </MemoryRouter>,
  )
}

describe('AttentionPage section tabs', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.useAppData.mockReturnValue({
      data,
      homeStore: 'Howell',
      role: 'manager',
      addAttentionEvent: vi.fn(),
    })
  })

  it('uses arrow keys to move focus and activate the adjacent ARIA tab', async () => {
    const user = userEvent.setup()
    renderPage()

    const tablist = screen.getByRole('tablist', { name: 'Today sections' })
    const workQueueTab = within(tablist).getByRole('tab', { name: /Work queue/ })
    const dailyChangesTab = within(tablist).getByRole('tab', { name: /Daily changes/ })

    expect(workQueueTab).toHaveAttribute('aria-controls', 'today-panel-attention')
    expect(workQueueTab).toHaveAttribute('aria-selected', 'true')
    expect(workQueueTab).toHaveAttribute('tabindex', '0')
    expect(dailyChangesTab).toHaveAttribute('aria-selected', 'false')
    expect(dailyChangesTab).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'today-tab-attention')

    workQueueTab.focus()
    await user.keyboard('{ArrowRight}')

    expect(dailyChangesTab).toHaveFocus()
    expect(dailyChangesTab).toHaveAttribute('aria-selected', 'true')
    expect(dailyChangesTab).toHaveAttribute('tabindex', '0')
    expect(workQueueTab).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'today-tab-changes')

    await user.keyboard('{ArrowLeft}')

    expect(workQueueTab).toHaveFocus()
    expect(workQueueTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'today-tab-attention')
  })

  it('moves to the first and last ARIA tabs with Home and End', async () => {
    const user = userEvent.setup()
    renderPage()

    const tablist = screen.getByRole('tablist', { name: 'Today sections' })
    const workQueueTab = within(tablist).getByRole('tab', { name: /Work queue/ })
    const dailyChangesTab = within(tablist).getByRole('tab', { name: /Daily changes/ })

    workQueueTab.focus()
    await user.keyboard('{End}')

    expect(dailyChangesTab).toHaveFocus()
    expect(dailyChangesTab).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')

    expect(workQueueTab).toHaveFocus()
    expect(workQueueTab).toHaveAttribute('aria-selected', 'true')
  })
})
