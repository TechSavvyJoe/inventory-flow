import { useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUnsavedChanges } from './useUnsavedChanges'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function AdditionalDraft() { useUnsavedChanges(true); return null }
function Editor({ extra = false }: { extra?: boolean }) {
  const [draft, setDraft] = useState('unsaved note')
  useUnsavedChanges(Boolean(draft))
  const navigate = useNavigate()
  return <><label>Draft<textarea value={draft} onChange={event => setDraft(event.target.value)} /></label>
    {extra && <AdditionalDraft />}<Link to="/next">Open next</Link>
    <button onClick={() => navigate('/next')}>Change workspace</button>
    <button onClick={() => navigate(-1)}>Back</button></>
}
function TestRoutes({ extra = false }: { extra?: boolean }) {
  return <Routes><Route path="/edit" element={<Editor extra={extra} />} /><Route path="/next" element={<p>Next workspace</p>} /><Route path="/prior" element={<p>Previous workspace</p>} /></Routes>
}

describe('unfinished work protection', () => {
  it('allows clean navigation and asks before discarding edited work', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const hook = renderHook(({ dirty }) => useUnsavedChanges(dirty), { initialProps: { dirty: false } })
    expect(hook.result.current.confirmDiscard()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    hook.rerender({ dirty: true })
    expect(hook.result.current.confirmDiscard()).toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('does not ask after a confirmed save even while its follow-up refresh is pending', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const hook = renderHook(() => useUnsavedChanges(true, { saving: true }))
    act(() => hook.result.current.markSaved())
    hook.rerender()
    expect(hook.result.current.confirmDiscard()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('protects browser close while edits or an unconfirmed write are pending', () => {
    const hook = renderHook(() => useUnsavedChanges(false, { saving: true }))
    const pending = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(pending)
    expect(pending.defaultPrevented).toBe(true)
    hook.unmount()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
  })

  it('blocks programmatic navigation and preserves the edited value when discarding is declined', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MemoryRouter initialEntries={['/edit']}><TestRoutes /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Change workspace' }))
    expect(screen.getByLabelText('Draft')).toHaveValue('unsaved note')
    expect(screen.queryByText('Next workspace')).not.toBeInTheDocument()
    expect(confirm).toHaveBeenCalledOnce()
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Change workspace' }))
    expect(screen.getByText('Next workspace')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('asks only once across multiple dirty forms and the router when following a link', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MemoryRouter initialEntries={['/edit']}><TestRoutes extra /></MemoryRouter>)
    fireEvent.click(screen.getByRole('link', { name: 'Open next' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Draft')).toHaveValue('unsaved note')
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('link', { name: 'Open next' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Next workspace')).toBeInTheDocument()
  })

  it('guards programmatic Back without changing the history position when declined', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MemoryRouter initialEntries={['/prior', '/edit']} initialIndex={1}><TestRoutes /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Draft')).toHaveValue('unsaved note')
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Previous workspace')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('reverts native browser Back before unmounting the editor, then permits confirmed navigation', async () => {
    window.history.replaceState({ idx: 0 }, '', '/prior')
    window.history.pushState({ idx: 1 }, '', '/edit')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<BrowserRouter><TestRoutes /></BrowserRouter>)
    act(() => window.history.back())
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    await waitFor(() => expect(window.location.pathname).toBe('/edit'))
    expect(screen.getByLabelText('Draft')).toHaveValue('unsaved note')
    confirm.mockReturnValue(true)
    act(() => window.history.back())
    expect(await screen.findByText('Previous workspace')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(2)
  })
})
