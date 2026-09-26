import { StrictMode, useLayoutEffect, useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useContainedFocus } from './useContainedFocus'

afterEach(cleanup)

function Dialog({ onEscape, escapeOnCommit = false, tabOnCommit = false, active = true, contain = true }: {
  onEscape: () => void; escapeOnCommit?: boolean; tabOnCommit?: boolean; active?: boolean; contain?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  useContainedFocus({ active, contain, containerRef: container, onEscape })
  useLayoutEffect(() => {
    // The dialog's DOM exists now. Input must work before passive effects or
    // the scheduled initial-focus frame, including on a keyboard reopen.
    if (!active) return
    if (tabOnCommit) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    if (escapeOnCommit) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }, [active, tabOnCommit, escapeOnCommit, onEscape])
  return active ? <div ref={container} role="dialog" aria-modal="true" aria-label="Vehicle details" tabIndex={-1}>Vehicle details</div> : null
}

function ClosingDialog({ escapeOnCommit = false }: { escapeOnCommit?: boolean }) {
  const [open, setOpen] = useState(true)
  return open ? <Dialog onEscape={() => setOpen(false)} tabOnCommit escapeOnCommit={escapeOnCommit} /> : null
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

  it.each([false, true])('restores the fallback opener after early Tab and Escape (StrictMode: %s)', strict => {
    render(<button>Open issue</button>)
    const opener = screen.getByRole('button', { name: 'Open issue' })
    opener.focus()
    render(strict ? <StrictMode><ClosingDialog /></StrictMode> : <ClosingDialog />)
    expect(screen.getByRole('dialog', { name: 'Vehicle details' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Vehicle details' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('restores the fallback opener when Tab and Escape both arrive before passive setup', () => {
    render(<button>Open issue</button>)
    const opener = screen.getByRole('button', { name: 'Open issue' })
    opener.focus()
    render(<ClosingDialog escapeOnCommit />)
    expect(screen.queryByRole('dialog', { name: 'Vehicle details' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('retains the activation opener across containment changes', () => {
    render(<button>Open issue</button>)
    const opener = screen.getByRole('button', { name: 'Open issue' })
    opener.focus()
    const onEscape = vi.fn()
    const view = render(<Dialog onEscape={onEscape} tabOnCommit />)
    view.rerender(<Dialog onEscape={onEscape} tabOnCommit contain={false} />)
    screen.getByRole('dialog', { name: 'Vehicle details' }).focus()
    view.rerender(<Dialog onEscape={onEscape} tabOnCommit />)
    view.unmount()
    expect(opener).toHaveFocus()
  })

  it('captures the new opener when the same hook is activated again', () => {
    render(<><button>First issue</button><button>Second issue</button></>)
    const first = screen.getByRole('button', { name: 'First issue' })
    const second = screen.getByRole('button', { name: 'Second issue' })
    first.focus()
    const onEscape = vi.fn()
    const view = render(<Dialog onEscape={onEscape} tabOnCommit />)
    view.rerender(<Dialog onEscape={onEscape} active={false} tabOnCommit />)
    expect(first).toHaveFocus()
    second.focus()
    view.rerender(<Dialog onEscape={onEscape} tabOnCommit />)
    view.unmount()
    expect(second).toHaveFocus()
  })

  it('returns from a nested modal to its fallback opener inside the parent dialog', () => {
    render(<div role="dialog" aria-modal="true" aria-label="Issue history"><button>Open photo</button></div>)
    const opener = screen.getByRole('button', { name: 'Open photo' })
    opener.focus()
    render(<ClosingDialog />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Issue history' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Vehicle details' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
