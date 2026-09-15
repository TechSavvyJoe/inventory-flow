import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { RouteLoadingState } from './RouteLoadingState'

afterEach(cleanup)

describe('RouteLoadingState', () => {
  it.each([
    ['/inventory', 'Preparing inventory workspace'],
    ['/transfers/new', 'Preparing vehicle moves'],
    ['/attention', 'Preparing action center'],
    ['/updates', 'Preparing inventory updates'],
    ['/service', 'Preparing service status'],
    ['/manager', 'Preparing manager workspace'],
  ])('announces the destination for %s without moving focus', (pathname, announcement) => {
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <button type="button">Keep focus</button>
        <RouteLoadingState />
      </MemoryRouter>,
    )

    const trigger = screen.getByRole('button', { name: 'Keep focus' })
    trigger.focus()

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText(announcement)).toBeVisible()
    expect(trigger).toHaveFocus()
  })
})
