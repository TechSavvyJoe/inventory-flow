import { useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useContainedFocus } from '../../lib/useContainedFocus'
import { useModalBackgroundIsolation } from '../../lib/useModalBackgroundIsolation'
import { confirmUnsavedWork } from '../../lib/useUnsavedChanges'
import './issues.css'

export function IssueDialog({ title, children, onClose, returnFocusRef }: {
  title: string; children: ReactNode; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const id = useId()
  const dialog = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const background = useRef<HTMLElement | null>(document.activeElement?.closest<HTMLElement>('[role="dialog"]') ?? document.getElementById('root'))
  const close = () => { if (confirmUnsavedWork()) onClose() }
  useContainedFocus({ active: true, contain: true, containerRef: dialog, initialFocusRef: heading, returnFocusRef, onEscape: close })
  useModalBackgroundIsolation({ active: true, backgroundRef: background })
  return createPortal(<div className="vehicle-issue-overlay"><section className="vehicle-issue-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
    <header><h2 id={id} ref={heading} tabIndex={-1}>{title}</h2><button type="button" onClick={close} aria-label="Close vehicle issue"><X aria-hidden="true" /></button></header>
    <div className="vehicle-issue-dialog__body">{children}</div>
  </section></div>, document.body)
}
