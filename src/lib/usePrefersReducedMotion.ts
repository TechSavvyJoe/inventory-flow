import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  const media = typeof window !== 'undefined' ? window.matchMedia?.(QUERY) : undefined
  if (!media) return () => undefined
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }
  // Older WebKit exposes the same preference through the legacy listener API.
  media.addListener?.(onChange)
  return () => media.removeListener?.(onChange)
}

function getSnapshot() {
  return typeof window !== 'undefined' && (window.matchMedia?.(QUERY).matches ?? false)
}

/** Unlike the animation vendor's mount-only hook, this follows live OS changes. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
