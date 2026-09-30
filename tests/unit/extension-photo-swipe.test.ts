// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error The companion uses unbundled JavaScript modules.
import { bindPhotoSwipe } from '../../extension/sidepanel/lib/photo-swipe.mjs'

describe('companion gallery swipes', () => {
  function gesture(dx: number, dy: number) {
    const frame = document.createElement('div'), change = vi.fn()
    const suppressClick = bindPhotoSwipe(frame, change)
    frame.dispatchEvent(new MouseEvent('pointerdown', { clientX:200, clientY:200, bubbles:true }))
    frame.dispatchEvent(new MouseEvent('pointerup', { clientX:200 + dx, clientY:200 + dy, bubbles:true }))
    return { change, suppressClick }
  }
  it('changes a photo on a horizontal swipe without opening it from the follow-up click', () => {
    const { change, suppressClick } = gesture(-100, 8)
    expect(change).toHaveBeenCalledExactlyOnceWith(1)
    expect(suppressClick()).toBe(true)
  })
  it('leaves vertical scrolling and short taps alone', () => {
    const scroll = gesture(-10, 100), tap = gesture(2, 2)
    expect(scroll.change).not.toHaveBeenCalled(); expect(scroll.suppressClick()).toBe(false)
    expect(tap.change).not.toHaveBeenCalled(); expect(tap.suppressClick()).toBe(false)
  })
})
