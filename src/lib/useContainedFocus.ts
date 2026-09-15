import { useEffect, useRef, type RefObject } from 'react'

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

  useEffect(() => {
    onEscapeRef.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusInitial = () => {
      const target = initialFocusRef?.current ?? focusableElements(container)[0] ?? container
      target.focus()
    }
    const frame = window.requestAnimationFrame(focusInitial)

    // A dialog opened on top of this one (a later aria-modal element that is
    // neither this container nor inside it) owns the keyboard until it closes:
    // its Escape must not close this dialog too, and its Tab must not be
    // pulled back into this container.
    // Contract: every [aria-modal="true"] element in the app is a body portal
    // mounted in stacking order and owns its own useContainedFocus trap, so
    // document order is open order. An aria-modal element without a trap
    // would leave the dialogs beneath it keyboard-unclosable.
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

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
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
