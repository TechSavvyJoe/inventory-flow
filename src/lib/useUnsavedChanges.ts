import { useCallback, useContext, useEffect, useRef } from 'react'
import { UNSAFE_NavigationContext } from 'react-router-dom'

type Draft = { current: { dirty: boolean; saving: boolean } }
const pending = new Set<Draft>()
const isPending = (draft: Draft) => draft.current.dirty || draft.current.saving

function confirmDrafts(drafts: Draft[]): boolean {
  if (!drafts.some(isPending)) return true
  const message = drafts.some(draft => draft.current.saving)
    ? 'An update is still saving. Leave this workspace? The submitted update may still finish.'
    : 'Discard your unsaved changes?'
  if (!window.confirm(message)) return false
  for (const draft of drafts) draft.current = { dirty: false, saving: false }
  return true
}

export function confirmUnsavedWork(): boolean {
  return confirmDrafts([...pending])
}

// One listener set handles all edited forms, so one navigation prompts once.
let removeBrowserGuards: (() => void) | undefined
let browserGuardOwners = 0
let historyIndex: number | null = null
const readHistoryIndex = () => Number.isInteger(window.history.state?.idx) ? window.history.state.idx as number : null
function registerBrowserGuards() {
  if (removeBrowserGuards) { historyIndex = readHistoryIndex(); return }
  historyIndex = readHistoryIndex()
  let restoringIndex: number | null = null
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (![...pending].some(isPending)) return
    event.preventDefault()
    event.returnValue = ''
  }
  const navigate = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]')
    if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
    const destination = new URL(anchor.href, window.location.href)
    if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) return
    if (!confirmUnsavedWork()) { event.preventDefault(); event.stopPropagation() }
  }
  const traverse = (event: PopStateEvent) => {
    const nextIndex = readHistoryIndex()
    if (restoringIndex !== null) {
      // The rejected traversal is reverted before React Router sees either
      // event, keeping the edited component mounted with its existing values.
      event.stopImmediatePropagation()
      if (nextIndex === restoringIndex) restoringIndex = null
      else if (nextIndex !== null) window.history.go(restoringIndex - nextIndex)
      return
    }
    if (historyIndex !== null && nextIndex !== null && nextIndex !== historyIndex && !confirmUnsavedWork()) {
      event.stopImmediatePropagation()
      restoringIndex = historyIndex
      window.history.go(historyIndex - nextIndex)
      return
    }
    historyIndex = nextIndex
  }
  window.addEventListener('beforeunload', beforeUnload)
  document.addEventListener('click', navigate, true)
  window.addEventListener('popstate', traverse, true)
  removeBrowserGuards = () => {
    window.removeEventListener('beforeunload', beforeUnload)
    document.removeEventListener('click', navigate, true)
    window.removeEventListener('popstate', traverse, true)
    removeBrowserGuards = undefined
    historyIndex = null
  }
}

// Native window events are ordered by registration in real browsers. Capture
// alone does not put this ahead of React Router's popstate listener. Install
// before mounting BrowserRouter so a rejected Back never unmounts the draft.
export function installWorkspaceNavigationGuard() {
  browserGuardOwners += 1
  registerBrowserGuards()
  return () => {
    browserGuardOwners -= 1
    if (!browserGuardOwners && !pending.size) removeBrowserGuards?.()
  }
}

type Navigator = NonNullable<React.ContextType<typeof UNSAFE_NavigationContext>>['navigator']
const guardedNavigators = new WeakMap<Navigator, { users: number; release: () => void }>()
function protectNavigator(navigator: Navigator): () => void {
  const existing = guardedNavigators.get(navigator)
  if (existing) {
    existing.users += 1
    return () => { if (--existing.users === 0) existing.release() }
  }
  const original = { push: navigator.push, replace: navigator.replace, go: navigator.go }
  const push: Navigator['push'] = (...args) => {
    if (!confirmUnsavedWork()) return
    original.push.apply(navigator, args)
    historyIndex = readHistoryIndex()
  }
  const replace: Navigator['replace'] = (...args) => {
    if (!confirmUnsavedWork()) return
    original.replace.apply(navigator, args)
    historyIndex = readHistoryIndex()
  }
  const go: Navigator['go'] = (...args) => { if (confirmUnsavedWork()) original.go.apply(navigator, args) }
  navigator.push = push
  navigator.replace = replace
  navigator.go = go
  const registration = { users: 1, release: () => {
    if (navigator.push === push) navigator.push = original.push
    if (navigator.replace === replace) navigator.replace = original.replace
    if (navigator.go === go) navigator.go = original.go
    guardedNavigators.delete(navigator)
  } }
  guardedNavigators.set(navigator, registration)
  return () => { if (--registration.users === 0) registration.release() }
}

/** Protect links, router navigation, history traversal, and browser close. */
export function useUnsavedChanges(dirty: boolean, { saving = false }: { saving?: boolean } = {}) {
  const navigation = useContext(UNSAFE_NavigationContext)
  const savedWhileBusy = useRef(false)
  if (!saving) savedWhileBusy.current = false
  const draftRef = useRef({ dirty, saving })
  draftRef.current = { dirty: dirty && !savedWhileBusy.current, saving: saving && !savedWhileBusy.current }
  const confirmDiscard = useCallback(() => confirmDrafts([draftRef]), [])
  const markSaved = useCallback(() => {
    savedWhileBusy.current = draftRef.current.saving
    draftRef.current = { dirty: false, saving: false }
  }, [])

  useEffect(() => {
    pending.add(draftRef)
    registerBrowserGuards()
    const releaseNavigator = navigation ? protectNavigator(navigation.navigator) : undefined
    return () => {
      pending.delete(draftRef)
      releaseNavigator?.()
      if (!pending.size && !browserGuardOwners) removeBrowserGuards?.()
    }
  }, [navigation?.navigator])
  return { confirmDiscard, markSaved }
}
