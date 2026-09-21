import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearWorkspaceMemory, useWorkspaceScroll, useWorkspaceState } from './workspace-memory'

afterEach(() => { cleanup(); clearWorkspaceMemory(); vi.restoreAllMocks() })

describe('authenticated workspace continuity', () => {
  it('restores a view across navigation without using persistent browser storage', () => {
    const first = renderHook(() => useWorkspaceState('manager:Howell:one', 'search', ''))
    act(() => first.result.current[1]('Customer reference'))
    first.unmount()
    const next = renderHook(() => useWorkspaceState('manager:Howell:one', 'search', ''))
    expect(next.result.current[0]).toBe('Customer reference')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
  it('separates users, roles and working stores', () => {
    const view = renderHook(({ context }) => useWorkspaceState(context, 'filters', 'all'), { initialProps: { context: 'one:manager:Howell' } })
    act(() => view.result.current[1]('held'))
    view.rerender({ context: 'one:sales:Howell' })
    expect(view.result.current[0]).toBe('all')
    view.rerender({ context: 'two:manager:Howell' })
    expect(view.result.current[0]).toBe('all')
    view.rerender({ context: 'one:manager:Lincoln' })
    expect(view.result.current[0]).toBe('all')
  })
  it('forgets all prior state after access revocation and rejects late setters', () => {
    const view = renderHook(() => useWorkspaceState('one:manager:Howell', 'query', ''))
    act(() => view.result.current[1]('private search'))
    const lateSetter = view.result.current[1]
    clearWorkspaceMemory()
    act(() => lateSetter('late private response'))
    view.unmount()
    const next = renderHook(() => useWorkspaceState('one:manager:Howell', 'query', ''))
    expect(next.result.current[0]).toBe('')
  })
  it('does not retain a view without an authenticated context', () => {
    const view = renderHook(() => useWorkspaceState(undefined, 'query', ''))
    act(() => view.result.current[1]('temporary'))
    view.unmount()
    expect(renderHook(() => useWorkspaceState(undefined, 'query', '')).result.current[0]).toBe('')
  })
})

it('rejects stale setters after a context changes and after the same context is revisited', () => {
  const view = renderHook(({ context }) => useWorkspaceState(context, 'late-query', ''), { initialProps: { context: 'one:manager:Howell' } })
  const oldSetter = view.result.current[1]
  view.rerender({ context: 'one:sales:Lincoln' })
  act(() => oldSetter('old private data'))
  expect(view.result.current[0]).toBe('')
  view.rerender({ context: 'one:manager:Howell' })
  act(() => oldSetter('old private data'))
  expect(view.result.current[0]).toBe('')
})

it('rejects a setter retained before access reset even when its hook rerenders with the same identity', () => {
  const view = renderHook(() => useWorkspaceState('one:manager:Howell', 'after-reset', ''))
  const oldSetter = view.result.current[1]
  clearWorkspaceMemory()
  view.rerender()
  act(() => oldSetter('private stale response'))
  expect(view.result.current[0]).toBe('')
  act(() => view.result.current[1]('current query'))
  expect(view.result.current[0]).toBe('current query')
})

it('does not let a late response from an unmounted page overwrite remembered state', () => {
  const first = renderHook(() => useWorkspaceState('one:manager:Howell', 'unmounted-query', ''))
  act(() => first.result.current[1]('kept query'))
  const oldSetter = first.result.current[1]
  first.unmount()
  act(() => oldSetter('late response'))
  const next = renderHook(() => useWorkspaceState('one:manager:Howell', 'unmounted-query', ''))
  expect(next.result.current[0]).toBe('kept query')
})


it('restores an explicitly remembered top-of-page position after visiting another workspace', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  const y = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0)
  const first = renderHook(() => useWorkspaceScroll('one:manager:Howell', 'inventory-scroll'))
  first.unmount()
  y.mockReturnValue(450)
  renderHook(() => useWorkspaceScroll('one:manager:Howell', 'inventory-scroll'))
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'instant' }))
})
