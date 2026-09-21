import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { invalidateApiAccess } from './apiSession'
import { useWorkspaceLifetime } from './useWorkspaceLifetime'

afterEach(cleanup)

describe('async workspace lifetime', () => {
  it('keeps current work valid through rerenders and rejects it after unmount', () => {
    const hook = renderHook(() => useWorkspaceLifetime('vehicle-a'))
    const isCurrent = hook.result.current()
    hook.rerender()
    expect(isCurrent()).toBe(true)
    hook.unmount()
    expect(isCurrent()).toBe(false)
  })
  it('rejects old completions after leaving and returning to the same context', () => {
    const hook = renderHook(({ context }) => useWorkspaceLifetime(context), { initialProps: { context: 'a' } })
    const original = hook.result.current()
    hook.rerender({ context: 'b' })
    hook.rerender({ context: 'a' })
    expect(original()).toBe(false)
    expect(hook.result.current()()).toBe(true)
  })
  it('rejects work immediately when API access is revoked, before React unmounts the form', () => {
    const hook = renderHook(() => useWorkspaceLifetime('a'))
    const original = hook.result.current()
    invalidateApiAccess()
    expect(original()).toBe(false)
  })
})
