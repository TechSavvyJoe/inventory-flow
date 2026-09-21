import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import { createMotionPreference } from '../../tests/unit/motion-test-utils'

const preference = createMotionPreference()
afterEach(() => { cleanup(); preference.restore() })

describe('system reduced motion preference', () => {
  it('returns the current preference immediately and follows changes without remounting', () => {
    preference.install()
    preference.set(true)
    const { result } = renderHook(usePrefersReducedMotion)
    expect(result.current).toBe(true)
    act(() => preference.set(false))
    expect(result.current).toBe(false)
    act(() => preference.set(true))
    expect(result.current).toBe(true)
  })

  it('removes the browser listener when the consumer unmounts', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener, removeEventListener }) as unknown as MediaQueryList)
    const { unmount } = renderHook(usePrefersReducedMotion)
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('change', addEventListener.mock.calls[0][1])
  })

  it('supports WebKit legacy listeners and cleans them up', () => {
    const addListener = vi.fn()
    const removeListener = vi.fn()
    const media = { matches: false, addListener, removeListener }
    window.matchMedia = vi.fn(() => media as unknown as MediaQueryList)
    const { result, unmount } = renderHook(usePrefersReducedMotion)
    act(() => { media.matches = true; addListener.mock.calls[0][0]() })
    expect(result.current).toBe(true)
    unmount()
    expect(removeListener).toHaveBeenCalledWith(addListener.mock.calls[0][0])
  })

  it('keeps rendering when media queries are unavailable', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    const { result } = renderHook(usePrefersReducedMotion)
    expect(result.current).toBe(false)
  })
})
