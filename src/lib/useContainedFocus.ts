import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'details > summary:first-of-type:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest('[inert]')) return false
    const styles = window.getComputedStyle(element)
    const bounds = element.getBoundingClientRect()
    return styles.display !== 'none' && styles.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0
  })
}

interface ContainedFocusOptions {
  active: boolean
  contain: boolean
  containerRef: RefObject<HTMLElement | null>
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  onEscape: () => void
}

export function useContainedFocus({
  active,
  contain,
  containerRef,
  initialFocusRef,
  returnFocusRef,
  onEscape,
}: ContainedFocusOptions) {
  const onEscapeRef = useRef(onEscape)
  const activationRef = useRef<{ container: HTMLElement; opener: HTMLElement | null } | null>(null)

  useLayoutEffect(() => {
    onEscapeRef.current = onEscape
  }, [onEscape])

  // Capture before early Tab or background isolation moves focus. Retain the
  // activation's opener through containment changes and StrictMode rehearsal.
  useLayoutEffect(() => {
    if (!active) {
      activationRef.current = null
      return
    }
    const container = containerRef.current
    if (container && activationRef.current?.container !== container) {
      activationRef.current = {
        container,
        opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      }
    }
  }, [active, containerRef])

  // A committed dialog can receive keyboard input before passive effects run.
  // Install its handler before paint so a quick reopen/Escape is never lost.
  useLayoutEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    // A dialog opened on top of this one owns the keyboard until it closes.
    const coveredByNestedModal = () => {
      const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
      const top = modals[modals.length - 1]
      return Boolean(top && top !== container && !container.contains(top) && !top.contains(container))
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (coveredByNestedModal()) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscapeRef.current()
        return
      }
      if (!contain || event.key !== 'Tab') return

      const focusable = focusableElements(container)
      if (!focusable.length) {
        event.preventDefault()
        container.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement
      if (!container.contains(current)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && current === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    // Capture keyboard dismissal before browser controls or portal descendants
    // can stop propagation. This is especially important for WebKit dialogs.
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [active, contain, containerRef])

  // Focus restoration stays in the passive cleanup phase, after modal
  // background isolation has had a chance to remove inertness.
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return
    const returnFocus = activationRef.current?.opener ?? null
    const frame = window.requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? focusableElements(container)[0] ?? container
      target.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      const target = returnFocusRef?.current ?? returnFocus
      // Restore synchronously when possible, then retry after the next paint.
      // WebKit can otherwise keep focus on a removed portal while a surrounding
      // view transition is committing, leaving the original launch control
      // inactive after the dialog is gone.
      const restoreFocus = () => {
        if (target?.isConnected) target.focus({ preventScroll: true })
      }
      restoreFocus()
      window.requestAnimationFrame(restoreFocus)
    }
  }, [active, contain, containerRef, initialFocusRef, returnFocusRef])
}
