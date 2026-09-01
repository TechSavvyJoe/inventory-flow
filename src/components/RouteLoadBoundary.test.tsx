import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { RouteLoadBoundary } from './RouteLoadBoundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function BrokenRoute(): never {
  throw new Error('Synthetic route chunk failure')
}

describe('RouteLoadBoundary', () => {
  it('keeps a route failure inside the application shell and offers a safe retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <MemoryRouter initialEntries={['/inventory']}>
        <RouteLoadBoundary>
          <BrokenRoute />
        </RouteLoadBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('This screen could not be opened')
    expect(screen.getByText(/Your current data was not changed/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh screen' })).toBeVisible()
  })
})
