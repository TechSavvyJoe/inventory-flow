import { useLayoutEffect, useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useContainedFocus } from './useContainedFocus'

function Dialog({ onEscape, escapeOnCommit = false }: { onEscape: () => void; escapeOnCommit?: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  useContainedFocus({ active: true, contain: true, containerRef: container, onEscape })
  useLayoutEffect(() => {
    // The dialog's DOM exists now. Input must work before passive effects or
    // the scheduled initial-focus frame, including on a keyboard reopen.
    if (escapeOnCommit) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }, [escapeOnCommit, onEscape])
  return <div ref={container} role="dialog" aria-modal="true" aria-label="Vehicle details" tabIndex={-1}>Vehicle details</div>
}

describe('contained dialog keyboard readiness', () => {
  it('handles Escape in the same commit that exposes a newly opened dialog', () => {
    const onEscape = vi.fn()
    render(<Dialog onEscape={onEscape} escapeOnCommit />)
    expect(screen.getByRole('dialog', { name: 'Vehicle details' })).toBeVisible()
    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('uses the latest dismissal callback before the first input after a commit', () => {
    const previous = vi.fn()
    const current = vi.fn()
    const view = render(<Dialog onEscape={previous} />)
    view.rerender(<Dialog onEscape={current} escapeOnCommit />)
    expect(current).toHaveBeenCalledOnce()
    expect(previous).not.toHaveBeenCalled()
  })

  it('yields Escape to the top modal and resumes after it closes', () => {
    const onEscape = vi.fn()
    const view = render(<><Dialog onEscape={onEscape} /><div role="dialog" aria-modal="true" aria-label="Photo viewer">Photo</div></>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onEscape).not.toHaveBeenCalled()
    view.rerender(<Dialog onEscape={onEscape} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledOnce()
  })
})
