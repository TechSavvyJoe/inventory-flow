import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import React, { useState } from 'react'
import { renderToString } from 'react-dom/server'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { motion, motionValue, AnimatePresence, useAnimation, useReducedMotion } from 'framer-motion'
import { createMotionPreference } from './motion-test-utils'

const preference = createMotionPreference()
beforeEach(() => { preference.install(); preference.set(false) })
afterEach(() => { cleanup(); preference.restore() })

describe('installed framer-motion integration', () => {
  it('exports motion, AnimatePresence, and key hooks', () => {
    expect(motion).toBeDefined()
    expect(typeof motion.div).toBe('object')
    expect(typeof motion.button).toBe('object')
    expect(typeof motion.header).toBe('object')
    expect(AnimatePresence).toBeDefined()
    expect(typeof useAnimation).toBe('function')
    expect(typeof useReducedMotion).toBe('function')
  })

  it('renders the initial state in SSR without leaking animation props into HTML', () => {
    const html = renderToString(
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="test-cockpit-card">
        <span>Content</span>
      </motion.div>,
    )
    const node = new DOMParser().parseFromString(html, 'text/html').querySelector('div')!
    expect(node.style.opacity).toBe('0')
    expect(node.style.transform).toBe('translateY(15px)')
    expect(node.classList.contains('test-cockpit-card')).toBe(true)
    for (const prop of ['whileHover', 'whileTap', 'initial', 'animate', 'transition']) expect(node.hasAttribute(prop)).toBe(false)
  })

  it('finishes the mounted animation before reporting completion', async () => {
    const y = motionValue(15)
    const opacity = motionValue(0)
    const completed = vi.fn()
    render(<motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} style={{ y, opacity }} transition={{ duration: 0.04 }} onAnimationComplete={completed} data-testid="mounted-box">Mounted</motion.div>)
    expect(screen.getByTestId('mounted-box')).toHaveStyle({ opacity: '0' })
    expect(completed).not.toHaveBeenCalled()
    await waitFor(() => expect(completed).toHaveBeenCalledOnce())
    expect(y.get()).toBe(0)
    expect(opacity.get()).toBe(1)
    await waitFor(() => expect(screen.getByTestId('mounted-box')).toHaveStyle({ opacity: '1' }))
  })

  it('applies hover and press targets through primary pointer events and restores the idle state', async () => {
    const scale = motionValue(1)
    render(<motion.button animate={{ scale: 1 }} style={{ scale }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.02 }}>Action</motion.button>)
    const button = screen.getByRole('button', { name: 'Action' })
    fireEvent.pointerEnter(button, { pointerType: 'mouse', isPrimary: true })
    await waitFor(() => expect(scale.get()).toBe(1.05))
    fireEvent.pointerDown(button, { pointerType: 'mouse', isPrimary: true, button: 0 })
    await waitFor(() => expect(scale.get()).toBe(0.95))
    fireEvent.pointerUp(button, { pointerType: 'mouse', isPrimary: true, button: 0 })
    await waitFor(() => expect(scale.get()).toBe(1.05))
    fireEvent.pointerLeave(button, { pointerType: 'mouse', isPrimary: true })
    await waitFor(() => expect(scale.get()).toBe(1))
  })

  it('keeps exiting content mounted until AnimatePresence completes its exit', async () => {
    const exited = vi.fn()
    function ToggleWrapper() {
      const [show, setShow] = useState(true)
      return <><button onClick={() => setShow(false)}>Dismiss</button><AnimatePresence onExitComplete={exited}>{show && <motion.div key="alert" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.04 }} data-testid="alert-box">Hold Active</motion.div>}</AnimatePresence></>
    }
    render(<ToggleWrapper />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByTestId('alert-box')).toBeInTheDocument()
    expect(exited).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('alert-box')).not.toBeInTheDocument())
    expect(exited).toHaveBeenCalledOnce()
  })
})
